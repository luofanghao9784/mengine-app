import { createHash, randomUUID } from 'node:crypto';
import { RuntimeError, type ModelPort, type ModelPart } from './ports.js';

/** A transport, not a second workflow: the caller still owns Harness, validation and publication. */
export interface DelegatedModelExchange {
  request(input: DelegatedModelRequest, signal: AbortSignal): Promise<DelegatedModelResponse>;
}
export type DelegatedModelRequest = {
  version: '1.0'; id: string; taskId: string; attemptId: string; inputHash: string;
  messages: Parameters<ModelPort['generate']>[0]['messages'];
  tools: Parameters<ModelPort['generate']>[0]['tools']; maxTokens: number;
};
export type DelegatedModelResponse = {
  version: '1.0'; id: string; taskId: string; attemptId: string; inputHash: string;
  executor: 'CODEX'; text: string;
};
const uuid = (v: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export class DelegatedModel implements ModelPort {
  readonly usage = null;
  lastUsage = null;
  lastResponseComplete = false;
  constructor(private readonly taskId: string, private readonly attemptId: string,
    private readonly exchange: DelegatedModelExchange) {
    if (!uuid(taskId) || !uuid(attemptId)) throw new RuntimeError('INVALID_MODEL_INPUT');
  }
  async *generate(input: Parameters<ModelPort['generate']>[0]): AsyncIterable<ModelPart> {
    input.signal.throwIfAborted();
    // First scope is read-only structured governance. Never delegate arbitrary executable tools.
    if (input.tools.length || input.requiredTool || input.requireToolCall ||
        !Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 2048)
      throw new RuntimeError('INVALID_MODEL_INPUT');
    const payload = JSON.stringify({messages: input.messages, tools: input.tools, maxTokens: input.maxTokens});
    if (Buffer.byteLength(payload) > 128 * 1024) throw new RuntimeError('MODEL_INPUT_LIMIT');
    const request: DelegatedModelRequest = {version:'1.0', id:randomUUID(), taskId:this.taskId,
      attemptId:this.attemptId, inputHash:createHash('sha256').update(payload).digest('hex'),
      ...JSON.parse(payload)};
    this.lastResponseComplete = false;
    const response = await this.exchange.request(request, input.signal);
    input.signal.throwIfAborted();
    if (!response || response.version !== '1.0' || response.executor !== 'CODEX' ||
        response.id !== request.id || response.taskId !== request.taskId ||
        response.attemptId !== request.attemptId || response.inputHash !== request.inputHash ||
        typeof response.text !== 'string' || !response.text.trim() || response.text.length > 16000)
      throw new RuntimeError('INVALID_MODEL_RESPONSE');
    this.lastResponseComplete = true;
    yield {type:'text', text:response.text};
    yield {type:'finish', reason:'stop'};
  }
}
