import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import {
  usagePeriods,
  type UsagePeriod,
  type UsageOverview,
  type PlatformUsage,
} from '../../contracts/public-api/usage.ts';
const exact = (v: unknown, keys: string): v is Record<string, unknown> =>
  record(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const n = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nn = (v: unknown) => v === null || n(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const cls = (v: unknown) => ['live', 'verification', 'unknown'].includes(String(v));
export function isUsage(v: unknown): v is UsageOverview {
  if (
    !exact(v, 'tenantId period timeZone from until checkedAt groups days tools storage coverage quota') ||
    !(v.tenantId === null || uuid(v.tenantId)) ||
    !usagePeriods.includes(v.period as UsagePeriod) ||
    typeof v.timeZone !== 'string' ||
    v.timeZone.length > 80 ||
    !date(v.from) ||
    !date(v.until) ||
    !date(v.checkedAt) ||
    Date.parse(v.from) > Date.parse(v.until) ||
    Date.parse(v.until) > Date.parse(v.checkedAt)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v.timeZone });
  } catch {
    return false;
  }
  const s = v.storage,
    c = v.coverage,
    q = v.quota;
  if (
    !exact(s, 'originals versions registeredBytes') ||
    !Object.values(s).every(n) ||
    !exact(c, 'unmeteredWorkAttempts legacyToolReceipts evaluation evolution') ||
    !n(c.unmeteredWorkAttempts) ||
    !n(c.legacyToolReceipts) ||
    c.evaluation !== 'NOT_CONNECTED' ||
    c.evolution !== 'NOT_ENABLED' ||
    !exact(q, 'state unit limit remaining') ||
    q.state !== 'NOT_CONFIGURED' ||
    q.unit !== null ||
    q.limit !== null ||
    q.remaining !== null
  )
    return false;
  if (
    !Array.isArray(v.groups) ||
    v.groups.length > 6 ||
    !Array.isArray(v.tools) ||
    v.tools.length > 3 ||
    !Array.isArray(v.days) ||
    v.days.length > 31
  )
    return false;
  const groups = new Set();
  if (
    !v.groups.every((g) => {
      if (
        !exact(
          g,
          'purpose executionClass basis units reportedUnits unknownCallUnits pendingUnits modelCalls inputTokens outputTokens',
        ) ||
        !['WORK', 'MAINTENANCE'].includes(String(g.purpose)) ||
        !cls(g.executionClass) ||
        g.basis !== (g.purpose === 'WORK' ? 'REQUEST_STARTED' : 'RUN_STARTED') ||
        ![g.units, g.reportedUnits, g.unknownCallUnits, g.pendingUnits].every(n) ||
        !(g.units as number) ||
        [g.reportedUnits, g.unknownCallUnits, g.pendingUnits].some((x) => Number(x) > Number(g.units)) ||
        ![g.modelCalls, g.inputTokens, g.outputTokens].every(nn) ||
        (g.inputTokens === null) !== (g.outputTokens === null) ||
        (g.modelCalls === null && g.unknownCallUnits !== g.units) ||
        (g.purpose === 'WORK' &&
          (g.executionClass === 'unknown' || g.modelCalls !== g.units || g.unknownCallUnits !== 0))
      )
        return false;
      const key = `${g.purpose}:${g.executionClass}`;
      if (groups.has(key)) return false;
      groups.add(key);
      return true;
    })
  )
    return false;
  const classes = new Set();
  if (
    !v.tools.every((t) => {
      if (
        !exact(t, 'executionClass starts succeeded failed pending timed elapsedMillis') ||
        !cls(t.executionClass) ||
        classes.has(t.executionClass) ||
        ![t.starts, t.succeeded, t.failed, t.pending, t.timed].every(n) ||
        Number(t.succeeded) + Number(t.failed) + Number(t.pending) !== t.starts ||
        Number(t.timed) > Number(t.succeeded) + Number(t.failed) ||
        !nn(t.elapsedMillis) ||
        (t.timed === 0) !== (t.elapsedMillis === null)
      )
        return false;
      classes.add(t.executionClass);
      return true;
    })
  )
    return false;
  let previous = '';
  return v.days.every((d) => {
    if (
      !exact(d, 'date workRequests maintenanceCalls unknownMaintenanceRuns inputTokens outputTokens') ||
      typeof d.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      !Number.isFinite(Date.parse(d.date)) ||
      new Date(d.date).toISOString().slice(0, 10) !== d.date ||
      d.date <= previous ||
      !n(d.workRequests) ||
      !n(d.unknownMaintenanceRuns) ||
      ![d.maintenanceCalls, d.inputTokens, d.outputTokens].every(nn) ||
      (d.inputTokens === null) !== (d.outputTokens === null)
    )
      return false;
    previous = d.date;
    return true;
  });
}
export function isPlatformUsage(v: unknown): v is PlatformUsage {
  if (
    !exact(v, 'usage cost') ||
    !isUsage(v.usage) ||
    !exact(v.cost, 'state currency verifiedMinor estimatedMinor sharedAllocation')
  )
    return false;
  const c = v.cost;
  return (
    c.state === 'NOT_CONNECTED' &&
    c.currency === null &&
    c.verifiedMinor === null &&
    c.estimatedMinor === null &&
    c.sharedAllocation === 'NOT_CONFIGURED'
  );
}
export function createUsageClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    read(
      scope: 'tenant' | 'platform',
      tenant: string | null,
      period: UsagePeriod,
      signal?: AbortSignal,
    ): Promise<UsageOverview | PlatformUsage> {
      if (
        !['tenant', 'platform'].includes(scope) ||
        !(tenant === null || uuid(tenant)) ||
        (scope === 'tenant' && !tenant) ||
        !usagePeriods.includes(period)
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      const path =
        scope === 'platform'
          ? `/api/platform-admin/v1${tenant ? `/tenants/${tenant}` : ''}/usage`
          : `/api/tenant-admin/v1/tenants/${tenant}/usage`;
      return request(
        path + '?' + new URLSearchParams({ period }),
        'GET',
        (v): v is UsageOverview | PlatformUsage =>
          scope === 'platform'
            ? isPlatformUsage(v) && v.usage.tenantId === tenant && v.usage.period === period
            : isUsage(v) && v.tenantId === tenant && v.period === period,
        undefined,
        signal,
      );
    },
  };
}
export const usageClient = createUsageClient();
