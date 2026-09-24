import { RuntimeError, type ModelPort } from './ports.js';
import { isRecord } from './http-json.js';

export type TokenUsage = { inputTokens: number; outputTokens: number };
export type UsageModel = ModelPort & { lastUsage?: TokenUsage | null; usage?: TokenUsage | null };

/** Reserve before dispatch; never replay a provider request after uncertain delivery. */
export function meteredModel(
  backend: UsageModel,
  invoke: (action: string, body: unknown, receipt?: boolean) => Promise<unknown>,
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
      let outcome = 'FAILED';
      try {
        request.signal.throwIfAborted();
        for await (const part of backend.generate(request)) {
          if (part.type === 'finish') outcome = 'RETURNED';
          yield part;
        }
      } finally {
        if (request.signal.aborted) outcome = 'CANCELLED';
        // A fresh bounded signal permits metadata delivery after cancellation. No task/data actions.
        const usage = backend.lastUsage as TokenUsage | null | undefined;
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
