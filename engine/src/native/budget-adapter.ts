import type { GenerateOptions, LlmAdapter } from '@deepseek-ai/dsh-llm';
import { budgetedStream, type BudgetedRoute } from './budget-stream.js';
import type { BudgetScope, LongTaskBudget } from './budget.js';

/** Decorate the actual adapter dispatch, below DH retries and auxiliary calls.
 * Preserve adapter-owned metadata, image projection and prepared generations.
 * This is metering, NOT an isolation boundary: production must keep the ledger,
 * provider credentials and trusted scope resolver outside the tool sandbox.
 */
export function withBudget(adapter: LlmAdapter, options: {
  ledger: LongTaskBudget;
  resolve(request: GenerateOptions): { scope: BudgetScope; route: BudgetedRoute }
    | Promise<{ scope: BudgetScope; route: BudgetedRoute }>;
  onSoftLimit?: (scope: BudgetScope) => void;
}): LlmAdapter {
  const wrap = async function* (request: GenerateOptions, dispatch: LlmAdapter['stream']) {
    request.signal?.throwIfAborted();
    const { scope, route } = await options.resolve(request);
    request.signal?.throwIfAborted();
    yield* budgetedStream({ ledger: options.ledger, scope, route, request, dispatch,
      onSoftLimit: () => options.onSoftLimit?.(scope) });
  };
  return new Proxy(adapter, {
    get(target, property) {
      if (property === 'stream') return (request: GenerateOptions) => wrap(request, target.stream.bind(target));
      if (property === 'prepareCall') return async (...args: Parameters<LlmAdapter['prepareCall']>) => {
        const prepared = await target.prepareCall(...args);
        return { ...prepared, stream: (request: GenerateOptions) => wrap(request, prepared.stream.bind(prepared)) };
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
