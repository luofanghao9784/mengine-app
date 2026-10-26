import type { Usage } from './budget.js';

export type WireProtocol = 'messages' | 'openai';
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10_000_000;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Observe provider usage without rewriting the native wire stream. Truncation,
 * malformed accounting or missing terminal receipts leave spend UNKNOWN.
 * Never infer zero usage from a network error or the absence of counters.
 */
export class WireUsage {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';
  private data: string[] = [];
  private invalid = false;
  private started = false;
  private ended = false;
  private inputSeen = false;
  private outputSeen = false;
  private usage: Usage = { inputTokens: 0, outputTokens: 0 };
  constructor(private protocol: WireProtocol) {}
  push(bytes: Uint8Array) {
    if (this.invalid) return;
    try {
      this.buffer += this.decoder.decode(bytes, { stream: true });
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, '');
        this.buffer = this.buffer.slice(newline + 1);
        if (line === '') this.event();
        else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
        if (this.data.reduce((n, s) => n + s.length, 0) > 1_048_576) throw Error('usage event too large');
      }
      if (this.buffer.length > 1_048_576) throw Error('usage event too large');
    } catch { this.invalid = true; this.buffer = ''; this.data = []; }
  }
  private event() {
    if (!this.data.length) return;
    const raw = this.data.join('\n'); this.data = [];
    if (this.protocol === 'openai' && raw === '[DONE]') {
      if (this.ended) throw Error('duplicate terminal receipt');
      this.ended = true; return;
    }
    const event = object(JSON.parse(raw));
    if (this.ended) throw Error('data after terminal receipt');
    if (event.error) throw Error('provider error');
    if (this.protocol === 'messages') {
      if (event.type === 'error') throw Error('provider error');
      if (event.type === 'message_start') {
        if (this.started) throw Error('duplicate message start');
        this.started = true;
        this.messagesUsage(object(object(event.message).usage), false);
      } else if (event.type === 'message_delta') {
        if (!this.started) throw Error('delta before start');
        this.messagesUsage(object(event.usage), true);
      } else if (event.type === 'message_stop') this.ended = this.started;
    } else if (event.usage != null) {
      const usage = object(event.usage), details = object(usage.prompt_tokens_details);
      const input = usage.prompt_tokens, output = usage.completion_tokens;
      const cache = details.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
      const reasoning = object(usage.completion_tokens_details).reasoning_tokens ?? 0;
      if (![input, output, cache, reasoning].every(integer) || Number(cache) > Number(input) || Number(reasoning) > Number(output))
        throw Error('invalid usage');
      const next = { inputTokens: Number(input) - Number(cache), outputTokens: Number(output), cacheReadTokens: Number(cache), reasoningTokens: Number(reasoning) };
      if (this.inputSeen && JSON.stringify(next) !== JSON.stringify(this.usage)) throw Error('conflicting usage receipts');
      this.usage = next; this.inputSeen = this.outputSeen = true;
    }
  }
  private messagesUsage(raw: Record<string, unknown>, finalOutput: boolean) {
    const fields = { input_tokens: 'inputTokens', output_tokens: 'outputTokens', cache_read_input_tokens: 'cacheReadTokens', cache_creation_input_tokens: 'cacheWriteTokens' } as const;
    for (const [wire, key] of Object.entries(fields)) {
      if (raw[wire] === undefined) continue;
      if (!integer(raw[wire])) throw Error('invalid usage');
      const value = Number(raw[wire]);
      if (value < (this.usage[key as keyof Usage] ?? 0)) throw Error('usage decreased');
      this.usage[key as keyof Usage] = value;
      if (wire === 'input_tokens') this.inputSeen = true;
      if (wire === 'output_tokens' && finalOutput) this.outputSeen = true;
    }
  }
  finish(): Usage | null {
    try {
      this.buffer += this.decoder.decode();
      // SSE events are committed only by a blank line. A dangling event is not
      // a billing receipt, even if its JSON happens to be parseable.
      if (this.buffer.trim() || this.data.length) return null;
    } catch { return null; }
    return !this.invalid && this.ended && this.inputSeen && this.outputSeen ? { ...this.usage } : null;
  }
}
