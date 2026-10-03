import { RuntimeError, type ModelPart, type ModelPort } from './ports.js';
import type { TokenUsage } from './metered-model.js';
import { isRecord } from './http-json.js';
import { postStream } from './http-stream.js';

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
        ? { tools: request.tools.map((t) => ({ type: 'function', function: t })) }
        : {}),
    };
    if (Buffer.byteLength(JSON.stringify(input)) > 262144) throw new RuntimeError('MODEL_INPUT_LIMIT');
    let body: unknown;
    let streamed = false,
      content = '',
      finish: unknown = null,
      usage: unknown;
    const fragments = new Map<
      number,
      { id: string; type: string; function: { name: string; arguments: string } }
    >();
    try {
      for await (const chunk of postStream(
        this.config.endpoint,
        this.config.apiKey,
        input,
        request.signal,
        this.config.timeoutMs,
      )) {
        if (!isRecord(chunk) || !Array.isArray(chunk.choices))
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        if (chunk.usage) usage = chunk.usage;
        if (!chunk.choices.length) continue;
        if (chunk.choices.length !== 1 || !isRecord(chunk.choices[0]))
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        const choice = chunk.choices[0];
        // Some compatible providers return complete JSON even when streaming is requested.
        if (choice.message) {
          if (streamed || body) throw new RuntimeError('INVALID_MODEL_RESPONSE');
          body = chunk;
          continue;
        }
        if (body || !isRecord(choice.delta) || choice.index !== 0 || finish !== null)
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        streamed = true;
        const delta = choice.delta;
        if (delta.reasoning_content || (delta.role !== undefined && delta.role !== 'assistant'))
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        if (delta.content !== undefined && delta.content !== null) {
          if (typeof delta.content !== 'string') throw new RuntimeError('INVALID_MODEL_RESPONSE');
          content += delta.content;
          if (Buffer.byteLength(content) > 65536) throw new RuntimeError('MODEL_OUTPUT_LIMIT');
          if (delta.content) yield { type: 'text', text: delta.content };
        }
        if (delta.tool_calls !== undefined) {
          if (!Array.isArray(delta.tool_calls)) throw new RuntimeError('INVALID_MODEL_RESPONSE');
          for (const call of delta.tool_calls) {
            if (
              !isRecord(call) ||
              !Number.isInteger(call.index) ||
              (call.index as number) < 0 ||
              (call.index as number) > 3
            )
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            const key = call.index as number;
            const prior = fragments.get(key) ?? {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
            if (call.id !== undefined) {
              if (typeof call.id !== 'string' || prior.id) throw new RuntimeError('INVALID_MODEL_RESPONSE');
              prior.id = call.id;
            }
            if (call.type !== undefined && call.type !== 'function')
              throw new RuntimeError('INVALID_MODEL_RESPONSE');
            if (call.function !== undefined) {
              if (!isRecord(call.function)) throw new RuntimeError('INVALID_MODEL_RESPONSE');
              for (const field of ['name', 'arguments'] as const)
                if (call.function[field] !== undefined) {
                  if (typeof call.function[field] !== 'string')
                    throw new RuntimeError('INVALID_MODEL_RESPONSE');
                  prior.function[field] += call.function[field];
                }
            }
            if (
              prior.function.arguments.length > 65536 ||
              prior.function.name.length > 64 ||
              prior.id.length > 128
            )
              throw new RuntimeError('MODEL_OUTPUT_LIMIT');
            fragments.set(key, prior);
          }
        }
        if (choice.finish_reason !== undefined && choice.finish_reason !== null)
          finish = choice.finish_reason;
      }
      if (streamed)
        body = {
          usage,
          choices: [
            {
              finish_reason: finish,
              message: {
                role: 'assistant',
                content,
                tool_calls: [...fragments.entries()].sort(([a], [b]) => a - b).map(([, v]) => v),
              },
            },
          ],
        };
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
    if (
      !Array.isArray(calls) ||
      calls.length > 4 ||
      (choice.finish_reason === 'tool_calls') !== calls.length > 0
    )
      throw new RuntimeError('INVALID_MODEL_RESPONSE');
    const parts: ModelPart[] = [];
    if (message.content && !streamed) parts.push({ type: 'text', text: message.content as string });
    const ids = new Set();
    for (const call of calls) {
      if (
        !isRecord(call) ||
        call.type !== 'function' ||
        typeof call.id !== 'string' ||
        ids.has(call.id) ||
        !isRecord(call.function) ||
        typeof call.function.name !== 'string' ||
        typeof call.function.arguments !== 'string'
      )
        throw new RuntimeError('INVALID_MODEL_RESPONSE');
      if (streamed)
        try {
          JSON.parse(call.function.arguments);
        } catch {
          throw new RuntimeError('INVALID_MODEL_RESPONSE');
        }
      ids.add(call.id);
      parts.push({
        type: 'tool_call',
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
    yield* parts;
    yield { type: 'finish', reason: choice.finish_reason as 'stop' | 'tool_calls' | 'length' };
  }
}
