import { RuntimeError, type ModelPart, type ModelPort } from './ports.js';
import type { TokenUsage } from './metered-model.js';
import { isRecord, postJson } from './http-json.js';

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
      stream: false,
      ...this.config.modeParameters,
      max_tokens: request.maxTokens,
      ...(request.tools.length
        ? { tools: request.tools.map((t) => ({ type: 'function', function: t })) }
        : {}),
    };
    if (Buffer.byteLength(JSON.stringify(input)) > 262144) throw new RuntimeError('MODEL_INPUT_LIMIT');
    const body = await postJson(
      this.config.endpoint,
      this.config.apiKey,
      input,
      request.signal,
      131072,
      this.config.timeoutMs,
    ).catch((error) => {
      this.usageIncomplete = true;
      this.usage = null;
      throw error;
    });
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
    if (message.content) parts.push({ type: 'text', text: message.content as string });
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
