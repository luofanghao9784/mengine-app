import type {
  BusinessSource,
  SourceSettings,
  SourceSubmission,
  SourceConfigVersion,
} from '../../contracts/public-api/source.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const string = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && value.length <= max && (empty || value.length > 0);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const instant = (value: unknown): value is string => string(value, 50) && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown) => value === null || instant(value);
export function isDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export const isSourceSettings = (value: unknown): value is SourceSettings =>
  record(value) &&
  uuid(value.responsibleId) &&
  string(value.name, 160) &&
  string(value.description, 2000, true) &&
  (value.cadenceHours === null ||
    (integer(value.cadenceHours) && value.cadenceHours >= 1 && value.cadenceHours <= 8760)) &&
  ((value.expectedFrom === null && value.expectedThrough === null) ||
    (isDate(value.expectedFrom) &&
      isDate(value.expectedThrough) &&
      value.expectedFrom <= value.expectedThrough)) &&
  ['ACTIVE', 'PAUSED'].includes(String(value.status));
export const isBusinessSource = (value: unknown): value is BusinessSource =>
  record(value) &&
  isSourceSettings(value) &&
  uuid(value.id) &&
  uuid(value.tenantId) &&
  uuid(value.workspaceId) &&
  integer(value.revision) &&
  ['UNKNOWN', 'MISSING', 'GAP', 'DECLARED'].includes(String(value.coverageState)) &&
  nullableInstant(value.lastSubmittedAt) &&
  nullableInstant(value.dueAt) &&
  typeof value.overdue === 'boolean' &&
  typeof value.canMaintain === 'boolean' &&
  instant(value.updatedAt);
export const isConfigVersion = (value: unknown): value is SourceConfigVersion =>
  record(value) &&
  integer(value.revision) &&
  isSourceSettings(value.settings) &&
  uuid(value.changedBy) &&
  instant(value.effectiveAt);
export const isSourceSubmission = (value: unknown): value is SourceSubmission =>
  record(value) &&
  uuid(value.id) &&
  uuid(value.sourceId) &&
  uuid(value.submittedBy) &&
  integer(value.revision) &&
  isDate(value.coverageFrom) &&
  isDate(value.coverageThrough) &&
  value.coverageFrom <= value.coverageThrough &&
  string(value.note, 2000, true) &&
  ['ACTIVE', 'WITHDRAWN'].includes(String(value.status)) &&
  instant(value.submittedAt) &&
  Array.isArray(value.versions) &&
  integer(value.unavailableVersions) &&
  value.versions.length + (value.unavailableVersions as number) > 0 &&
  value.versions.length + (value.unavailableVersions as number) <= 100 &&
  value.versions.every(
    (v) =>
      record(v) &&
      uuid(v.materialId) &&
      uuid(v.versionId) &&
      integer(v.number) &&
      v.number > 0 &&
      string(v.filename, 180) &&
      typeof v.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(v.sha256),
  ) &&
  new Set(value.versions.map((v) => v.versionId)).size === value.versions.length;
const messages: Record<string, string> = {
  SOURCE_NOT_FOUND: '此来源不存在，或你已没有访问权限。',
  SOURCE_VERSION_UNAVAILABLE: '所选版本已不可访问，或不属于当前空间。请重新选择。',
  SOURCE_STATE_CHANGED: '来源或补交声明已更新。请保留填写内容，返回详情核对最新状态后再编辑。',
  SOURCE_PAUSED: '来源已暂停。恢复来源后才能登记新的补交声明。',
};
const id = (value: string) => {
  if (!uuid(value)) throw new IdentityError('INVALID_REQUEST', 400);
  return value;
};
export function createSourceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const send: typeof request = async (...args) => {
    try {
      return await request(...args);
    } catch (error) {
      if (error instanceof IdentityError && messages[error.code]) error.message = messages[error.code];
      throw error;
    }
  };
  const root = (tenant: string, workspace: string) =>
    `/api/v1/tenants/${id(tenant)}/workspaces/${id(workspace)}/sources`;
  const scoped =
    (tenant: string, workspace: string, source?: string) =>
    (value: unknown): value is BusinessSource =>
      isBusinessSource(value) &&
      value.tenantId === tenant &&
      value.workspaceId === workspace &&
      (!source || value.id === source);
  const submission =
    (source: string, submissionId?: string) =>
    (value: unknown): value is SourceSubmission =>
      isSourceSubmission(value) && value.sourceId === source && (!submissionId || value.id === submissionId);
  return {
    list(tenant: string, workspace: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(tenant, workspace) + `?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: BusinessSource[]; hasMore: boolean } =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(scoped(tenant, workspace)) &&
          new Set(v.items.map((item) => item.id)).size === v.items.length,
        undefined,
        signal,
      );
    },
    get(tenant: string, workspace: string, source: string, signal?: AbortSignal) {
      return send(
        root(tenant, workspace) + '/' + id(source),
        'GET',
        scoped(tenant, workspace, source),
        undefined,
        signal,
      );
    },
    history(tenant: string, workspace: string, source: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(tenant, workspace) + '/' + id(source) + `/versions?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: SourceConfigVersion[]; hasMore: boolean } =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(isConfigVersion) &&
          new Set(v.items.map((item) => item.revision)).size === v.items.length,
        undefined,
        signal,
      );
    },
    create(
      tenant: string,
      workspace: string,
      body: { requestId: string; settings: SourceSettings },
      signal?: AbortSignal,
    ) {
      return send(root(tenant, workspace), 'POST', scoped(tenant, workspace), body, signal);
    },
    update(
      tenant: string,
      workspace: string,
      source: string,
      body: { requestId: string; expectedRevision: number; settings: SourceSettings },
      signal?: AbortSignal,
    ) {
      return send(
        root(tenant, workspace) + '/' + id(source),
        'POST',
        scoped(tenant, workspace, source),
        body,
        signal,
      );
    },
    submissions(tenant: string, workspace: string, source: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(tenant, workspace) + '/' + id(source) + `/submissions?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: SourceSubmission[]; hasMore: boolean } =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(submission(source)) &&
          new Set(v.items.map((item) => item.id)).size === v.items.length,
        undefined,
        signal,
      );
    },
    submit(
      tenant: string,
      workspace: string,
      source: string,
      body: {
        requestId: string;
        coverageFrom: string;
        coverageThrough: string;
        note: string;
        versionIds: string[];
      },
      signal?: AbortSignal,
    ) {
      return send(
        root(tenant, workspace) + '/' + id(source) + '/submissions',
        'POST',
        submission(source),
        body,
        signal,
      );
    },
    withdraw(
      tenant: string,
      workspace: string,
      source: string,
      submissionId: string,
      body: { requestId: string; expectedRevision: number },
      signal?: AbortSignal,
    ) {
      return send(
        root(tenant, workspace) + '/' + id(source) + '/submissions/' + id(submissionId) + '/withdraw',
        'POST',
        submission(source, submissionId),
        body,
        signal,
      );
    },
  };
}
export const sourceClient = createSourceClient();
