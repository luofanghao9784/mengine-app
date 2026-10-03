import { RuntimeError } from './ports.js';

/** Bounded SSE reader. A deadline covers headers and body; cancelling the caller closes both. */
export async function* postStream(
  url: URL,
  token: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): AsyncIterable<unknown> {
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new RuntimeError(
        [401, 403, 404].includes(response.status) ? 'REMOTE_ACCESS_DENIED' : 'REMOTE_UNAVAILABLE',
      );
    const type = response.headers.get('content-type') ?? '';
    if (!response.body || (!type.includes('text/event-stream') && !type.includes('application/json')))
      throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '',
      total = 0,
      done = false;
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += bytes.byteLength;
      if (total > 2097152) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
      buffer += decoder.decode(bytes, { stream: true });
      if (type.includes('application/json')) {
        if (total > 131072) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
        continue;
      }
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          done = true;
          continue;
        }
        if (done) throw new RuntimeError('INVALID_MODEL_RESPONSE');
        yield JSON.parse(data);
      }
      if (buffer.length > 131072) throw new RuntimeError('REMOTE_OUTPUT_LIMIT');
    }
    buffer += decoder.decode();
    if (type.includes('application/json')) {
      yield JSON.parse(buffer);
      return;
    }
    if (!done || buffer.trim()) throw new RuntimeError('MODEL_INCOMPLETE');
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError(signal.aborted ? 'CANCELLED' : 'REMOTE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    timeout.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
