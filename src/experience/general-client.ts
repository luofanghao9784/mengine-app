import type {
  GeneralExperiencePage,
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
  exact(v, ['entryId', 'versionId', 'enabled', 'revision', 'canManage']) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  typeof v.enabled === 'boolean' &&
  count(v.revision) &&
  typeof v.canManage === 'boolean';
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
    processing: (signal?: AbortSignal) =>
      request(path() + '/processing', 'GET', isGeneralProcessing, undefined, signal),
  };
}
export const generalExperienceClient = createGeneralExperienceClient();
