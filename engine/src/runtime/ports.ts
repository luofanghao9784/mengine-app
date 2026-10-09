/** Owned by Dreamcore. No Harness types cross this boundary. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ModelBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; content: string; isError: boolean };
export type ModelPart =
  | Exclude<ModelBlock, { type: 'tool_result' }>
  | {
      type: 'finish';
      reason: 'stop' | 'tool_calls' | 'length';
    };
export interface ModelPort {
  /** Trusted adapter must honor signal; this is not an untrusted plugin loader. */
  generate(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: ModelBlock[] }[];
    tools: { name: string; description: string; parameters: Record<string, unknown> }[];
    /** Trusted workflow selection, only after a verified prerequisite receipt. */
    requiredTool?: string;
    /** Bounded workflow phase: choose one or more of the currently advertised tools. */
    requireToolCall?: boolean;
    signal: AbortSignal;
    maxTokens: number;
  }): AsyncIterable<ModelPart>;
}
export interface TaskTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, signal: AbortSignal): Promise<Json>;
  /** Optional model-facing projection; complete output remains in the execution receipt. */
  modelOutput?(value: Json): Json;
  /** Lossless protocol formatting only, before schema validation. */
  normalizeArguments?(value: unknown): unknown;
}
export interface RuntimeResult {
  status: 'completed' | 'failed' | 'cancelled' | 'limit';
  /** A completed turn is not evidence that a business task succeeded. */
  text: string;
  modelCalls: number;
  tools: { callId: string; name: string; status: 'succeeded' | 'failed'; output?: Json }[];
  code?: string;
  /** The last model call was reserved to report bounded progress, not business completion. */
  finalResponseReserved?: boolean;
}
export class RuntimeError extends Error {
  constructor(readonly code: string, readonly hint?: string) {
    super(code);
  }
}
