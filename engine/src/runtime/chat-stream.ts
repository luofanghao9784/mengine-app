import { RuntimeError } from './ports.js';

/** Bounded SSE transport; JSON replies remain a non-streaming compatibility fallback. */
export async function* chatFrames(
  url: URL,
  token: string,
  input: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): AsyncIterable<{ streaming: boolean; data: unknown }> {
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let response: Response | undefined;
  let terminalFrame = false;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: 'MODEL_HTTP_REJECTED', status: response.status }));
      throw new RuntimeError(
        [401, 403, 404].includes(response.status) ? 'REMOTE_ACCESS_DENIED' : 'REMOTE_UNAVAILABLE',
      );
    }
    if (!response.body) throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const streaming = response.headers.get('content-type')?.includes('text/event-stream');
    if (!streaming && !response.headers.get('content-type')?.includes('application/json'))
      throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '',
      data: string[] = [],
      bytes = 0;
    for await (const chunk of response.body.values({ preventCancel: true })) {
      bytes += chunk.length;
      if (bytes > (streaming ? 2097152 : 131072)) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
      buffer += decoder.decode(chunk, { stream: true });
      if (!streaming) continue;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        if (data.join('\n').length > 131072) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
        if (!line && data.length) {
          const payload = data.join('\n');
          data = [];
          if (payload === '[DONE]') { terminalFrame = true; return; }
          yield { streaming: true, data: JSON.parse(payload) };
        }
      }
      if (buffer.length > 131072) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
    }
    buffer += decoder.decode();
    if (streaming) throw new RuntimeError('MODEL_INCOMPLETE');
    yield { streaming: false, data: JSON.parse(buffer) };
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    const cause = error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
    const codes = new Set([
      'UND_ERR_CONNECT_TIMEOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
    ]);
    const directCode = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    const networkCode = cause?.code ?? directCode;
    console.warn(
      JSON.stringify({
        event: 'MODEL_TRANSPORT_FAILED',
        timedOut: timeout.signal.aborted,
        cancelled: signal.aborted,
        code: networkCode && codes.has(networkCode) ? networkCode : 'TRANSPORT_ERROR',
      }),
    );
    throw new RuntimeError(signal.aborted ? 'CANCELLED' : 'REMOTE_UNAVAILABLE');
  } finally {
    // A normal DONE often precedes the HTTP body's EOF by one small tail.
    // Cancelling it immediately destroys keep-alive and reconnects every model round.
    // Drain only a bounded tail; an endpoint that stays open is still cancelled.
    if (terminalFrame && response?.body && !response.body.locked && !combined.aborted) {
      const reader = response.body.getReader();
      const drainTimer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 250);
      try {
        let tailBytes = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          tailBytes += next.value.byteLength;
          if (tailBytes > 8192) { await reader.cancel(); break; }
        }
      } catch { /* Completed frame is authoritative; cleanup cannot replay a request. */ }
      finally { clearTimeout(drainTimer); reader.releaseLock(); }
    }
    clearTimeout(timer);
    timeout.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (signal.aborted) throw new RuntimeError('CANCELLED');
  }
}
