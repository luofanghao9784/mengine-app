const prefix = 'dreamcore-view:';
const allowedScopes = new WeakMap<Storage, string[]>();
export function viewStateKey(account: string, tenant: string, page: string) {
  return `${prefix}${account}:${tenant}:${page}`;
}
export function readViewState<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => value is T,
  storage?: Storage,
): T {
  try {
    const raw = (storage ?? sessionStorage).getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function writeViewState(key: string, value: unknown, storage?: Storage) {
  try {
    const target = storage ?? sessionStorage;
    const allowed = allowedScopes.get(target);
    // Ignore late unmount/scroll callbacks from a revoked account or enterprise.
    if (allowed && !allowed.some((scope) => key.startsWith(scope))) return;
    target.setItem(key, JSON.stringify(value));
  } catch {
    /* Navigation remains available. */
  }
}
export function reconcileViewStates(account: string | null, tenants: string[] = [], storage?: Storage) {
  try {
    const target = storage ?? sessionStorage;
    const allowed = account ? tenants.map((tenant) => viewStateKey(account, tenant, '')) : [];
    allowedScopes.set(target, allowed);
    const keys = Array.from({ length: target.length }, (_, i) => target.key(i)).filter(
      (key): key is string => key !== null,
    );
    for (const key of keys) {
      if (key.startsWith(prefix) && (!account || !allowed.some((start) => key.startsWith(start))))
        target.removeItem(key);
    }
  } catch {
    /* Identity and API revalidation still guard every reader. */
  }
}
