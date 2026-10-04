import type {
  ActOnPlan,
  CreatePlan,
  Plan,
  PlanConfiguration,
  PlanConfigurationVersion,
  PlanPage,
  PlanRuns,
  UpdatePlan,
} from '../../contracts/public-api/plans.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const statusLabels = {
  DRAFT: '待启用',
  ACTIVE: '已启用',
  PAUSED: '已暂停',
  STOPPED: '已停止',
  EXPIRED: '已到期',
  AUTHORIZATION_REQUIRED: '需重新启用',
} as const;
export const runtimeLabels = {
  IDLE: '尚未调度',
  WAITING_TIME: '等待约定触发',
  WAITING_DATA: '等待资料',
  WAITING_CAPABILITY: '等待执行能力',
  WAITING_RESOURCE: '等待资源额度',
  RUNNING: '本次检查进行中',
  NEEDS_ATTENTION: '需要处理',
} as const;
export const reasonLabels: Record<string, string> = {
  TENANT_SERVICE_SUSPENDED: '企业服务暂停，后续调度暂缓。',
  NO_NEW_VERSION: '当前没有新增资料版本。',
  NO_MATERIALS: '当前范围还没有资料，补交后会继续检查。',
  MATERIALS_NOT_READY: '资料尚未形成可检索内容。',
  SOURCE_REQUIRES_ATTENTION: '资料解析失败、不受支持或已取消，请在资料库核对来源状态。',
  MODEL_NOT_CONFIGURED: '模型尚未连接；委托已保存，未生成分析结果，也未消耗运行次数。',
  TASK_RUNTIME_UNAVAILABLE: '任务执行服务未启用；委托保留等待。',
  MINIMUM_INTERVAL: '等待约定的最短检查间隔。',
  DAILY_RUN_LIMIT: '本计划今天的运行次数已用完。',
  TOTAL_RUN_LIMIT: '本计划总运行次数已用完，可暂停后调整委托或停止。',
  OWNER_DAILY_LIMIT: '本人计划的当日总次数已达系统上限。',
  OWNER_CONCURRENCY_LIMIT: '本人已有两次计划检查正在排队或运行。',
  SOURCE_COUNT_LIMIT: '资料范围超过本版一次核查的 1000 份上限，需要收窄范围。',
  AUTHORIZATION_REVOKED: '此前的范围或身份授权已失效。权限恢复后仍需明确重新启用。',
  TASK_NEEDS_ATTENTION: '请查看本次任务的真实等待、失败或部分完成情况。',
  PLAN_EXPIRED: '已到约定的结束时间，后续检查已停止。',
  TRIGGER_ALREADY_ACCEPTED: '这一触发已有运行记录。',
};
const stamp = (v: unknown) => v === null || (text(v) && Number.isFinite(Date.parse(v)));
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
export const isConfiguration = (v: unknown): v is PlanConfiguration =>
  record(v) &&
  uuid(v.workspaceId) &&
  text(v.goal) &&
  text(v.purpose) &&
  text(v.query) &&
  ['SOURCE_LOOKUP', 'ANALYZE'].includes(String(v.behavior)) &&
  typeof v.materialEvents === 'boolean' &&
  (v.dailyTime === null || (text(v.dailyTime) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.dailyTime))) &&
  text(v.timeZone) &&
  integer(v.minIntervalSeconds, 60) &&
  integer(v.maxRunsPerDay, 1) &&
  integer(v.maxTotalRuns, 1) &&
  text(v.expiresAt) &&
  stamp(v.expiresAt) &&
  typeof v.notificationsEnabled === 'boolean';
export const isPlan = (v: unknown): v is Plan =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.ownerId) &&
  integer(v.revision, 1) &&
  integer(v.executionEpoch) &&
  Object.hasOwn(statusLabels, String(v.status)) &&
  Object.hasOwn(runtimeLabels, String(v.runtimeState)) &&
  (v.reason === null || text(v.reason)) &&
  isConfiguration(v.configuration) &&
  stamp(v.nextDue) &&
  stamp(v.lastDispatchedAt) &&
  stamp(v.checkedAt) &&
  integer(v.runs) &&
  integer(v.todayRuns);
const id = (value: string) => {
  if (!uuid(value)) throw new IdentityError('INVALID_REQUEST', 400);
  return value;
};
export function createPlanClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/plans`;
  const own =
    (tenant: string, owner: string, plan?: string) =>
    (v: unknown): v is Plan =>
      isPlan(v) && v.tenantId === tenant && v.ownerId === owner && (plan === undefined || v.id === plan);
  return {
    version: (tenant: string, plan: string, revision: number, signal?: AbortSignal) =>
      request(
        root(tenant) + '/' + id(plan) + `/versions/${revision}`,
        'GET',
        (v): v is PlanConfigurationVersion =>
          record(v) &&
          v.planId === plan &&
          v.revision === revision &&
          isConfiguration(v.configuration) &&
          text(v.createdAt) &&
          stamp(v.createdAt),
        undefined,
        signal,
      ),
    list: (tenant: string, owner: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `?offset=${offset}&limit=20`,
        'GET',
        (v): v is PlanPage =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every(own(tenant, owner)),
        undefined,
        signal,
      ),
    get: (tenant: string, owner: string, plan: string, signal?: AbortSignal) =>
      request(root(tenant) + '/' + id(plan), 'GET', own(tenant, owner, plan), undefined, signal),
    create: (tenant: string, owner: string, body: CreatePlan) =>
      request(root(tenant), 'POST', own(tenant, owner), body),
    update: (tenant: string, owner: string, plan: string, body: UpdatePlan) =>
      request(root(tenant) + '/' + id(plan), 'PUT', own(tenant, owner, plan), body),
    action: (tenant: string, owner: string, plan: string, body: ActOnPlan) =>
      request(root(tenant) + '/' + id(plan) + '/actions', 'POST', own(tenant, owner, plan), body),
    runs: (tenant: string, plan: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + '/' + id(plan) + `/runs?offset=${offset}&limit=20`,
        'GET',
        (v): v is PlanRuns =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every(
            (r) =>
              record(r) &&
              uuid(r.id) &&
              r.planId === plan &&
              integer(r.planRevision, 1) &&
              integer(r.executionEpoch) &&
              ['MATERIAL_VERSION', 'DAILY', 'RETRY'].includes(String(r.triggerKind)) &&
              stamp(r.scheduledFor) &&
              integer(r.missedSlots) &&
              integer(r.eventThrough) &&
              uuid(r.conversationId) &&
              uuid(r.taskId) &&
              text(r.status) &&
              (r.errorCode === null || text(r.errorCode)) &&
              text(r.createdAt) &&
              stamp(r.createdAt) &&
              stamp(r.finishedAt) &&
              Array.isArray(r.sourceVersions) &&
              r.sourceVersions.every(
                (s) => record(s) && uuid(s.materialId) && uuid(s.versionId) && text(s.parseStatus),
              ),
          ),
        undefined,
        signal,
      ),
  };
}
export const planClient = createPlanClient();
