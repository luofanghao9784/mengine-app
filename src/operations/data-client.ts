import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import {
  dataOperationDiagnostics,
  dataOperationFormats,
  type DataOperationCounts,
  type DataOperationKind,
  type DataOperationState,
  type DataOperationOverview,
  type DataOperationDetail,
} from '../../contracts/public-api/data-operations.ts';
const exact = (v: unknown, fields: string): v is Record<string, unknown> =>
  record(v) && Object.keys(v).sort().join(' ') === fields.split(' ').sort().join(' ');
const num = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const state = (v: unknown) =>
  ['ALL', 'READY', 'PROCESSING', 'ATTENTION', 'NOT_STARTED', 'STOPPED'].includes(String(v));
const kind = (v: unknown) => ['CONNECTIONS', 'MATERIALS'].includes(String(v));
const counts = (v: unknown): v is DataOperationCounts =>
  exact(v, 'total ready processing attention notStarted stopped') &&
  Object.values(v).every(num) &&
  v.total ===
    (v.ready as number) +
      (v.processing as number) +
      (v.attention as number) +
      (v.notStarted as number) +
      (v.stopped as number);
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const tenantStatus = (v: unknown) => v === 'ACTIVE' || v === 'SUSPENDED';
const base = (v: Record<string, unknown>) =>
  kind(v.kind) &&
  state(v.state) &&
  num(v.offset) &&
  v.offset <= 20000 &&
  date(v.checkedAt) &&
  counts(v.counts) &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  typeof v.hasMore === 'boolean' &&
  (!v.hasMore || v.items.length === 20);
export function isDataOverview(v: unknown): v is DataOperationOverview {
  if (
    !exact(v, 'kind query state offset checkedAt matchedTenants counts items hasMore') ||
    !base(v) ||
    typeof v.query !== 'string' ||
    v.query.length > 180 ||
    !num(v.matchedTenants) ||
    !Array.isArray(v.items) ||
    v.items.length > v.matchedTenants
  )
    return false;
  const ids = new Set();
  return v.items.every(
    (t) =>
      exact(t, 'tenantId tenantName tenantStatus counts lastSuccessAt') &&
      uuid(t.tenantId) &&
      !ids.has(t.tenantId) &&
      !!ids.add(t.tenantId) &&
      name(t.tenantName) &&
      tenantStatus(t.tenantStatus) &&
      counts(t.counts) &&
      nullableDate(t.lastSuccessAt),
  );
}
export function isDataDetail(v: unknown): v is DataOperationDetail {
  if (
    !exact(v, 'kind state offset checkedAt tenantId tenantName tenantStatus counts items hasMore') ||
    !base(v) ||
    !uuid(v.tenantId) ||
    !name(v.tenantName) ||
    !tenantStatus(v.tenantStatus) ||
    !Array.isArray(v.items)
  )
    return false;
  const ids = new Set();
  return v.items.every(
    (i) =>
      exact(
        i,
        'monitorKey runId stage configuration category diagnostic createdAt finishedAt lastSuccessAt format sizeBytes version datasetCount rowCount',
      ) &&
      typeof i.monitorKey === 'string' &&
      /^[a-f0-9]{32}$/.test(i.monitorKey) &&
      !ids.has(i.monitorKey) &&
      !!ids.add(i.monitorKey) &&
      (i.runId === null || uuid(i.runId)) &&
      [
        'NOT_STARTED',
        'QUEUED',
        'RUNNING',
        'SUCCEEDED',
        'READY',
        'FAILED',
        'INTERRUPTED',
        'PARTIAL',
        'UNSUPPORTED',
        'CANCELLED',
      ].includes(String(i.stage)) &&
      (v.kind === 'MATERIALS'
        ? i.configuration === null &&
          dataOperationFormats.includes(i.format as (typeof dataOperationFormats)[number]) &&
          num(i.sizeBytes) &&
          num(i.version) &&
          i.version > 0 &&
          i.datasetCount === null &&
          i.rowCount === null
        : ['READY', 'UNAVAILABLE', 'UNCONFIGURED'].includes(String(i.configuration)) &&
          i.format === null &&
          i.sizeBytes === null &&
          i.version === null &&
          num(i.datasetCount) &&
          num(i.rowCount)) &&
      i.category !== 'ALL' &&
      state(i.category) &&
      (v.state === 'ALL' || i.category === v.state) &&
      (i.diagnostic === null ||
        dataOperationDiagnostics.includes(i.diagnostic as (typeof dataOperationDiagnostics)[number])) &&
      date(i.createdAt) &&
      nullableDate(i.finishedAt) &&
      nullableDate(i.lastSuccessAt),
  );
}
export function createDataOperationsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const params = (k: DataOperationKind, s: DataOperationState, offset: number) => {
    if (!kind(k) || !state(s) || !num(offset) || offset > 20000)
      throw new IdentityError('INVALID_REQUEST', 400);
    return new URLSearchParams({ kind: k, state: s, offset: String(offset) });
  };
  return {
    list(k: DataOperationKind, query: string, s: DataOperationState, offset: number, signal?: AbortSignal) {
      if (typeof query !== 'string' || query.length > 180) throw new IdentityError('INVALID_REQUEST', 400);
      const p = params(k, s, offset);
      p.set('query', query);
      return request(
        '/api/platform-admin/v1/data-operations?' + p,
        'GET',
        (v): v is DataOperationOverview =>
          isDataOverview(v) &&
          v.kind === k &&
          v.query === query.trim() &&
          v.state === s &&
          v.offset === offset,
        undefined,
        signal,
      );
    },
    detail(
      tenant: string,
      k: DataOperationKind,
      s: DataOperationState,
      offset: number,
      signal?: AbortSignal,
    ) {
      if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        `/api/platform-admin/v1/tenants/${tenant}/data-operations?` + params(k, s, offset),
        'GET',
        (v): v is DataOperationDetail =>
          isDataDetail(v) && v.tenantId === tenant && v.kind === k && v.state === s && v.offset === offset,
        undefined,
        signal,
      );
    },
  };
}
export const dataOperationsClient = createDataOperationsClient();
