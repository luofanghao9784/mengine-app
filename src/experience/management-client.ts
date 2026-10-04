import type {
  ExperienceHistory,
  ExperienceContentPage,
  ExperienceProcessingPage,
  ExperienceProcessingState,
} from '../../contracts/public-api/experience-management.ts';
import { createIdentityRequest, record, uuid } from '../identity/client.ts';
import { isSummary } from './client.ts';
export const processingLabels: Record<ExperienceProcessingState, string> = {
  WAITING: '等待处理',
  PROCESSING: '处理中',
  RETRYING: '等待重试',
  ADMITTED: '已入库',
  UPDATED: '已更新',
  DUPLICATE: '无新增',
  NOT_ADMITTED: '未入库',
  UNAVAILABLE: '来源已失效',
  FAILED: '执行失败',
  UNKNOWN: '结果未确认',
};
export const reasonLabels: Record<string, string> = {
  DUPLICATE: '已有相同经验',
  NO_REUSABLE_METHOD: '没有新增可复用方法',
  PREFERENCE_ONLY: '属于个人表达偏好',
  PRODUCT_ISSUE: '属于产品问题',
  INSUFFICIENT_EVIDENCE: '缺少充分依据',
  QUALITY_NOT_ESTABLISHED: '未达到自动入库要求',
  EXPERIENCE_TARGET_VERSION_UNAVAILABLE: '暂时无法重建对应版本',
  MODEL_NOT_CONFIGURED: '运行服务尚未就绪',
  EXPERIENCE_VERIFICATION_ONLY: '验证运行，不形成正式经验',
  EXPERIENCE_RESULT_UNKNOWN: '执行结果尚未确认',
  VERSION_CONFLICT: '版本已变化或内容不符合入库条件',
  TECHNICAL_FAILURE: '技术执行未完成',
};
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const scopes = (v: unknown) =>
  Array.isArray(v) && v.every((s) => record(s) && uuid(s.id) && typeof s.name === 'string');
export const isContentPage = (v: unknown): v is ExperienceContentPage =>
  record(v) &&
  scopes(v.scopes) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(
    (i) =>
      record(i) &&
      isSummary(i.experience) &&
      ['PUBLISHED', 'WITHDRAWN'].includes(i.experience.status) &&
      uuid(i.workspaceId) &&
      typeof i.workspaceName === 'string' &&
      date(i.updatedAt),
  );
export const isProcessingPage = (v: unknown): v is ExperienceProcessingPage =>
  record(v) &&
  typeof v.enabled === 'boolean' &&
  scopes(v.scopes) &&
  typeof v.hasMore === 'boolean' &&
  record(v.counts) &&
  Object.keys(v.counts).length === Object.keys(processingLabels).length &&
  Object.keys(processingLabels).every(
    (k) => record(v.counts) && Number.isSafeInteger(v.counts[k]) && Number(v.counts[k]) >= 0,
  ) &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(
    (i) =>
      record(i) &&
      uuid(i.id) &&
      ['TASK', 'FEEDBACK', 'ADJUSTMENT', 'GENERAL_SUGGESTION'].includes(String(i.sourceKind)) &&
      String(i.state) in processingLabels &&
      (i.reason === null || (typeof i.reason === 'string' && i.reason in reasonLabels)) &&
      date(i.updatedAt) &&
      uuid(i.workspaceId) &&
      ((i.entryId === null && i.versionId === null) || (uuid(i.entryId) && uuid(i.versionId))) &&
      Object.keys(i).every((k) =>
        ['id', 'sourceKind', 'state', 'reason', 'updatedAt', 'entryId', 'versionId', 'workspaceId'].includes(
          k,
        ),
      ),
  );
export function createExperienceManagementClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const url = (
    tenant: string,
    part: string,
    workspace: string,
    state: string,
    offset: number,
    query = '',
  ) => {
    if (!uuid(tenant) || (workspace && !uuid(workspace))) throw new Error('Invalid scope');
    const params = new URLSearchParams({ state, offset: String(offset), query });
    if (workspace) params.set('workspace', workspace);
    return `/api/v1/tenants/${tenant}/experience-library${part}?${params}`;
  };
  return {
    history: (tenant: string, workspace: string, entry: string, offset = 0, signal?: AbortSignal) => {
      if (!uuid(entry)) throw new Error('Invalid entry');
      return request(
        url(tenant, '/' + entry + '/history', workspace, 'ALL', offset),
        'GET',
        (v): v is ExperienceHistory =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (i) =>
              record(i) &&
              uuid(i.id) &&
              Number.isSafeInteger(i.number) &&
              Number(i.number) > 0 &&
              date(i.createdAt) &&
              typeof i.current === 'boolean' &&
              ((i.origin === 'MANUAL' && i.evaluation === 'NOT_EVALUATED') ||
                (i.origin === 'AUTOMATIC' && i.evaluation === 'AUTOMATIC_CHECKED')),
          ),
        undefined,
        signal,
      );
    },
    contents: (
      tenant: string,
      workspace = '',
      query = '',
      state = 'AVAILABLE',
      offset = 0,
      signal?: AbortSignal,
    ) => request(url(tenant, '', workspace, state, offset, query), 'GET', isContentPage, undefined, signal),
    processing: (tenant: string, workspace = '', state = 'ALL', offset = 0, signal?: AbortSignal) =>
      request(
        url(tenant, '/processing', workspace, state, offset),
        'GET',
        isProcessingPage,
        undefined,
        signal,
      ),
  };
}
export const experienceManagementClient = createExperienceManagementClient();
