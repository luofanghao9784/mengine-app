import type {
  LifecycleItem,
  LifecyclePreview,
  LifecycleReceipt,
  LifecycleEvent,
  LifecycleTechnical,
  ObjectAction,
  ObjectKind,
} from '../../contracts/public-api/object-lifecycle.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const kinds = [
  'TASK',
  'DOCUMENT',
  'ARTIFACT',
  'EXPERIENCE_VERSION',
  'FEEDBACK_VERSION',
  'EVALUATION_VERSION',
  'EVALUATION_RUN',
  'EXPORT_CACHE',
  'PROFILE_VERSION',
  'METHOD_VERSION',
] as const;
export const states = [
  'ACTIVE',
  'DISABLED',
  'TRASHED',
  'ISOLATED',
  'PURGE_PENDING',
  'PURGE_FAILED',
  'PURGED',
] as const;
export const actions = ['DISABLE', 'ENABLE', 'TRASH', 'RESTORE', 'PURGE', 'RETRY', 'CLASSIFY_TRIAL'] as const;
export const kindLabel: Record<ObjectKind, string> = {
  TASK: '私人任务',
  DOCUMENT: '私人文稿',
  ARTIFACT: '工具产物',
  EXPERIENCE_VERSION: '经验版本',
  FEEDBACK_VERSION: '原始反馈版本',
  EVALUATION_VERSION: '正式评估依据',
  EVALUATION_RUN: '评估记录',
  EXPORT_CACHE: '临时导出缓存',
  PROFILE_VERSION: '档案与偏好版本',
  METHOD_VERSION: '通用方法版本',
};
export const stateLabel: Record<string, string> = {
  ACTIVE: '正常使用',
  DISABLED: '已停用',
  TRASHED: '回收期内',
  ISOLATED: '已隔离',
  PURGE_PENDING: '等待清理',
  PURGE_FAILED: '清理失败',
  PURGED: '在线正文已清理',
};
export const actionLabel: Record<ObjectAction, string> = {
  DISABLE: '停用',
  ENABLE: '明确重新启用',
  TRASH: '移入回收站',
  RESTORE: '恢复为停用',
  PURGE: '永久清理在线正文',
  RETRY: '重试清理',
  CLASSIFY_TRIAL: '按临时试验保留详情',
};
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableText = (v: unknown) => v === null || text(v);
export const isItem = (v: unknown): v is LifecycleItem =>
  record(v) &&
  kinds.includes(v.kind as ObjectKind) &&
  uuid(v.objectId) &&
  (v.workspaceId === null || uuid(v.workspaceId)) &&
  states.some((s) => s === v.state) &&
  integer(v.revision) &&
  text(v.originalAnchor) &&
  typeof v.formal === 'boolean' &&
  nullableText(v.policyKey) &&
  (v.policyRevision === null || integer(v.policyRevision)) &&
  nullableText(v.policyDue) &&
  nullableText(v.purgeAfter) &&
  integer(v.attempts) &&
  nullableText(v.errorCode) &&
  nullableText(v.completedAt) &&
  Array.isArray(v.actions) &&
  v.actions.every((a) => actions.some((x) => x === a)) &&
  ['ONLINE_BODY_ERASED', 'CURRENT_ORIGINAL_ACCESS_REQUIRED', 'NORMAL_ACCESS_BLOCKED'].includes(
    String(v.contentState),
  ) &&
  v.backupState === 'NOT_COVERED_BY_ONLINE_CLEANUP';
export const blockerLabel: Record<string, string> = {
  PROFILE_CURRENT: '当前有效档案版本仍在使用。请先修订或撤回当前版本。',
  PROFILE_TASK_DEPENDENCY: '此档案版本仍被任务作为依据使用，暂不能停用、回收或清理。',
  METHOD_CURRENT: '此版本仍是当前候选或当前发布版本，暂不能停用、回收或清理。',
  METHOD_ACTIVE_ADOPTION: '此版本仍被采用。须先明确停止相关采用。',
  METHOD_COMPARISON_DEPENDENCY: '此版本仍支撑当前有效的比较或采用依据，暂不能清理。',
};
const isPreview = (v: unknown): v is LifecyclePreview =>
  record(v) &&
  isItem(v.object) &&
  text(v.trashDeadline) &&
  nullableText(v.trialDeadline) &&
  typeof v.methodDependency === 'boolean' &&
  Array.isArray(v.blockers) &&
  v.blockers.every((b) => typeof b === 'string' && b.length > 0) &&
  v.irreversible === true &&
  v.independentCopies === 'INDEPENDENT_ENTERPRISE_PUBLICATIONS_SURVIVE';
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createObjectLifecycleClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant?: string) =>
    tenant ? `/api/v1/tenants/${id(tenant)}/object-lifecycle` : '/api/platform-admin/v1/object-lifecycle';
  return {
    list: (
      tenant: string | undefined,
      workspace: string | null,
      kind: ObjectKind | null,
      state: string | null,
      offset = 0,
      signal?: AbortSignal,
    ) =>
      request(
        root(tenant) +
          `?offset=${offset}&limit=20` +
          (workspace ? `&workspace=${id(workspace)}` : '') +
          (kind ? `&kind=${kind}` : '') +
          (state ? `&state=${state}` : ''),
        'GET',
        (v): v is { items: LifecycleItem[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.every((x) => isItem(x) && x.workspaceId === workspace) &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    get: (tenant: string | undefined, kind: ObjectKind, objectId: string, signal?: AbortSignal) =>
      request(
        root(tenant) + `/${kind}/${id(objectId)}`,
        'GET',
        (v): v is LifecyclePreview =>
          isPreview(v) && v.object.kind === kind && v.object.objectId === objectId,
        undefined,
        signal,
      ),
    act: (
      tenant: string | undefined,
      item: LifecycleItem,
      key: string,
      action: ObjectAction,
      irreversibleConfirmed: boolean,
    ) =>
      request(
        root(tenant) + `/${item.kind}/${id(item.objectId)}/actions`,
        'POST',
        (v): v is LifecycleReceipt =>
          record(v) &&
          integer(v.acceptedRevision) &&
          v.receiptStatus === 'EXACT' &&
          isItem(v.current) &&
          v.current.kind === item.kind &&
          v.current.objectId === item.objectId &&
          v.current.workspaceId === item.workspaceId,
        { requestId: key, expectedRevision: item.revision, action, irreversibleConfirmed },
      ),
    history: (
      tenant: string | undefined,
      item: Pick<LifecycleItem, 'kind' | 'objectId'>,
      offset = 0,
      signal?: AbortSignal,
    ) =>
      request(
        root(tenant) + `/${item.kind}/${id(item.objectId)}/history?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: LifecycleEvent[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.every(
            (e) =>
              record(e) &&
              integer(e.revision) &&
              text(e.action) &&
              (e.actorId === null || uuid(e.actorId)) &&
              text(e.createdAt),
          ) &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    technical: (signal?: AbortSignal) =>
      request(
        '/api/platform-admin/v1/object-lifecycle/technical',
        'GET',
        (v): v is LifecycleTechnical[] =>
          Array.isArray(v) &&
          v.every(
            (r) =>
              record(r) &&
              kinds.some((k) => k === r.kind) &&
              states.some((s) => s === r.state) &&
              integer(r.count),
          ),
        undefined,
        signal,
      ),
  };
}
export const objectLifecycleClient = createObjectLifecycleClient();
