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
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new RuntimeError(
        [401, 403, 404].includes(response.status) ? 'REMOTE_ACCESS_DENIED' : 'REMOTE_UNAVAILABLE',
      );
    if (!response.body) throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const streaming = response.headers.get('content-type')?.includes('text/event-stream');
    if (!streaming && !response.headers.get('content-type')?.includes('application/json'))
      throw new RuntimeError('INVALID_REMOTE_RESPONSE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '',
      data: string[] = [],
      bytes = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
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
          if (payload === '[DONE]') return;
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
    throw new RuntimeError(signal.aborted ? 'CANCELLED' : 'REMOTE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    timeout.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}
