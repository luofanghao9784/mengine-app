import { randomUUID } from 'node:crypto';
import { BudgetError, LongTaskBudget, type BudgetScope } from './budget.js';
import type { BudgetedRoute } from './budget-stream.js';
import { WireUsage, type WireProtocol } from './wire-usage.js';

export interface NativeModelRoute extends BudgetedRoute {
  protocol: WireProtocol;
  model: string;
  /** Operator configuration, never taken from a model request. */
  endpoint: string;
  apiKey: string;
}
export interface NativeModelGrant {
  scope: BudgetScope;
  route: NativeModelRoute;
  /** Host supervisor aborts this on cancellation or access revocation. */
  signal: AbortSignal;
}

/** Runs outside the agent container. The resolver authenticates a root-bound
 * capability and checks current platform permissions on EVERY dispatch. The
 * capability is not a provider key and cannot select tenant/user/root scope.
 * This module handles inference only. File upload needs separate scoped IDs;
 * unsupported endpoints must not be forwarded by the HTTP host.
 */
export class NativeModelGateway {
  constructor(private options: {
    ledger: LongTaskBudget;
    resolve(capability: string): Promise<NativeModelGrant | null>;
    dispatch?: typeof fetch;
  }) {}

  async handle(request: Request): Promise<Response> {
    let grant: NativeModelGrant | null;
    const authorization = request.headers.get('authorization');
    const capability = authorization?.startsWith('Bearer ') ? authorization.slice(7) : request.headers.get('x-api-key');
    if (!capability || capability.length > 512) return failure(401, 'NATIVE_AUTH_REQUIRED');
    try { grant = await this.options.resolve(capability); }
    catch { return failure(503, 'NATIVE_AUTH_UNAVAILABLE'); }
    if (!grant || grant.signal.aborted) return failure(403, 'NATIVE_ACCESS_DENIED');
    // Copy trusted values before any asynchronous work; mutable external route
    // config cannot change the cost or destination after reservation.
    const scope = { ...grant.scope }, route = { ...grant.route, price: { ...grant.route.price } };
    const path = route.protocol === 'messages' ? '/v1/messages' : '/v1/chat/completions';
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== path || url.search) return failure(404, 'NATIVE_ROUTE_NOT_FOUND');
    let endpoint: URL;
    try {
      endpoint = new URL(route.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search)
        throw Error('invalid endpoint');
    } catch { return failure(503, 'MODEL_ROUTE_UNVERIFIED'); }
    if (!Number.isSafeInteger(route.maxInputTokens) || route.maxInputTokens < 1 || route.maxInputTokens > 10_000_000
      || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1 || route.maxOutputTokens > 1_000_000
      || !route.apiKey || !route.model) return failure(503, 'MODEL_BOUND_UNVERIFIED');
    let bytes: Uint8Array, body: Record<string, unknown>;
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return failure(415, 'NATIVE_JSON_REQUIRED');
      bytes = await boundedBody(request, AbortSignal.any([request.signal, grant.signal]));
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('object required');
    } catch { return failure(400, 'NATIVE_INVALID_REQUEST'); }
    // Provider file IDs belong to the provider account, not this root task.
    // Until a scoped upload registry is installed, never accept opaque IDs.
    if (containsFileId(body)) return failure(400, 'NATIVE_SCOPED_FILE_REQUIRED');
    if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined
      && body.max_tokens !== body.max_completion_tokens) return failure(400, 'MODEL_BOUND_UNVERIFIED');
    const maxOutput = route.protocol === 'openai' ? (body.max_completion_tokens ?? body.max_tokens) : body.max_tokens;
    if (body.model !== route.model || body.stream !== true || !Number.isSafeInteger(maxOutput) || Number(maxOutput) < 1
      || Number(maxOutput) > route.maxOutputTokens) return failure(400, 'MODEL_BOUND_UNVERIFIED');
    if (request.signal.aborted || grant.signal.aborted) return failure(409, 'NATIVE_CANCELLED');
    // Authorization may change while a large request body is arriving.
    try {
      const current = await this.options.resolve(capability);
      if (!current || current.signal.aborted || current.scope.tenant !== scope.tenant || current.scope.user !== scope.user
        || current.scope.task !== scope.task || current.signal !== grant.signal || JSON.stringify(current.route) !== JSON.stringify(route))
        return failure(403, 'NATIVE_ACCESS_DENIED');
    } catch { return failure(503, 'NATIVE_AUTH_UNAVAILABLE'); }
    const callId = randomUUID();
    let reservation: ReturnType<LongTaskBudget['reserve']>;
    try { reservation = this.options.ledger.reserve(scope, callId, route.maxInputTokens, Number(maxOutput), route.price); }
    catch (error) { return failure(429, error instanceof BudgetError ? error.code : 'NATIVE_BUDGET_UNAVAILABLE'); }
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, grant.signal, controller.signal]);
    const timeout = setTimeout(() => controller.abort(new BudgetError('TASK_TIME_BUDGET')), reservation.remainingMs);
    const meter = new WireUsage(route.protocol);
    let finished = false;
    const finish = (complete: boolean) => {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      this.options.ledger.settle(scope, callId, complete ? meter.finish() : null);
    };
    const headers = new Headers({ 'content-type': 'application/json', accept: 'text/event-stream' });
    // Never forward caller cookies, proxy credentials, redirects, arbitrary
    // authorization or response set-cookie. Native feature headers survive.
    if (route.protocol === 'messages') {
      headers.set('x-api-key', route.apiKey);
      for (const key of ['anthropic-version', 'anthropic-beta']) {
        const value = request.headers.get(key); if (value) headers.set(key, value);
      }
    } else headers.set('authorization', `Bearer ${route.apiKey}`);
    let upstream: Response;
    try {
      upstream = await (this.options.dispatch ?? fetch)(endpoint, {
        method: 'POST', headers, body: Buffer.from(bytes), signal, redirect: 'error',
      });
      if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
        await upstream.body?.cancel(); finish(false);
        return failure(502, 'NATIVE_PROVIDER_FAILED');
      }
    } catch { finish(false); return failure(502, 'NATIVE_PROVIDER_FAILED'); }
    const reader = upstream.body.getReader();
    // Settles even if the client never pulls/cancels the response. The host
    // supervisor's signal closes upstream sockets on process cancellation.
    const abort = () => { finish(false); void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          signal.throwIfAborted();
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) { signal.removeEventListener('abort', abort); finish(true); output.close(); }
          else { meter.push(chunk.value); output.enqueue(chunk.value); }
        } catch (error) {
          signal.removeEventListener('abort', abort); controller.abort(); finish(false); output.error(error);
        }
      },
      async cancel(reason) {
        signal.removeEventListener('abort', abort); controller.abort(reason); finish(false); await reader.cancel(reason);
      },
    }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  }
}
function failure(status: number, code: string) {
  return Response.json({ error: { type: code, message: code } }, { status, headers: { 'cache-control': 'no-store' } });
}
async function boundedBody(request: Request, signal: AbortSignal): Promise<Uint8Array> {
  if (!request.body) throw Error('body required');
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      // Native images may be inline. This transport bound is not a token bound.
      if (size > 128 * 1024 * 1024) throw Error('body too large');
      parts.push(chunk.value);
    }
    return Buffer.concat(parts, size);
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}

function containsFileId(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const next = pending.pop();
    if (!next || typeof next !== 'object') continue;
    for (const [key, child] of Object.entries(next)) {
      if (key === 'file_id') return true;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}
