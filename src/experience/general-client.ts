import type {
  GeneralExperienceActivity,
  GeneralExperienceVersions,
  GeneralExperienceHistorical,
  GeneralExperienceAdjustmentChange,
  GeneralExperienceAdjustment,
  GeneralExperienceAdjustments,
  GeneralAdjustmentState,
  GeneralExperiencePage,
  GeneralExperienceSuggestionChange,
  GeneralExperienceSuggestion,
  GeneralExperienceSuggestions,
  GeneralExperienceAvailability,
  GeneralExperienceAvailabilityChange,
  GeneralExperienceAvailabilityReceipt,
  GeneralExperienceUsage,
  GeneralExperienceUsageChange,
  GeneralExperienceUsageReceipt,
  GeneralExperienceDetail,
  GeneralExperienceProcessing,
  GeneralMethod,
  GeneralProcessingState,
} from '../../contracts/public-api/general-experience.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
export const generalProcessingLabels: Record<GeneralProcessingState, string> = {
  WAITING: '等待处理',
  PROCESSING: '处理中',
  RETRYING: '等待重试',
  ADMITTED: '已入库',
  DUPLICATE: '无新增',
  NOT_ADMITTED: '未入库',
  UNAVAILABLE: '来源已失效',
  FAILED: '执行失败',
  UNKNOWN: '结果未确认',
};
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const strings = (v: unknown, max: number, length: number) =>
  Array.isArray(v) && v.length > 0 && v.length <= length && v.every((s) => text(s, max));
const method = (v: unknown): v is GeneralMethod =>
  exact(v, ['title', 'summary', 'steps', 'applicable', 'excluded', 'tags', 'basis']) &&
  text(v.title, 160) &&
  text(v.summary, 600) &&
  strings(v.steps, 800, 10) &&
  strings(v.applicable, 300, 8) &&
  strings(v.excluded, 300, 8) &&
  strings(v.tags, 40, 10) &&
  ['OBSERVED_EXECUTION', 'FEEDBACK_CORRECTION'].includes(String(v.basis));
const identity = (v: Record<string, unknown>) =>
  uuid(v.id) &&
  uuid(v.versionId) &&
  count(v.number) &&
  Number(v.number) > 0 &&
  ['AVAILABLE', 'STOPPED'].includes(String(v.status)) &&
  date(v.updatedAt);
export const isGeneralPage = (v: unknown): v is GeneralExperiencePage =>
  exact(v, ['items', 'hasMore']) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(
    (i) =>
      exact(i, ['id', 'versionId', 'number', 'status', 'title', 'summary', 'tags', 'updatedAt']) &&
      identity(i) &&
      text(i.title, 160) &&
      text(i.summary, 600) &&
      strings(i.tags, 40, 10),
  );
export const isGeneralDetail = (v: unknown): v is GeneralExperienceDetail =>
  exact(v, ['id', 'versionId', 'number', 'status', 'method', 'updatedAt']) && identity(v) && method(v.method);
export const isGeneralProcessing = (v: unknown): v is GeneralExperienceProcessing =>
  exact(v, ['enabled', 'counts', 'available', 'stopped', 'withdrawn', 'checkedAt']) &&
  typeof v.enabled === 'boolean' &&
  exact(v.counts, Object.keys(generalProcessingLabels)) &&
  Object.values(v.counts).every(count) &&
  count(v.available) &&
  count(v.stopped) &&
  count(v.withdrawn) &&
  date(v.checkedAt);
export const isGeneralUsage = (v: unknown): v is GeneralExperienceUsage =>
  exact(v, ['entryId', 'versionId', 'enabled', 'usable', 'revision', 'canManage']) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  typeof v.enabled === 'boolean' &&
  count(v.revision) &&
  typeof v.canManage === 'boolean' &&
  typeof v.usable === 'boolean' &&
  (!v.usable || v.enabled);
export const isGeneralUsageReceipt = (v: unknown): v is GeneralExperienceUsageReceipt =>
  exact(v, ['requestId', 'entryId', 'versionId', 'enabled', 'revision']) &&
  uuid(v.requestId) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  typeof v.enabled === 'boolean' &&
  count(v.revision) &&
  Number(v.revision) > 0;
export const isGeneralAvailability = (v: unknown): v is GeneralExperienceAvailability =>
  exact(v, ['entryId', 'versionId', 'status', 'revision', 'reason', 'changedAt']) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  ['AVAILABLE', 'STOPPED'].includes(String(v.status)) &&
  count(v.revision) &&
  Number(v.revision) > 0 &&
  (v.reason === null || text(v.reason, 500)) &&
  date(v.changedAt);
export const isGeneralAvailabilityReceipt = (v: unknown): v is GeneralExperienceAvailabilityReceipt =>
  exact(v, ['requestId', 'entryId', 'versionId', 'status', 'revision']) &&
  uuid(v.requestId) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  ['AVAILABLE', 'STOPPED'].includes(String(v.status)) &&
  count(v.revision) &&
  Number(v.revision) > 1;
export const isGeneralSuggestion = (v: unknown): v is GeneralExperienceSuggestion =>
  exact(v, [
    'id',
    'versionId',
    'workspaceId',
    'intent',
    'state',
    'resultEntryId',
    'resultVersionId',
    'createdAt',
  ]) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  uuid(v.workspaceId) &&
  ['FEEDBACK', 'ADAPTATION'].includes(String(v.intent)) &&
  Object.hasOwn(generalProcessingLabels, String(v.state)) &&
  ((v.resultEntryId === null && v.resultVersionId === null) ||
    (uuid(v.resultEntryId) && uuid(v.resultVersionId))) &&
  date(v.createdAt);
export const isGeneralSuggestions = (v: unknown): v is GeneralExperienceSuggestions =>
  exact(v, ['enabled', 'canSubmit', 'scopes', 'items']) &&
  typeof v.enabled === 'boolean' &&
  typeof v.canSubmit === 'boolean' &&
  Array.isArray(v.scopes) &&
  v.scopes.every((s) => exact(s, ['id', 'name']) && uuid(s.id) && text(s.name, 160)) &&
  Array.isArray(v.items) &&
  v.items.length <= 10 &&
  v.items.every(isGeneralSuggestion);
export const generalAdjustmentLabels: Record<GeneralAdjustmentState, string> = {
  QUEUED: '等待核验',
  RETRY_WAIT: '等待重试',
  RUNNING: '自动核验中',
  UNCERTAIN: '正在核对结果',
  PUBLISHING: '准备发布',
  ADMITTED: '已发布新版本',
  SKIPPED: '无新增',
  REJECTED: '未通过核验',
  FAILED: '执行失败',
  UNKNOWN: '结果未确认',
  UNAVAILABLE: '已失效',
  CONFLICT: '未形成新版本',
};
export const isGeneralAdjustment = (v: unknown): v is GeneralExperienceAdjustment =>
  exact(v, ['id', 'versionId', 'state', 'resultVersionId', 'createdAt']) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  Object.hasOwn(generalAdjustmentLabels, String(v.state)) &&
  (v.resultVersionId === null || (v.state === 'ADMITTED' && uuid(v.resultVersionId))) &&
  date(v.createdAt);
export const isGeneralAdjustments = (v: unknown): v is GeneralExperienceAdjustments =>
  exact(v, ['enabled', 'canSubmit', 'revision', 'currentVersionId', 'items']) &&
  typeof v.enabled === 'boolean' &&
  typeof v.canSubmit === 'boolean' &&
  count(v.revision) &&
  Number(v.revision) > 0 &&
  uuid(v.currentVersionId) &&
  Array.isArray(v.items) &&
  v.items.length <= 10 &&
  v.items.every(isGeneralAdjustment);
export const isGeneralVersions = (v: unknown): v is GeneralExperienceVersions =>
  exact(v, ['entryId', 'currentVersionId', 'items', 'hasMore']) &&
  uuid(v.entryId) &&
  uuid(v.currentVersionId) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(
    (item, i, items) =>
      exact(item, ['versionId', 'number', 'createdAt']) &&
      uuid(item.versionId) &&
      count(item.number) &&
      Number(item.number) > 0 &&
      date(item.createdAt) &&
      (i === 0 || Number(items[i - 1].number) > Number(item.number)),
  ) &&
  new Set(v.items.map((item) => item.versionId)).size === v.items.length;
export const isGeneralHistorical = (v: unknown): v is GeneralExperienceHistorical =>
  exact(v, ['entryId', 'currentVersionId', 'versionId', 'number', 'method', 'createdAt']) &&
  uuid(v.entryId) &&
  uuid(v.currentVersionId) &&
  uuid(v.versionId) &&
  count(v.number) &&
  Number(v.number) > 0 &&
  method(v.method) &&
  date(v.createdAt);
export const isGeneralActivity = (v: unknown): v is GeneralExperienceActivity =>
  exact(v, [
    'entryId',
    'currentVersionId',
    'versionId',
    'scope',
    'referencedAttempts',
    'fullyReadAttempts',
    'assessedAttempts',
    'adoptedAttempts',
    'applicationOutcome',
    'checkedAt',
  ]) &&
  uuid(v.entryId) &&
  uuid(v.currentVersionId) &&
  uuid(v.versionId) &&
  ['PLATFORM_AGGREGATE', 'AUTHORIZED_SHARED_SPACES'].includes(String(v.scope)) &&
  [v.referencedAttempts, v.fullyReadAttempts, v.assessedAttempts, v.adoptedAttempts].every(count) &&
  Number(v.fullyReadAttempts) <= Number(v.referencedAttempts) &&
  Number(v.assessedAttempts) <= Number(v.referencedAttempts) &&
  Number(v.adoptedAttempts) <= Number(v.fullyReadAttempts) &&
  Number(v.adoptedAttempts) <= Number(v.assessedAttempts) &&
  v.applicationOutcome === 'UNKNOWN' &&
  date(v.checkedAt);
export function createGeneralExperienceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const path = (tenant?: string) => {
    if (tenant !== undefined && !uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
    return tenant === undefined
      ? '/api/platform-admin/v1/experience-library'
      : `/api/v1/tenants/${tenant}/general-experiences`;
  };
  return {
    contents: (
      tenant: string | undefined,
      query: string,
      state: string,
      offset: number,
      signal?: AbortSignal,
    ) =>
      request(
        path(tenant) + '?' + new URLSearchParams({ query, state, offset: String(offset) }),
        'GET',
        (v): v is GeneralExperiencePage =>
          isGeneralPage(v) && (tenant === undefined || v.items.every((i) => i.status === 'AVAILABLE')),
        undefined,
        signal,
      ),
    detail: async (tenant: string | undefined, id: string, version: string, signal?: AbortSignal) => {
      if (!uuid(id) || !uuid(version)) throw new IdentityError('INVALID_REQUEST', 400);
      const value = await request(
        path(tenant) + `/${id}?version=${version}`,
        'GET',
        isGeneralDetail,
        undefined,
        signal,
      );
      if (
        value.id !== id ||
        value.versionId !== version ||
        (tenant !== undefined && value.status !== 'AVAILABLE')
      )
        throw new IdentityError('CONTRACT_MISMATCH');
      return value;
    },
    versions: async (
      tenant: string | undefined,
      id: string,
      current: string,
      offset: number,
      signal?: AbortSignal,
    ) => {
      if (![id, current].every(uuid) || !count(offset) || offset > 100000)
        throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        path(tenant) + `/${id}/versions?` + new URLSearchParams({ current, offset: String(offset) }),
        'GET',
        (v): v is GeneralExperienceVersions =>
          isGeneralVersions(v) && v.entryId === id && v.currentVersionId === current,
        undefined,
        signal,
      );
    },
    historical: async (
      tenant: string | undefined,
      id: string,
      current: string,
      version: string,
      signal?: AbortSignal,
    ) => {
      if (![id, current, version].every(uuid)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        path(tenant) + `/${id}/history?` + new URLSearchParams({ current, version }),
        'GET',
        (v): v is GeneralExperienceHistorical =>
          isGeneralHistorical(v) &&
          v.entryId === id &&
          v.currentVersionId === current &&
          v.versionId === version,
        undefined,
        signal,
      );
    },
    activity: async (
      tenant: string | undefined,
      id: string,
      current: string,
      version: string,
      signal?: AbortSignal,
    ) => {
      if (![id, current, version].every(uuid)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        path(tenant) + `/${id}/activity?` + new URLSearchParams({ current, version }),
        'GET',
        (v): v is GeneralExperienceActivity =>
          isGeneralActivity(v) &&
          v.entryId === id &&
          v.currentVersionId === current &&
          v.versionId === version &&
          v.scope === (tenant === undefined ? 'PLATFORM_AGGREGATE' : 'AUTHORIZED_SHARED_SPACES'),
        undefined,
        signal,
      );
    },
    usage: async (tenant: string, id: string, version: string, signal?: AbortSignal) => {
      if (!uuid(tenant) || !uuid(id) || !uuid(version)) throw new IdentityError('INVALID_REQUEST', 400);
      const v = await request(
        path(tenant) + `/${id}/usage?version=${version}`,
        'GET',
        isGeneralUsage,
        undefined,
        signal,
      );
      if (v.entryId !== id || v.versionId !== version) throw new IdentityError('CONTRACT_MISMATCH');
      return v;
    },
    changeUsage: async (tenant: string, id: string, body: GeneralExperienceUsageChange) => {
      if (
        !uuid(tenant) ||
        !uuid(id) ||
        !uuid(body.requestId) ||
        !uuid(body.versionId) ||
        !count(body.expectedRevision) ||
        typeof body.enabled !== 'boolean'
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      const v = await request(path(tenant) + `/${id}/usage`, 'POST', isGeneralUsageReceipt, body);
      if (
        v.entryId !== id ||
        v.versionId !== body.versionId ||
        v.requestId !== body.requestId ||
        v.enabled !== body.enabled ||
        v.revision !== body.expectedRevision + 1
      )
        throw new IdentityError('CONTRACT_MISMATCH');
      return v;
    },
    availability: async (id: string, version: string, signal?: AbortSignal) => {
      if (!uuid(id) || !uuid(version)) throw new IdentityError('INVALID_REQUEST', 400);
      const v = await request(
        path() + `/${id}/availability?version=${version}`,
        'GET',
        isGeneralAvailability,
        undefined,
        signal,
      );
      if (v.entryId !== id || v.versionId !== version) throw new IdentityError('CONTRACT_MISMATCH');
      return v;
    },
    changeAvailability: async (id: string, body: GeneralExperienceAvailabilityChange) => {
      if (
        !uuid(id) ||
        !uuid(body.requestId) ||
        !uuid(body.versionId) ||
        !count(body.expectedRevision) ||
        body.expectedRevision < 1 ||
        !['AVAILABLE', 'STOPPED'].includes(body.status) ||
        !text(body.reason, 500)
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      const v = await request(path() + `/${id}/availability`, 'POST', isGeneralAvailabilityReceipt, body);
      if (
        v.entryId !== id ||
        v.versionId !== body.versionId ||
        v.requestId !== body.requestId ||
        v.status !== body.status ||
        v.revision !== body.expectedRevision + 1
      )
        throw new IdentityError('CONTRACT_MISMATCH');
      return v;
    },
    suggestions: (tenant: string, id: string, version: string, signal?: AbortSignal) => {
      if (![tenant, id, version].every(uuid)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        path(tenant) + `/${id}/suggestions?version=${version}`,
        'GET',
        isGeneralSuggestions,
        undefined,
        signal,
      );
    },
    suggest: async (tenant: string, id: string, body: GeneralExperienceSuggestionChange) => {
      if (
        ![tenant, id, body.requestId, body.versionId, body.workspaceId].every(uuid) ||
        !['FEEDBACK', 'ADAPTATION'].includes(body.intent) ||
        !text(body.content, 12000)
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      try {
        return await request(
          path(tenant) + `/${id}/suggestions`,
          'POST',
          (v): v is GeneralExperienceSuggestion =>
            isGeneralSuggestion(v) &&
            v.versionId === body.versionId &&
            v.workspaceId === body.workspaceId &&
            v.intent === body.intent,
          body,
        );
      } catch (error) {
        if (error instanceof IdentityError && error.code === 'EXPERIENCE_SUGGESTION_PENDING')
          error.message = '这个空间已有补充或反馈正在处理，请等待结果。';
        throw error;
      }
    },
    adjustments: (id: string, version: string, signal?: AbortSignal) => {
      if (![id, version].every(uuid)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        path() + `/${id}/adjustments?version=${version}`,
        'GET',
        (v): v is GeneralExperienceAdjustments =>
          isGeneralAdjustments(v) && (!v.canSubmit || v.currentVersionId === version),
        undefined,
        signal,
      );
    },
    adjust: async (id: string, body: GeneralExperienceAdjustmentChange) => {
      if (
        ![id, body.requestId, body.versionId].every(uuid) ||
        !count(body.expectedRevision) ||
        body.expectedRevision < 1 ||
        !text(body.content, 12000)
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      try {
        return await request(
          path() + `/${id}/adjustments`,
          'POST',
          (v): v is GeneralExperienceAdjustment => isGeneralAdjustment(v) && v.versionId === body.versionId,
          body,
        );
      } catch (error) {
        if (error instanceof IdentityError && error.code === 'GENERAL_ADJUSTMENT_PENDING')
          error.message = '这条经验已有调整正在自动处理，请等待结果。';
        throw error;
      }
    },
    processing: (signal?: AbortSignal) =>
      request(path() + '/processing', 'GET', isGeneralProcessing, undefined, signal),
  };
}
export const generalExperienceClient = createGeneralExperienceClient();
