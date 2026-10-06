import {
  telemetryChannels,
  type EngineTelemetry,
  type TenantDistribution,
} from '../../contracts/public-api/engine-telemetry.ts';
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
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function isTenantDistribution(v: unknown): v is TenantDistribution {
  if (
    !shape(v, 'checkedAt tenants otherTenants otherRunning') ||
    !timestamp(v.checkedAt) ||
    !Array.isArray(v.tenants) ||
    v.tenants.length > 10 ||
    !count(v.otherTenants) ||
    !count(v.otherRunning) ||
    (v.otherTenants === 0) !== (v.otherRunning === 0) ||
    Number(v.otherRunning) < Number(v.otherTenants) ||
    (Number(v.otherTenants) > 0 && v.tenants.length < 10)
  )
    return false;
  const ids = new Set<unknown>();
  let previous = Infinity;
  return v.tenants.every((t) => {
    if (
      !shape(t, 'tenantId tenantName running') ||
      !uuid(t.tenantId) ||
      ids.has(t.tenantId) ||
      typeof t.tenantName !== 'string' ||
      !t.tenantName ||
      t.tenantName.length > 200 ||
      !count(t.running) ||
      t.running < 1 ||
      t.running > previous
    )
      return false;
    ids.add(t.tenantId);
    previous = t.running;
    return true;
  });
}
export function createTenantDistributionClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return (signal?: AbortSignal) =>
    request(
      '/api/platform-admin/v1/engine-telemetry/tenants',
      'GET',
      isTenantDistribution,
      undefined,
      signal,
    );
}
export const getTenantDistribution = createTenantDistributionClient();
