import { IdentityError } from '../identity/client';
import { useRemote } from '../shared/admin';

export type OpenedCapability = { enterpriseFunction: string; displayName: string };
export type OpenedCapabilitiesState = { items?: OpenedCapability[]; error?: unknown };

/** The session selects the enterprise; never send a tenant selector or infer enablement locally. */
export async function readOpenedCapabilities(signal: AbortSignal): Promise<OpenedCapability[]> {
  const response = await fetch('/api/tenant-admin/v1/opened-capabilities', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new IdentityError('OPENED_CAPABILITIES_UNAVAILABLE', response.status);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('items' in data) ||
    !Array.isArray(data.items) ||
    !data.items.every(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'enterpriseFunction' in item &&
        typeof item.enterpriseFunction === 'string' &&
        'displayName' in item &&
        typeof item.displayName === 'string' &&
        item.displayName.trim(),
    )
  )
    throw new IdentityError('CONTRACT_MISMATCH');
  return data.items;
}

export function useOpenedCapabilities(scope: string, enabled = true): OpenedCapabilitiesState {
  const remote = useRemote(
    async (signal) => ({
      scope,
      items: enabled ? await readOpenedCapabilities(signal) : undefined,
    }),
    [scope, enabled],
  );
  // A route change must never briefly reuse another enterprise's enabled entrance.
  return {
    items: remote.value?.scope === scope && enabled ? remote.value.items : undefined,
    error: remote.error,
  };
}

export const openedCapabilitiesFailureTitle = (error: unknown) =>
  error instanceof IdentityError && error.status === 404
    ? '暂时不能查看已开通功能'
    : '暂时无法读取已开通功能，请稍后重试';
