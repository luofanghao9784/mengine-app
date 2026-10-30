import { createIdentityRequest, IdentityError } from './client.ts';
import { withTimeout } from '../shared/abort-timeout.ts';

export type QualityCheckResult = {
  taskId: string;
  status: 'COMPLETED';
  result: {
    verdict: 'NO_ISSUES' | 'ISSUES_FOUND';
    issues: { message: string }[];
  };
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function isQualityCheckResult(value: unknown): value is QualityCheckResult {
  if (
    !record(value) ||
    typeof value.taskId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.taskId) ||
    value.status !== 'COMPLETED' ||
    !record(value.result)
  )
    return false;
  const { verdict, issues } = value.result;
  return (
    Array.isArray(issues) &&
    issues.every(
      (issue: unknown) =>
        record(issue) && typeof issue.message === 'string' && issue.message.trim().length > 0,
    ) &&
    ((verdict === 'NO_ISSUES' && issues.length === 0) || (verdict === 'ISSUES_FOUND' && issues.length > 0))
  );
}

// The shared request validates payloads but accepts all 2xx statuses. This endpoint requires 201.
const request = createIdentityRequest(async (input, init) => {
  const response = await fetch(input, init);
  if (init?.method === 'POST' && response.ok && response.status !== 201)
    throw new IdentityError('CONTRACT_MISMATCH');
  return response;
});

export function submitQualityCheck(
  materialText: string,
  title?: string,
  signal?: AbortSignal,
): Promise<QualityCheckResult> {
  if (!materialText.trim() || materialText.length > 20_000 || (title?.length ?? 0) > 200)
    return Promise.reject(new IdentityError('INVALID_REQUEST', 400));
  return request(
    '/api/tenant-admin/v1/quality-ops/check-tasks',
    'POST',
    isQualityCheckResult,
    { materialText, ...(title ? { title } : {}) },
    withTimeout(signal, 10_000),
  );
}

export const qualityCheckNotOpened = '贵企业还没开通「质量检查」，请联系平台管理员开通';

export function qualityCheckFailureMessage(error: unknown): string {
  if (error instanceof IdentityError) {
    if (error.status === 400) return '内容不符合要求';
    if (error.status === 401) return '请重新登录后再试';
    if (error.status === 403)
      return error.code === 'CAPABILITY_NOT_OPENED' ? qualityCheckNotOpened : '请刷新页面后再试';
    if (error.status === 404) return '暂时不能查看已开通功能';
  }
  return '质量检查暂时不可用，请稍后再试';
}
