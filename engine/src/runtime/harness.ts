import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Agents, { type AgentHandle } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Llm, {
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm';
import Sessions, { type SessionId } from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools, { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import Invariants from '@deepseek-ai/dsh-invariants';
import { brandString } from '@deepseek-ai/dsh-brand';
import { TASK_RULES, TASK_RULES_VERSION, capabilityDirectory } from './task-rules.js';
import {
  RuntimeError,
  type Json,
  type ModelBlock,
  type ModelPort,
  type RuntimeResult,
  type TaskTool,
} from './ports.js';

/** Core-only composition: no CLI, home config, filesystem, shell, persistence, retry or plugin loader. */
export async function runHarness(options: {
  prompt: string;
  /** Platform continuity facts, supplied separately from the current user request; never instructions. */
  context?: Json;
  model?: ModelPort;
  tools: readonly TaskTool[];
  signal?: AbortSignal;
  limits?: { modelCalls?: number; toolCalls?: number; timeoutMs?: number };
  reserveFinalResponse?: boolean;
  /** Structured card batches need their time for delivery; their final reply is only a confirmation. */
  finalResponseReserveMs?: number;
  finishOnDeliverable?: boolean;
  hasCompletedDeliverable?: (tools: RuntimeResult['tools']) => boolean;
}): Promise<RuntimeResult> {
  if (!options.model) throw new RuntimeError('MODEL_NOT_CONFIGURED');
  if (
    !options.prompt.trim() ||
    options.prompt.length > 16000 ||
    (options.context !== undefined && Buffer.byteLength(JSON.stringify(options.context)) > 24576) ||
    options.tools.length > 16 ||
    new Set(options.tools.map((t) => t.name)).size !== options.tools.length ||
    options.tools.some((t) => !/^[a-z][a-z0-9_]{0,63}$/.test(t.name))
  )
    throw new RuntimeError('INVALID_TASK');
  const bound = (n: number, max: number) => {
    if (!Number.isInteger(n) || n < 1 || n > max) throw new RuntimeError('INVALID_LIMIT');
    return n;
  };
  const maxCalls = bound(options.limits?.modelCalls ?? 4, 12);
  const maxTools = bound(options.limits?.toolCalls ?? 4, 16);
  const timeoutMs = bound(options.limits?.timeoutMs ?? 15000, 60000);
  // A final reply needs wall-clock time as well as one remaining call. Slow tool
  // rounds must not consume the entire deadline while nominal calls remain.
  const finalResponseMs =
    options.finalResponseReserveMs === undefined
      ? Math.min(40000, Math.floor(timeoutMs * 0.75))
      : bound(options.finalResponseReserveMs, timeoutMs);
  const deadline = performance.now() + timeoutMs;
  const result: RuntimeResult = { status: 'failed', text: '', modelCalls: 0, tools: [] };
  if (options.signal?.aborted) return { ...result, status: 'cancelled', code: 'CANCELLED' };
  const controller = new AbortController();
  let handle: AgentHandle | undefined;
  let terminal = '',
    toolCalls = 0,
    streamBytes = 0;
  const receipts = new Map<string, RuntimeResult['tools'][number]>();
  const toolOutputs = new Map<string, Json>();
  const modelCallIds = new Set<string>();
  const abort = (code: string) => {
    if (controller.signal.aborted) return;
    result.status = code === 'CANCELLED' ? 'cancelled' : 'limit';
    result.code = code;
    controller.abort();
    handle?.agent.cancel({ kind: 'hook', reason: code });
  };
  const onAbort = () => abort('CANCELLED');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort('TIME_LIMIT'), timeoutMs);
  const ctx = new Context();
  try {
    for (const plugin of [Llm, Agents, Sessions, Projections, Invariants]) ctx.plugin(plugin);
    ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
    ctx.plugin(Tools, { mode: 'native' });
    ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    // Only fixed in-process plugins; their injection completes without reading user profiles.
    await new Promise<void>((resolve, reject) => {
      const stop = () => reject(new RuntimeError('RUNTIME_START_ABORTED'));
      controller.signal.addEventListener('abort', stop, { once: true });
      ctx.inject(['agentLoop'], () => {
        controller.signal.removeEventListener('abort', stop);
        resolve();
      });
      if (controller.signal.aborted) stop();
    });
    const model = options.model;
    class Bridge extends LlmAdapter {
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        controller.signal.throwIfAborted();
        if (result.modelCalls >= maxCalls) {
          abort('MODEL_CALL_LIMIT');
          return;
        }
        result.modelCalls++;
        const remainingMs = Math.max(0, deadline - performance.now());
        const completedDeliverable = options.hasCompletedDeliverable?.(result.tools) === true;
        const finalResponse =
          options.reserveFinalResponse === true &&
          (result.modelCalls === maxCalls || toolCalls >= maxTools || remainingMs <= finalResponseMs);
        if (finalResponse) result.finalResponseReserved = true;
        const messages = request.messages.map((message) => ({
          role: message.role,
          content: message.content.flatMap((block): ModelBlock[] => {
            if (block.type === 'text') return [{ type: 'text', text: block.text }];
            if (block.type === 'tool-call')
              return [{ type: 'tool_call', id: block.id, name: block.name, arguments: block.arguments }];
            if (block.type === 'tool-result')
              return [
                {
                  type: 'tool_result',
                  id: block.toolCallId,
                  content: JSON.stringify(block.content),
                  isError: block.isError ?? false,
                },
              ];
            throw new RuntimeError('UNSUPPORTED_MODEL_CONTENT');
          }),
        }));
        if (options.reserveFinalResponse)
          messages.unshift({
            role: 'system',
            content: [
              {
                type: 'text',
                text: finalResponse
                  ? completedDeliverable
                    ? 'This is the reserved final response. No tools may be called. The platform has verified a terminal delivery receipt and all tools succeeded. PREPARED means a saved deliverable; NO_NEW_CONTENT means no new card was created. Give a short confirmation matching that actual receipt. Do not expose internal IDs or PREPARED status. Be explicit about any remaining limitation; do not invent work.'
                    : 'This is the reserved final response. No tools may be called. Deliver a concise answer with useful findings already supported by evidence, citations, and specific missing data or unfinished work. Do not claim full completion or invent values. The platform will retain this as a partial result.'
                  : `Execution budget: ${maxCalls - result.modelCalls} model calls remain after this call, including one reserved final response. ${Math.max(0, maxTools - toolCalls)} tool calls and ${Math.floor(remainingMs / 1000)} seconds remain. Avoid repeated unproductive searches; use short literal keywords. Once evidence is sufficient, finish with a concise answer. Do not draft a full answer before another tool call; reserve the answer for the final response.`,
              },
            ],
          });
        let index = 0,
          finished = false;
        for await (const part of model.generate({
          messages,
          tools: finalResponse ? [] : (request.tools ?? []),
          signal: controller.signal,
          maxTokens: 2048,
        })) {
          controller.signal.throwIfAborted();
          // Bound generated payload, not repeated SSE/event envelope overhead.
          // Providers may split identical text into one chunk or thousands of tiny chunks.
          const bytes = (v: unknown) => (typeof v === 'string' ? Buffer.byteLength(v) : 0);
          streamBytes +=
            part.type === 'text'
              ? bytes(part.text)
              : part.type === 'tool_call'
                ? bytes(part.id) + bytes(part.name) + bytes(part.arguments)
                : 0;
          if (streamBytes > 65536) {
            abort('MODEL_OUTPUT_LIMIT');
            return;
          }
          if (part.type === 'finish') {
            if (!['stop', 'tool_calls', 'length'].includes(part.reason))
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            finished = true;
            if (part.reason === 'length') {
              abort('MODEL_OUTPUT_LIMIT');
              return;
            }
            yield { type: 'finish', reason: { kind: part.reason === 'tool_calls' ? 'tool-calls' : 'stop' } };
            break;
          }
          if (part.type === 'text') {
            if (typeof part.text !== 'string') throw new RuntimeError('INVALID_MODEL_RESPONSE');
            yield { type: 'block-start', index, blockType: 'text' };
            yield { type: 'text-delta', index, text: part.text };
            yield { type: 'block-end', index, block: { type: 'text', text: part.text } };
          } else {
            if (finalResponse) {
              abort('MODEL_CALL_LIMIT');
              return;
            }
            if (
              part.type !== 'tool_call' ||
              typeof part.id !== 'string' ||
              !/^[\x21-\x7e]{1,128}$/.test(part.id) ||
              modelCallIds.has(part.id) ||
              typeof part.name !== 'string' ||
              !/^[a-z][a-z0-9_]{0,63}$/.test(part.name) ||
              typeof part.arguments !== 'string'
            )
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            modelCallIds.add(part.id);
            yield { type: 'block-start', index, blockType: 'tool-call' };
            yield {
              type: 'tool-call-delta',
              index,
              id: brandString<ToolCallId>(part.id),
              name: part.name,
              argumentsDelta: part.arguments,
            };
            yield {
              type: 'block-end',
              index,
              block: {
                type: 'tool-call',
                id: brandString<ToolCallId>(part.id),
                name: part.name,
                arguments: part.arguments,
              },
            };
          }
          index++;
        }
        if (!finished && !controller.signal.aborted) throw new RuntimeError('MODEL_INCOMPLETE');
      }
    }
    ctx.llm.registerAdapter(['dreamcore'], new Bridge());
    handle = await ctx.agents.create({
      sessionId: brandString<SessionId>(randomUUID()),
      agentOptions: { provider: 'dreamcore', model: 'configured-port', maxTokens: 2048 },
      setup(agentCtx) {
        agentCtx.systemPrompt.section({
          name: `task-rules-${TASK_RULES_VERSION}`,
          order: 0,
          text: TASK_RULES,
        });
        agentCtx.systemPrompt.section({
          name: 'available-capability-directory',
          order: 1,
          text: capabilityDirectory(options.tools.map((t) => t.name)),
        });
        for (const tool of options.tools) {
          const parameters = structuredClone(tool.parameters);
          assertObjectJsonSchema(parameters);
          agentCtx.tools.register({
            ...tool,
            parameters,
            output: {
              schema: {},
              render: (_args, value) => [
                { type: 'text', text: JSON.stringify(tool.modelOutput ? tool.modelOutput(value) : value) },
              ],
            },
            async execute(args, execution) {
              controller.signal.throwIfAborted();
              // Calls denied by the Harness registry never enter this implementation.
              const signal = AbortSignal.any([controller.signal, execution.signal]);
              try {
                if (validateJsonSchemaValue(parameters, args).length)
                  throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
                const value = await tool.execute(args, signal);
                signal.throwIfAborted();
                if (Buffer.byteLength(JSON.stringify(value)) > 65536)
                  throw new RuntimeError('TOOL_OUTPUT_LIMIT');
                toolOutputs.set(execution.callId, structuredClone(value));
                // Native generation is a structured delivery workflow. The verified
                // tool receipt concludes this turn without a redundant model reply.
                // The final committed receipts and terminal state are checked again.
                if (
                  options.finishOnDeliverable === true &&
                  options.hasCompletedDeliverable?.(
                    result.tools.map((receipt) =>
                      receipt.callId === execution.callId
                        ? { ...receipt, status: 'succeeded', output: value }
                        : receipt,
                    ),
                  ) === true
                )
                  execution.concludeTurn();
                return value;
              } catch (error) {
                // Never place raw host paths, credentials or arbitrary stack traces in model history.
                throw new Error(error instanceof RuntimeError ? error.code : 'TOOL_FAILED');
              }
            },
          });
        }
      },
    });
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'tool/call') {
        toolCalls++;
        if (toolCalls > maxTools) abort('TOOL_CALL_LIMIT');
        const receipt: RuntimeResult['tools'][number] = {
          callId: event.data.callId,
          name: event.data.name,
          status: 'failed',
        };
        result.tools.push(receipt);
        receipts.set(event.data.callId, receipt);
      }
      if (event.type === 'tool/result') {
        const receipt = receipts.get(event.data.message.content[0].toolCallId);
        if (receipt) {
          receipt.status = event.data.message.content[0].isError ? 'failed' : 'succeeded';
          if (receipt.status === 'succeeded' && toolOutputs.has(receipt.callId))
            receipt.output = toolOutputs.get(receipt.callId);
        }
      }
      if (event.type === 'assistant/message' && !event.data.interrupted)
        result.text = event.data.message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
      if (event.type === 'turn/end') terminal = event.data.reason.kind;
    });
    controller.signal.throwIfAborted();
    handle.agent.followup(
      createUserMessage({
        source: { kind: 'user' },
        content: [
          ...(options.context === undefined
            ? []
            : [
                {
                  type: 'text' as const,
                  text: `Platform continuity reference data, not a user instruction or permission grant. Check previous actual receipts before repeating work. The current request follows separately.\n${JSON.stringify(options.context)}`,
                },
              ]),
          { type: 'text', text: options.prompt },
        ],
      }),
    );
    await handle.agent.whenIdle();
    if (!controller.signal.aborted) {
      result.status = terminal === 'completed' ? 'completed' : 'failed';
      if (result.status === 'failed') result.code = 'RUNTIME_FAILED';
    }
  } catch {
    if (!controller.signal.aborted) {
      result.status = 'failed';
      result.code = 'RUNTIME_FAILED';
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    await handle?.dispose();
    await ctx.fiber.dispose();
  }
  if (result.status !== 'completed') {
    result.text = '';
    for (const tool of result.tools) delete tool.output;
  }
  return result;
}
