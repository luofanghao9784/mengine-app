import { createIdentityRequest, record, text, uuid } from '../identity/client.ts';
import type {
  CollectionSchedule,
  CollectionRun,
  DataConnection,
  BusinessDataset,
  DataSummary,
  DatasetPage,
  DatasetPreview,
} from '../../contracts/public-api/collection.ts';
export type {
  CollectionSchedule,
  CollectionRun,
  DataConnection,
  BusinessDataset,
} from '../../contracts/public-api/collection.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const timestamp = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const nullableTime = (v: unknown) => v === null || timestamp(v);
const run = (v: unknown): v is CollectionRun =>
  record(v) &&
  uuid(v.id) &&
  ['MANUAL', 'SCHEDULED'].includes(String(v.triggerKind)) &&
  ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(String(v.status)) &&
  (v.reason === null || text(v.reason)) &&
  timestamp(v.createdAt) &&
  nullableTime(v.startedAt) &&
  nullableTime(v.finishedAt);
const nullableRun = (v: unknown) => v === null || run(v);
const schedule = (v: unknown): v is CollectionSchedule =>
  record(v) &&
  typeof v.enabled === 'boolean' &&
  (v.frequency === null || ['QUARTER_HOUR', 'HOURLY', 'DAILY'].includes(String(v.frequency))) &&
  (v.dailyTime === null ||
    (typeof v.dailyTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.dailyTime))) &&
  text(v.timeZone) &&
  (!v.enabled || v.frequency !== null) &&
  (v.frequency === 'DAILY' ? v.dailyTime !== null : v.dailyTime === null);
const connection = (v: unknown): v is DataConnection =>
  record(v) &&
  uuid(v.id) &&
  text(v.name) &&
  text(v.routeLabel) &&
  text(v.accessSummary) &&
  ['READY', 'UNAVAILABLE', 'UNCONFIGURED'].includes(String(v.status)) &&
  count(v.revision) &&
  typeof v.canControl === 'boolean' &&
  schedule(v.schedule) &&
  nullableTime(v.nextDue) &&
  nullableTime(v.lastSuccessAt) &&
  nullableRun(v.currentRun) &&
  nullableRun(v.lastRun);
const dataset = (v: unknown): v is BusinessDataset =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.connectionId) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName) &&
  text(v.name) &&
  typeof v.description === 'string' &&
  Array.isArray(v.columns) &&
  v.columns.length > 0 &&
  v.columns.every(text) &&
  new Set(v.columns).size === v.columns.length &&
  (v.version === null || (count(v.version) && v.version > 0)) &&
  (v.rowCount === null || count(v.rowCount)) &&
  nullableTime(v.collectedAt) &&
  nullableTime(v.coverageThrough) &&
  nullableRun(v.latestRun);
export function createDatabaseClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant: string) => `/api/v1/tenants/${tenant}/database`;
  return {
    summary: (tenant: string, signal?: AbortSignal) =>
      request(
        root(tenant) + '/summary',
        'GET',
        (v): v is DataSummary => record(v) && [v.datasets, v.available, v.updating, v.failed].every(count),
        undefined,
        signal,
      ),
    datasets: (tenant: string, q: string, state: string, offset: number, signal?: AbortSignal) =>
      request(
        root(tenant) + '/datasets?' + new URLSearchParams({ q, state, offset: String(offset), limit: '20' }),
        'GET',
        (v): v is DatasetPage =>
          record(v) && Array.isArray(v.items) && v.items.every(dataset) && typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    preview: (tenant: string, id: string, offset: number, signal?: AbortSignal) =>
      request(
        root(tenant) + `/datasets/${id}?offset=${offset}&limit=20`,
        'GET',
        (v): v is DatasetPreview =>
          record(v) &&
          dataset(v.dataset) &&
          v.dataset.id === id &&
          Array.isArray(v.rows) &&
          v.rows.every(
            (r) =>
              Array.isArray(r) &&
              r.length === (v.dataset as BusinessDataset).columns.length &&
              r.every((c) => c === null || typeof c === 'string'),
          ) &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    connections: (tenant: string, signal?: AbortSignal) =>
      request(
        root(tenant) + '/connections',
        'GET',
        (v): v is DataConnection[] => Array.isArray(v) && v.every(connection),
        undefined,
        signal,
      ),
    connection: (tenant: string, id: string, signal?: AbortSignal) =>
      request(
        root(tenant) + `/connections/${id}`,
        'GET',
        (v): v is DataConnection => connection(v) && v.id === id,
        undefined,
        signal,
      ),
    runs: (tenant: string, id: string, offset: number, signal?: AbortSignal) =>
      request(
        root(tenant) + `/connections/${id}/runs?offset=${offset}&limit=21`,
        'GET',
        (v): v is CollectionRun[] => Array.isArray(v) && v.every(run),
        undefined,
        signal,
      ),
    configure: (
      tenant: string,
      id: string,
      body: { requestId: string; expectedRevision: number; schedule: CollectionSchedule },
    ) =>
      request(
        root(tenant) + `/connections/${id}/schedule`,
        'POST',
        (v): v is DataConnection => connection(v) && v.id === id,
        body,
      ),
    update: (tenant: string, id: string, body: { requestId: string; expectedRevision: number }) =>
      request(root(tenant) + `/connections/${id}/update`, 'POST', run, body),
  };
}
export const databaseClient = createDatabaseClient();
