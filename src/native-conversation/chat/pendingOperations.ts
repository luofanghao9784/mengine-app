/** Keep only opaque fingerprints and operation IDs, never prompts or material IDs.
 * sessionStorage survives refresh and navigation in this tab; the server still checks ownership.
 * Refuse dispatch if persistence is unavailable: silently falling back to memory loses idempotency.
 */
const inFlight = new Map<string, Promise<unknown>>();
export async function pendingOperation<T>(
  tenant: string,
  conversation: string,
  operation: string,
  run: (requestId: string) => Promise<T>,
  storage: Storage = sessionStorage,
): Promise<T> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operation));
  const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const key = `native-pending:v1:${tenant}:${conversation}:${fingerprint}`;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const work = (async () => {
    let requestId: string;
    try {
      const saved = storage.getItem(key);
      if (saved && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved))
        throw new Error('Invalid saved operation');
      requestId = saved || crypto.randomUUID();
      storage.setItem(key, requestId);
    } catch {
      throw new Error('无法保存本次操作的重试凭据，请允许此页面使用会话存储后重试。操作尚未发送。');
    }
    const result = await run(requestId);
    // If cleanup fails, keep the old receipt for a safe replay instead of issuing another write.
    storage.removeItem(key);
    return result;
  })();
  inFlight.set(key, work);
  try { return await work; } finally { inFlight.delete(key); }
}
