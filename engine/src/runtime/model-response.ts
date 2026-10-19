import { RuntimeError, type ModelPart, type ModelPort } from './ports.js';

// Must cover the existing Harness ceiling; per-task tool budgets still apply at execution.
export const MAX_MODEL_TOOL_CALLS = 16;

/** Closed vocabulary: neither model-selected names nor argument values enter diagnostics. */
export const RESPONSE_DIAGNOSTICS = [
  'ENVELOPE',
  'CHOICE',
  'ROLE_OR_REASONING',
  'AFTER_FINISH',
  'TEXT_TYPE',
  'TOOL_LIST',
  'TOOL_INDEX',
  'TOOL_ID',
  'TOOL_TYPE',
  'TOOL_FUNCTION',
  'TOOL_NAME',
  'TOOL_ARGUMENTS_TYPE',
  'TOOL_ARGUMENTS_JSON',
  'FINISH_REASON',
  'REQUIRED_TOOL_MISSING',
  'REQUIRED_TOOL_COUNT',
  'FINISH_TOOL_MISMATCH',
  'DUPLICATE_TOOL_ID',
  'UNADVERTISED_TOOL',
  'WRONG_REQUIRED_TOOL',
  'FINAL_TOOL_FORBIDDEN',
] as const;
export type ResponseDiagnostic = (typeof RESPONSE_DIAGNOSTICS)[number];
export class ModelResponseError extends RuntimeError {
  constructor(
    readonly diagnostic: ResponseDiagnostic,
    readonly proposalComplete = true,
  ) {
    super('INVALID_MODEL_RESPONSE');
  }
}
export function safeModelFailure(error: unknown): string {
  if (error instanceof ModelResponseError) return error.diagnostic;
  const codes = [
    'MODEL_INCOMPLETE',
    'MODEL_OUTPUT_LIMIT',
    'MODEL_INPUT_LIMIT',
    'MODEL_TIMEOUT',
    'MODEL_NETWORK_ERROR',
    'MODEL_RATE_LIMITED',
    'MODEL_PROVIDER_UNAVAILABLE',
    'MODEL_REQUEST_REJECTED',
    'REMOTE_ACCESS_DENIED',
    'INVALID_MODEL_RESPONSE',
    'CANCELLED',
  ];
  return error instanceof RuntimeError && codes.includes(error.code) ? error.code : 'RUNTIME_FAILED';
}

/** Validate the entire proposal before exposing any tool call to the execution loop. */
export async function collectModelResponse(
  source: AsyncIterable<ModelPart>,
  tools: Parameters<ModelPort['generate']>[0]['tools'],
  usedIds: ReadonlySet<string>,
  signal: AbortSignal,
  finalText = false,
  previewText?: (text: string) => Promise<void>,
): Promise<ModelPart[]> {
  const parts: ModelPart[] = [],
    ids = new Set<string>();
  let finish = '',
    bytes = 0,
    calls = 0;
  // Drain the bounded response first: the metering wrapper must receive its actual
  // finish/usage receipt even when the proposal is subsequently rejected.
  for await (const part of source) {
    signal.throwIfAborted();
    bytes +=
      part.type === 'text' && typeof part.text === 'string'
        ? Buffer.byteLength(part.text)
        : part.type === 'tool_call'
          ? [part.id, part.name, part.arguments].reduce(
              (n, v) => n + (typeof v === 'string' ? Buffer.byteLength(v) : 0),
              0,
            )
          : 0;
    if (bytes > 65536) throw new RuntimeError('MODEL_OUTPUT_LIMIT');
    parts.push(part);
    if (part.type === 'text' && typeof part.text === 'string') await previewText?.(part.text);
  }
  bytes = 0;
  for (const part of parts) {
    signal.throwIfAborted();
    if (finish) throw new ModelResponseError('AFTER_FINISH');
    if (part.type === 'finish') {
      if (!['stop', 'tool_calls', 'length'].includes(part.reason))
        throw new ModelResponseError('FINISH_REASON');
      finish = part.reason;
    } else if (part.type === 'text') {
      if (typeof part.text !== 'string') throw new ModelResponseError('TEXT_TYPE');
      bytes += Buffer.byteLength(part.text);
    } else if (part.type === 'tool_call') {
      if (finalText) throw new ModelResponseError('FINAL_TOOL_FORBIDDEN');
      if (typeof part.id !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(part.id))
        throw new ModelResponseError('TOOL_ID');
      if (usedIds.has(part.id) || ids.has(part.id)) throw new ModelResponseError('DUPLICATE_TOOL_ID');
      if (!tools.some((tool) => tool.name === part.name)) throw new ModelResponseError('UNADVERTISED_TOOL');
      if (typeof part.arguments !== 'string') throw new ModelResponseError('TOOL_ARGUMENTS_TYPE');
      try {
        const value = JSON.parse(part.arguments);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0;
      } catch {
        throw new ModelResponseError('TOOL_ARGUMENTS_JSON');
      }
      ids.add(part.id);
      calls++;
      bytes += Buffer.byteLength(part.id) + Buffer.byteLength(part.name) + Buffer.byteLength(part.arguments);
    } else throw new ModelResponseError('ENVELOPE');
    if (bytes > 65536 || calls > MAX_MODEL_TOOL_CALLS) throw new RuntimeError('MODEL_OUTPUT_LIMIT');
  }
  if (!finish) throw new RuntimeError('MODEL_INCOMPLETE');
  if (finish !== 'length' && (finish === 'tool_calls') !== calls > 0)
    throw new ModelResponseError('FINISH_TOOL_MISMATCH');
  return parts;
}
