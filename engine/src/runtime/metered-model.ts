import { safeModelFailure, ModelResponseError } from './model-response.js';
import { RuntimeError, type ModelPort } from './ports.js';
import type { TaskObservation } from './observability.js';
import { isRecord } from './http-json.js';

export type TokenUsage = { inputTokens: number; outputTokens: number };
export type UsageModel = ModelPort & { lastUsage?: TokenUsage | null; usage?: TokenUsage | null; lastResponseComplete?: boolean };

/** Reserve before dispatch; never replay a provider request after uncertain delivery. */
export function meteredModel(
  backend: UsageModel,
  invoke: (action: string, body: unknown, receipt?: boolean) => Promise<unknown>,
  observation?: TaskObservation, modelName = 'model',
): ModelPort {
  let sequence = 0;
  return {
    async *generate(request) {
      if (
        sequence >= 8 ||
        !Number.isInteger(request.maxTokens) ||
        request.maxTokens > 2048 ||
        request.maxTokens < 1
      )
        throw new RuntimeError('TASK_LIMIT');
      const current = ++sequence;
      const reserved = await invoke('model-usage/start', {
        sequence: current,
        maxOutputTokens: request.maxTokens,
      });
      if (!isRecord(reserved) || reserved.accepted !== true)
        throw new RuntimeError('TASK_RUNTIME_INCOMPATIBLE');
      backend.lastUsage = null;
      backend.lastResponseComplete = false;
      let outcome = 'FAILED';
      const observed = observation?.model(modelName, current);
      try {
        request.signal.throwIfAborted();
        for await (const part of backend.generate(request)) {
          if (part.type === 'finish') outcome = 'RETURNED';
          yield part;
        }
      } catch (error) {
        // RETURNED is a transport receipt, never tool acceptance. A fully received
        // invalid proposal still consumed a real response and belongs in totals.
        if (error instanceof ModelResponseError && (backend.lastResponseComplete as boolean | undefined) === true)
          outcome = 'RETURNED';
        const codes = new Set([
          'MODEL_RATE_LIMITED', 'MODEL_PROVIDER_UNAVAILABLE', 'MODEL_REQUEST_REJECTED', 'MODEL_TIMEOUT', 'MODEL_NETWORK_ERROR',
          'REMOTE_ACCESS_DENIED',
          'REMOTE_UNAVAILABLE',
          'INVALID_REMOTE_RESPONSE',
          'REMOTE_OUTPUT_LIMIT',
          'INVALID_MODEL_INPUT',
          'INVALID_MODEL_RESPONSE',
          'MODEL_INPUT_LIMIT',
          'MODEL_OUTPUT_LIMIT',
          'MODEL_INCOMPLETE',
          'CANCELLED',
        ]);
        console.warn(
          JSON.stringify({
            event: 'TASK_MODEL_REQUEST_FAILED',
            sequence: current,
            diagnostic: safeModelFailure(error),
            code: error instanceof RuntimeError && codes.has(error.code) ? error.code : 'MODEL_ERROR',
          }),
        );
        throw error;
      } finally {
        if (request.signal.aborted) outcome = 'CANCELLED';
        // A fresh bounded signal permits metadata delivery after cancellation. No task/data actions.
        const usage = backend.lastUsage as TokenUsage | null | undefined;
        observed?.(outcome, usage);
        const receipt = await invoke(
          'model-usage/finish',
          {
            sequence: current,
            outcome,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
          },
          true,
        );
        if (!isRecord(receipt) || receipt.accepted !== true)
          throw new RuntimeError('TASK_RUNTIME_UNAVAILABLE');
      }
    },
  };
}
