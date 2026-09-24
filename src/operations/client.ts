import type { OperationsDays, OperationsOverview } from '../../contracts/public-api/operations.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
export const errorLabels = {
  TASK_SOURCE_UNAVAILABLE: '资料授权已变化',
  TASK_RUNTIME_INCOMPATIBLE: '引擎协议不兼容',
  TASK_RUNTIME_UNAVAILABLE: '引擎连接不可用',
  TASK_MODEL_FAILED: '模型请求未完成',
  TASK_LIMIT: '任务达到执行上限',
  TASK_TOOL_FAILED: '工具执行未完成',
  MODEL_NOT_CONFIGURED: '模型尚未配置',
  PUBLIC_WEB_NOT_CONFIGURED: '公开检索尚未配置',
  TASK_FILE_UNSUPPORTED: '文件格式暂不支持',
  TASK_FILE_ENCODING: '文件编码无法识别',
  TASK_FILE_INVALID: '文件结构无法读取',
  TASK_FILE_LIMIT: '文件超过处理上限',
  TASK_FILE_DATA: '文件数据不符合处理要求',
  TASK_INTERRUPTED: '执行进程中断',
  OTHER: '其他运行异常',
} as const;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const shape = (v: unknown, fields: string): v is Record<string, unknown> =>
  record(v) && Object.keys(v).sort().join(',') === fields.split(' ').sort().join(',');
export function isOperations(v: unknown): v is OperationsOverview {
  if (
    !shape(v, 'tenantId days from checkedAt tasks storage models errors') ||
    !(v.tenantId === null || uuid(v.tenantId)) ||
    ![7, 30].includes(Number(v.days)) ||
    typeof v.days !== 'number' ||
    !date(v.from) ||
    !date(v.checkedAt) ||
    Date.parse(v.checkedAt) - Date.parse(v.from) !== v.days * 86400000 ||
    !shape(v.tasks, 'total queued running succeeded failed cancelled interrupted retryStarts') ||
    !Object.values(v.tasks).every(count) ||
    !shape(v.storage, 'materials versions originalBytes') ||
    !Object.values(v.storage).every(count) ||
    !Array.isArray(v.models) ||
    v.models.length > 2 ||
    !Array.isArray(v.errors) ||
    v.errors.length > 15
  )
    return false;
  const tasks = v.tasks as OperationsOverview['tasks'];
  if (
    tasks.total !==
    tasks.queued + tasks.running + tasks.succeeded + tasks.failed + tasks.cancelled + tasks.interrupted
  )
    return false;
  const classes = new Set(),
    codes = new Set();
  let successes = 0,
    failures = 0;
  for (const m of v.models) {
    if (
      !shape(m, 'executionClass succeededTasks reportedTasks modelCalls inputTokens outputTokens') ||
      !['live', 'verification'].includes(String(m.executionClass)) ||
      classes.has(m.executionClass) ||
      !count(m.succeededTasks) ||
      !count(m.reportedTasks) ||
      !count(m.modelCalls) ||
      m.reportedTasks > m.succeededTasks ||
      m.succeededTasks < 1 ||
      (m.reportedTasks === 0
        ? m.inputTokens !== null || m.outputTokens !== null
        : !count(m.inputTokens) || !count(m.outputTokens))
    )
      return false;
    classes.add(m.executionClass);
    successes += m.succeededTasks;
  }
  for (const e of v.errors) {
    if (
      !shape(e, 'code tasks lastOccurredAt') ||
      typeof e.code !== 'string' ||
      !Object.hasOwn(errorLabels, e.code) ||
      codes.has(e.code) ||
      !count(e.tasks) ||
      e.tasks < 1 ||
      !date(e.lastOccurredAt)
    )
      return false;
    codes.add(e.code);
    failures += e.tasks;
  }
  return successes <= tasks.succeeded && failures === tasks.failed + tasks.interrupted;
}
export function createOperationsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return async (
    scope: 'platform' | 'tenant',
    tenant: string | null,
    days: OperationsDays,
    signal?: AbortSignal,
  ) => {
    if (
      !(tenant === null || uuid(tenant)) ||
      (scope === 'tenant' && tenant === null) ||
      ![7, 30].includes(days)
    )
      throw new IdentityError('INVALID_REQUEST', 400);
    const prefix = scope === 'platform' ? '/api/platform-admin/v1' : '/api/tenant-admin/v1';
    return request(
      `${prefix}${tenant ? `/tenants/${tenant}` : ''}/operations?days=${days}`,
      'GET',
      (v): v is OperationsOverview => isOperations(v) && v.tenantId === tenant && v.days === days,
      undefined,
      signal,
    );
  };
}
export const getOperations = createOperationsClient();
