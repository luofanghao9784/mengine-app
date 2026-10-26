import { createHash } from 'node:crypto';
import { isRecord } from './http-json.js';
import { RuntimeError, type ModelBlock } from './ports.js';
import type { UsageModel } from './metered-model.js';

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : isRecord(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');

/** Structure-only governance: one bounded model call, no data tools or publication authority. */
export class GovernanceModel {
  private entries = new Map<string, { hash: string; at: number; result: Promise<unknown> }>();
  private running = false;
  constructor(private config: { createModel(): UsageModel; modelName: string }) {}

  async run(input: unknown) {
    if (!isRecord(input) || input.contractVersion !== '2.0' || !uuid(input.jobId)
      || input.executor !== 'SYSTEM_MODEL' || !isRecord(input.context) || input.context.kind !== 'DATASET'
      || typeof input.prompt !== 'string' || input.prompt.length > 16000
      || typeof input.inputHash !== 'string' || !Array.isArray(input.messages) || input.messages.length !== 2
      || !Number.isSafeInteger(input.attempt) || Number(input.attempt) < 1
      || Object.keys(input).some(k => !['contractVersion', 'jobId', 'executor', 'context', 'prompt', 'messages', 'inputHash', 'attempt'].includes(k)))
      throw new RuntimeError('INVALID_GOVERNANCE_REQUEST');
    // The platform builds this metadata contract from authorized source snapshots. No raw rows are accepted.
    if (Object.keys(input.context).some(k => !['kind', 'sourceId', 'name', 'snapshotId', 'version', 'rowCount', 'columns', 'fields', 'nullCounts', 'contentHash', 'coverageThrough', 'sourceEvidence', 'checks', 'coverage', 'background', 'preparationDraft'].includes(k)))
      throw new RuntimeError('INVALID_GOVERNANCE_REQUEST');
    const messages: { role: 'system' | 'user'; content: ModelBlock[] }[] = [
      { role: 'system', content: [{ type: 'text', text: input.prompt }] },
      { role: 'user', content: [{ type: 'text', text: JSON.stringify(canonical(input.context)) }] },
    ];
    if (hash(messages) !== input.inputHash || hash(input.messages) !== input.inputHash)
      throw new RuntimeError('GOVERNANCE_INPUT_MISMATCH');
    const key = `${input.jobId}:${input.attempt}`;
    const prior = this.entries.get(key);
    if (prior) {
      if (prior.hash !== input.inputHash) throw new RuntimeError('GOVERNANCE_INPUT_MISMATCH');
      return prior.result;
    }
    for (const [id, entry] of this.entries) if (Date.now() - entry.at > 600000) this.entries.delete(id);
    if (this.running || this.entries.size >= 256) throw new RuntimeError('ENGINE_BUSY');
    this.running = true;
    const { jobId, inputHash, executor } = input;
    const result = (async () => {
      try {
        const model = this.config.createModel();
        const signal = AbortSignal.timeout(55000);
        let output = '', finished = false;
        for await (const part of model.generate({ messages, tools: [], signal, maxTokens: 8192 })) {
          signal.throwIfAborted();
          if (part.type === 'text') {
            output += part.text;
            if (Buffer.byteLength(output) > 240000) throw new RuntimeError('GOVERNANCE_OUTPUT_LIMIT');
          } else if (part.type === 'finish' && part.reason === 'stop') finished = true;
          else throw new RuntimeError('GOVERNANCE_OUTPUT_INVALID');
        }
        if (!finished) throw new RuntimeError('GOVERNANCE_OUTPUT_INVALID');
        const parsed: unknown = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1'));
        if (!isRecord(parsed)) throw new RuntimeError('GOVERNANCE_OUTPUT_INVALID');
        return { contractVersion: '2.0', jobId, inputHash, executor, output: parsed,
          modelName: this.config.modelName, modelCalls: 1,
          inputTokens: model.lastUsage?.inputTokens ?? null, outputTokens: model.lastUsage?.outputTokens ?? null };
      } catch (error) {
        // No provider body, credential or model-generated text crosses the error boundary.
        if (error instanceof RuntimeError && ['GOVERNANCE_OUTPUT_LIMIT', 'GOVERNANCE_OUTPUT_INVALID'].includes(error.code)) throw error;
        throw new RuntimeError('GOVERNANCE_MODEL_FAILED');
      } finally { this.running = false; }
    })();
    this.entries.set(key, { hash: inputHash, at: Date.now(), result });
    try { return await result; }
    catch (error) { this.entries.delete(key); throw error; }
  }
}
