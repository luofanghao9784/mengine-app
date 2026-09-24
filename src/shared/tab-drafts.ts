/** Browser persistence is best effort; server state and request IDs remain authoritative. */
export function readTabDraft(key: string, storage?: Storage): { value?: unknown; unreadable: boolean } {
  try {
    const raw = (storage ?? sessionStorage).getItem(key);
    return { value: raw ? JSON.parse(raw) : undefined, unreadable: false };
  } catch {
    return { unreadable: true };
  }
}
export function removeTabDraft(key: string, storage?: Storage): boolean {
  try {
    (storage ?? sessionStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}
export function writeTabDraft(key: string, value: unknown, storage?: Storage): boolean {
  try {
    (storage ?? sessionStorage).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // A stale earlier snapshot must not masquerade as the latest draft on reload.
    // If removal is blocked too, the warning is still required; never clear unrelated keys.
    removeTabDraft(key, storage);
    return false;
  }
}
