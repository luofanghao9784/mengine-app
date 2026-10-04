import { RuntimeError, type ModelPart, type ModelPort } from './ports.js';
import type { TokenUsage } from './metered-model.js';
import { isRecord } from './http-json.js';
import { chatFrames } from './chat-stream.js';
import { randomUUID } from 'node:crypto';

/** Shared wire format only. Each provider validates its own endpoint and capabilities. */
export class ChatCompletionsModel implements ModelPort {
  usage: { inputTokens: number; outputTokens: number } | null = null;
  lastUsage: TokenUsage | null = null;
  private usageIncomplete = false;
  constructor(
    private readonly config: {
      endpoint: URL;
      model: string;
      apiKey: string;
      timeoutMs: number;
      modeParameters: Record<string, unknown>;
    },
  ) {
    if (
      !/^[a-zA-Z0-9._-]{1,80}$/.test(config.model) ||
      !config.apiKey ||
      /[\s\x00-\x1f]/.test(config.apiKey) ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 60000
    )
      throw new RuntimeError('INVALID_MODEL_CONFIG');
  }
  async *generate(request: Parameters<ModelPort['generate']>[0]): AsyncIterable<ModelPart> {
    this.lastUsage = null;
    if (request.requiredTool !== undefined &&
        !request.tools.some((tool) => tool.name === request.requiredTool))
      throw new RuntimeError('INVALID_MODEL_INPUT');
    const messages = request.messages.flatMap((message) => {
      const tools = message.content.filter((b) => b.type === 'tool_result');
      if (tools.length) {
        if (tools.length !== message.content.length) throw new RuntimeError('INVALID_MODEL_INPUT');
        return tools.map((b) => ({ role: 'tool', tool_call_id: b.id, content: b.content })) as Record<
          string,
          unknown
        >[];
      }
      const calls = message.content.filter((b) => b.type === 'tool_call');
      return [
        {
          role: message.role,
          content:
            message.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text)
              .join('') || (calls.length ? null : ''),
          ...(calls.length
            ? {
                tool_calls: calls.map((b) => ({
                  id: b.id,
                  type: 'function',
                  function: { name: b.name, arguments: b.arguments },
                })),
              }
            : {}),
        },
      ];
    });
    const input = {
      model: this.config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...this.config.modeParameters,
      max_tokens: request.maxTokens,
      ...(request.tools.length
        ? { tools: request.tools.map((t) => ({ type: 'function', function: t })),
            ...(request.requiredTool ? { tool_choice: {
              type: 'function', function: { name: request.requiredTool },
            } } : {}),
          }
        : { tool_choice: 'none' }),
    };
    if (Buffer.byteLength(JSON.stringify(input)) > 262144) throw new RuntimeError('MODEL_INPUT_LIMIT');
    let body: unknown;
    let finish: string | undefined,
      usage: unknown,
      textBytes = 0;
    const streamCalls = new Map<
      number,
      { id: string; type: string; function: { name: string; arguments: string } }
    >();
    try {
      for await (const frame of chatFrames(
        this.config.endpoint,
        this.config.apiKey,
        input,
        request.signal,
        this.config.timeoutMs,
      )) {
        if (!frame.streaming) {
          body = frame.data;
          continue;
        }
        const value = frame.data;
        if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length > 1 || value.error)
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        if (value.usage) usage = value.usage;
        if (!value.choices.length) continue;
        const choice = value.choices[0];
        if (!isRecord(choice) || choice.index !== 0 || !isRecord(choice.delta))
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        const delta = choice.delta;
        if (delta.reasoning_content || (delta.role !== undefined && delta.role !== 'assistant'))
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        if (finish && (delta.content || delta.tool_calls)) throw new RuntimeError('INVALID_MODEL_RESPONSE');
        if (delta.content !== undefined && delta.content !== null) {
          if (typeof delta.content !== 'string') throw new RuntimeError('INVALID_MODEL_RESPONSE');
          textBytes += Buffer.byteLength(delta.content);
          if (textBytes > 65536) throw new RuntimeError('MODEL_OUTPUT_LIMIT');
          if (delta.content) yield { type: 'text', text: delta.content };
        }
        if (delta.tool_calls !== undefined) {
          if (!Array.isArray(delta.tool_calls)) throw new RuntimeError('INVALID_MODEL_RESPONSE');
          for (const part of delta.tool_calls) {
            if (
              !isRecord(part) ||
              !Number.isInteger(part.index) ||
              Number(part.index) < 0 ||
              Number(part.index) > 3
            )
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            const call = streamCalls.get(Number(part.index)) ?? {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
            if (part.id !== undefined) {
              if (typeof part.id !== 'string') throw new RuntimeError('INVALID_MODEL_RESPONSE');
              call.id += part.id;
            }
            if (part.type !== undefined && part.type !== 'function')
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            if (part.function !== undefined) {
              if (!isRecord(part.function)) throw new RuntimeError('INVALID_MODEL_RESPONSE');
              for (const key of ['name', 'arguments'] as const)
                if (part.function[key] !== undefined) {
                  if (typeof part.function[key] !== 'string')
                    throw new RuntimeError('INVALID_MODEL_RESPONSE');
                  call.function[key] += part.function[key];
                }
            }
            if (
              call.id.length > 128 ||
              call.function.name.length > 64 ||
              call.function.arguments.length > 65536
            )
              throw new RuntimeError('MODEL_OUTPUT_LIMIT');
            streamCalls.set(Number(part.index), call);
          }
        }
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
          if (finish || !['stop', 'tool_calls', 'length'].includes(String(choice.finish_reason)))
            throw new RuntimeError('INVALID_MODEL_RESPONSE');
          finish = String(choice.finish_reason);
        }
      }
      if (body === undefined) {
        if (!finish) throw new RuntimeError('MODEL_INCOMPLETE');
        body = {
          usage,
          choices: [
            {
              finish_reason: finish,
              message: { role: 'assistant', content: '', tool_calls: [...streamCalls.values()] },
            },
          ],
        };
      }
    } catch (error) {
      this.usageIncomplete = true;
      this.usage = null;
      throw error;
    }
    if (
      isRecord(body) &&
      isRecord(body.usage) &&
      Number.isSafeInteger(body.usage.prompt_tokens) &&
      Number.isSafeInteger(body.usage.completion_tokens) &&
      (body.usage.prompt_tokens as number) >= 0 &&
      (body.usage.completion_tokens as number) >= 0 &&
      (body.usage.prompt_tokens as number) <= 1000000 &&
      (body.usage.completion_tokens as number) <= 1000000
    ) {
      this.lastUsage = {
        inputTokens: body.usage.prompt_tokens as number,
        outputTokens: body.usage.completion_tokens as number,
      };
      if (!this.usageIncomplete)
        this.usage = {
          inputTokens: (this.usage?.inputTokens ?? 0) + (body.usage.prompt_tokens as number),
          outputTokens: (this.usage?.outputTokens ?? 0) + (body.usage.completion_tokens as number),
        };
    } else {
      this.usageIncomplete = true;
      this.usage = null;
    }
    if (
      !isRecord(body) ||
      !Array.isArray(body.choices) ||
      body.choices.length !== 1 ||
      !isRecord(body.choices[0])
    )
      throw new RuntimeError('INVALID_MODEL_RESPONSE');
    const choice = body.choices[0],
      message = choice.message;
    if (
      !isRecord(message) ||
      message.role !== 'assistant' ||
      !['stop', 'tool_calls', 'length'].includes(String(choice.finish_reason)) ||
      (message.content !== null && typeof message.content !== 'string') ||
      message.reasoning_content
    )
      throw new RuntimeError('INVALID_MODEL_RESPONSE');
    const calls = message.tool_calls ?? [];
    const forcedCall = request.requiredTool !== undefined && Array.isArray(calls) && calls.length === 1 &&
      ['stop', 'tool_calls'].includes(String(choice.finish_reason));
    if (
      !Array.isArray(calls) ||
      calls.length > 4 ||
      (request.requiredTool !== undefined && !forcedCall) ||
      ((choice.finish_reason === 'tool_calls') !== calls.length > 0 && !forcedCall)
    )
      throw new RuntimeError('INVALID_MODEL_RESPONSE');
    const parts: ModelPart[] = [];
    if (message.content) parts.push({ type: 'text', text: message.content as string });
    const ids = new Set();
    for (const call of calls) {
      // A provider can omit routing labels for a specifically selected function.
      // These labels correlate messages only; authority still comes from the task and actual tool receipt.
      const id = isRecord(call) && forcedCall && (call.id === undefined || call.id === '')
        ? randomUUID() : isRecord(call) ? call.id : undefined;
      const name = isRecord(call) && isRecord(call.function) && forcedCall &&
        (call.function.name === undefined || call.function.name === '')
        ? request.requiredTool : isRecord(call) && isRecord(call.function) ? call.function.name : undefined;
      if (
        !isRecord(call) ||
        call.type !== 'function' ||
        typeof id !== 'string' ||
        !/^[\x21-\x7e]{1,128}$/.test(id) ||
        ids.has(id) ||
        !isRecord(call.function) ||
        typeof name !== 'string' ||
        (request.requiredTool !== undefined && name !== request.requiredTool) ||
        typeof call.function.arguments !== 'string'
      )
        throw new RuntimeError('INVALID_MODEL_RESPONSE');
      if (id !== call.id || name !== call.function.name || (forcedCall && choice.finish_reason === 'stop'))
        console.warn(JSON.stringify({ event: 'MODEL_SELECTED_TOOL_NORMALIZED', tool: name,
          missingCallId: id !== call.id, missingToolName: name !== call.function.name,
          stopWithToolCall: choice.finish_reason === 'stop' }));
      ids.add(id);
      parts.push({
        type: 'tool_call',
        id,
        name,
        arguments: call.function.arguments,
      });
    }
    yield* parts;
    yield { type: 'finish', reason: forcedCall ? 'tool_calls' : choice.finish_reason as 'stop' | 'tool_calls' | 'length' };
  }
}
