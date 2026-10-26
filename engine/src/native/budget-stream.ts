import { randomUUID } from 'node:crypto';
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import { isAgentLoopRequest, markAgentLoopRequest } from '@deepseek-ai/dsh-llm';
import { BudgetError, LongTaskBudget, type BudgetScope, type Price } from './budget.js';

export interface BudgetedRoute {
  price: Price;
  /** Verified provider maximum input, including visual/file tokens. A heuristic is not a billing bound. */
  maxInputTokens: number;
  maxOutputTokens: number;
}
/** Wrap the provider dispatch, including auxiliary and retry requests. A route
 * without verified pricing and input bounds cannot start a paid request.
 * The caller binds tenant/user/root task outside model-visible input.
 */
export async function* budgetedStream(options: {
  ledger: LongTaskBudget;
  scope: BudgetScope;
  route: BudgetedRoute;
  request: GenerateOptions;
  dispatch(request: GenerateOptions): AsyncIterable<StreamChunk>;
  onSoftLimit?: () => void;
}): AsyncIterable<StreamChunk> {
  const { ledger, scope, route, request } = options;
  if (!Number.isSafeInteger(route.maxInputTokens) || route.maxInputTokens < 1 || route.maxInputTokens > 10_000_000
      || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1
      || !Number.isSafeInteger(request.maxTokens) || request.maxTokens! < 1 || request.maxTokens! > route.maxOutputTokens)
    throw new BudgetError('MODEL_BOUND_UNVERIFIED');
  request.signal?.throwIfAborted();
  const id = randomUUID();
  const reservation = ledger.reserve(scope, id, route.maxInputTokens, request.maxTokens!, route.price);
  let usage: TokenUsage | null = null;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new BudgetError('TASK_TIME_BUDGET')), reservation.remainingMs);
  const signal = AbortSignal.any([deadline.signal, ...(request.signal ? [request.signal] : [])]);
  const boundedRequest = { ...request, signal };
  if (isAgentLoopRequest(request)) markAgentLoopRequest(boundedRequest);
  if (Object.isFrozen(request)) Object.freeze(boundedRequest);
  try {
    if (reservation.softLimit) options.onSoftLimit?.();
    for await (const chunk of options.dispatch(boundedRequest)) {
      signal.throwIfAborted();
      // The DH usage event represents the entire call, not a delta. Conflicting
      // observations remain uncertain rather than accidentally double-counting.
      if (chunk.type === 'usage') {
        if (usage && JSON.stringify(usage) !== JSON.stringify(chunk.usage)) {
          usage = null;
          throw new BudgetError('MODEL_USAGE_CONFLICT');
        }
        usage = chunk.usage;
      }
      yield chunk;
    }
  } finally {
    clearTimeout(timer);
    ledger.settle(scope, id, usage);
  }
}
