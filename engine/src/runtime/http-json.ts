import { RuntimeError } from './ports.js';

/** Reads the whole body under the same abort deadline as headers. Never follows redirects. */
export async function postJson(
  url: URL,
  token: string,
  body: unknown,
  signal: AbortSignal,
  limit = 131072,
  timeoutMs = 5000,
): Promise<unknown> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new RuntimeError(
        response.status === 401 || response.status === 403 || response.status === 404
          ? 'REMOTE_ACCESS_DENIED'
          : response.status === 400 || response.status === 422
            ? 'REMOTE_BAD_REQUEST'
            : 'REMOTE_UNAVAILABLE',
      );
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body)
      throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > limit) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(signal.aborted ? 'CANCELLED' : 'REMOTE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
export function platformEndpoint(base: string): URL {
  const url = new URL(base);
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (!local && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new RuntimeError('INVALID_PLATFORM_ENDPOINT');
  return url;
}
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
