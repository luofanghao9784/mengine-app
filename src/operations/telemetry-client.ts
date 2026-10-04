import { telemetryChannels, type EngineTelemetry } from '../../contracts/public-api/engine-telemetry.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const shape = (v: unknown, keys: string): v is Record<string, unknown> =>
  record(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function isTelemetry(v: unknown): v is EngineTelemetry {
  if (
    !shape(v, 'tenantId checkedAt recentSeconds evolution channels') ||
    !(v.tenantId === null || uuid(v.tenantId)) ||
    !timestamp(v.checkedAt) ||
    v.recentSeconds !== 300 ||
    v.evolution !== 'NOT_CONNECTED' ||
    !Array.isArray(v.channels)
  )
    return false;
  const codes = telemetryChannels.filter((c) => v.tenantId === null || c !== 'GENERAL_ADJUSTMENT');
  return (
    v.channels.length === codes.length &&
    v.channels.every(
      (c, i) =>
        shape(c, 'code running queued waiting failed unknown completedRecent lastCompletedAt') &&
        c.code === codes[i] &&
        ['running', 'queued', 'waiting', 'failed', 'unknown', 'completedRecent'].every(
          (k) => Number.isSafeInteger(c[k]) && Number(c[k]) >= 0,
        ) &&
        (c.lastCompletedAt === null ||
          (timestamp(c.lastCompletedAt) &&
            Date.parse(c.lastCompletedAt) <= Date.parse(v.checkedAt as string))),
    )
  );
}
export function createTelemetryClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return (scope: 'platform' | 'tenant', tenant: string | null, signal?: AbortSignal) => {
    if (scope === 'tenant' ? !uuid(tenant) : tenant !== null) throw new IdentityError('INVALID_REQUEST', 400);
    const url =
      scope === 'platform'
        ? '/api/platform-admin/v1/engine-telemetry'
        : `/api/tenant-admin/v1/tenants/${tenant}/engine-telemetry`;
    return request(
      url,
      'GET',
      (v): v is EngineTelemetry => isTelemetry(v) && v.tenantId === tenant,
      undefined,
      signal,
    );
  };
}
export const getTelemetry = createTelemetryClient();
