import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import type {
  LifecycleItem,
  LifecyclePreview,
  LifecycleReceipt,
  CleanupStatus,
  MaterialObjectKind,
  LifecycleAction,
} from '../../contracts/public-api/lifecycle.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableTime = (v: unknown) => v === null || instant(v);
const nullableId = (v: unknown) => v === null || uuid(v);
const kind = (v: unknown) => v === 'MATERIAL' || v === 'FOLDER';
const state = (v: unknown) => ['ACTIVE', 'TRASHED', 'PURGING', 'PURGED'].includes(String(v));
const action = (v: unknown) => ['TRASH', 'RESTORE', 'PURGE', 'RETRY_CLEANUP'].includes(String(v));
export const isLifecycleItem = (v: unknown): v is LifecycleItem =>
  record(v) &&
  uuid(v.id) &&
  kind(v.kind) &&
  typeof v.name === 'string' &&
  state(v.state) &&
  count(v.revision) &&
  nullableTime(v.trashedAt) &&
  nullableTime(v.purgeAfter) &&
  nullableId(v.cleanupJobId) &&
  typeof v.canPurge === 'boolean';
export const isLifecycleReceipt = (v: unknown): v is LifecycleReceipt =>
  record(v) &&
  uuid(v.objectId) &&
  kind(v.kind) &&
  action(v.action) &&
  state(v.resultingState) &&
  count(v.revision) &&
  instant(v.occurredAt) &&
  nullableTime(v.purgeAfter) &&
  nullableId(v.cleanupJobId);
export const isCleanup = (v: unknown): v is CleanupStatus =>
  record(v) &&
  uuid(v.id) &&
  ['QUEUED', 'CLEANING', 'FAILED', 'COMPLETE'].includes(String(v.state)) &&
  count(v.revision) &&
  count(v.attempts) &&
  (v.errorCode === null || typeof v.errorCode === 'string') &&
  count(v.originals) &&
  count(v.originalsRemoved) &&
  v.originalsRemoved <= v.originals &&
  nullableTime(v.completedAt) &&
  v.backupState === 'NOT_COVERED_BY_ONLINE_CLEANUP';
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createLifecycleClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const base = (tenant: string, workspace: string) =>
    `/api/v1/tenants/${id(tenant)}/workspaces/${id(workspace)}/lifecycle`;
  const object = (k: MaterialObjectKind, oid: string) => {
    if (!kind(k)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/${k}/${id(oid)}`;
  };
  return {
    list: (tenant: string, workspace: string, offset = 0, signal?: AbortSignal) =>
      request(
        base(tenant, workspace) + `?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: LifecycleItem[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.every(isLifecycleItem) &&
          new Set(v.items.map((x) => x.kind + x.id)).size === v.items.length &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    preview: (tenant: string, workspace: string, k: MaterialObjectKind, oid: string, signal?: AbortSignal) =>
      request(
        base(tenant, workspace) + object(k, oid),
        'GET',
        (v): v is LifecyclePreview =>
          record(v) &&
          isLifecycleItem(v.item) &&
          v.item.id === oid &&
          v.item.kind === k &&
          count(v.documents) &&
          count(v.versions) &&
          count(v.folders) &&
          v.restoration === 'CURRENT_PERMISSIONS_NO_TASK_RESTART',
        undefined,
        signal,
      ),
    act: (
      tenant: string,
      workspace: string,
      k: MaterialObjectKind,
      oid: string,
      body: { requestId: string; expectedRevision: number; action: LifecycleAction },
      signal?: AbortSignal,
    ) =>
      request(
        base(tenant, workspace) + object(k, oid),
        'POST',
        (v): v is LifecycleReceipt =>
          isLifecycleReceipt(v) && v.objectId === oid && v.kind === k && v.action === body.action,
        body,
        signal,
      ),
    cleanup: (tenant: string, workspace: string, job: string, signal?: AbortSignal) =>
      request(
        base(tenant, workspace) + `/cleanup/${id(job)}`,
        'GET',
        (v): v is CleanupStatus => isCleanup(v) && v.id === job,
        undefined,
        signal,
      ),
  };
}
export const lifecycleClient = createLifecycleClient();
