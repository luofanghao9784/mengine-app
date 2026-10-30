const enterpriseFunctions = [
  'document-parse',
  'table-compare',
  'quality-check',
  'semantic-annotation',
  'repair-suggestion',
] as const;

export type Capability = {
  capabilityId: string;
  name: string;
  enterpriseFunction?: (typeof enterpriseFunctions)[number];
  kind?: 'quality_check';
};

export type CapabilityListResult =
  | { status: 'ok'; items: Capability[] }
  | { status: 'empty' }
  | { status: 'unauthenticated' }
  | { status: 'failed' };

function isCapability(value: unknown): value is Capability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    nonemptyString(item.capabilityId) &&
    nonemptyString(item.name) &&
    (!('enterpriseFunction' in item) ||
      enterpriseFunctions.some((name) => name === item.enterpriseFunction)) &&
    (!('kind' in item) || item.kind === 'quality_check')
  );
}

export async function listCapabilities(signal: AbortSignal): Promise<CapabilityListResult> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  try {
    const response = await fetch('/api/agent-admin/v1/capabilities', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: requestSignal,
    });
    if (requestSignal.aborted) return { status: 'failed' };
    if (response.status === 401) return { status: 'unauthenticated' };
    if (response.status !== 200) return { status: 'failed' };
    const body: unknown = await response.json();
    if (requestSignal.aborted || !Array.isArray(body) || !body.every(isCapability)) {
      return { status: 'failed' };
    }
    return body.length ? { status: 'ok', items: body } : { status: 'empty' };
  } catch {
    return { status: 'failed' };
  }
}

const grantFailure = '这次没有开通成功';
const grantMessages = new Set([
  '请按要求填写开通内容',
  '有无法识别的字段，请检查后再提交',
  '没有这个企业，不能开通',
  '还没有这项登记，请先登记再开通',
  '已经开通过了，不能改成另一项',
]);

function grantError(status: number, body: unknown): string {
  if (status === 401) return '还没有登录，请先登录后再试';
  if (status === 403) return '登录校验未通过，请刷新页面后再试';
  if ([400, 404, 409].includes(status) && body && typeof body === 'object') {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && grantMessages.has(message)) return message;
  }
  return grantFailure;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function createCapabilityTenantGrant(tenantId: string): Promise<string> {
  const enterprise = tenantId.trim();
  if (!enterprise) return '请按要求填写开通内容';
  try {
    const csrfResponse = await fetch('/api/agent-admin/v1/auth/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const csrf: unknown = await csrfResponse.json().catch(() => null);
    if (!csrfResponse.ok) return grantError(csrfResponse.status, csrf);
    if (!csrf || typeof csrf !== 'object') return grantFailure;
    const { headerName, token } = csrf as Record<string, unknown>;
    if (!nonemptyString(headerName) || !nonemptyString(token)) return grantFailure;

    const response = await fetch(`/api/agent-admin/v1/tenants/${encodeURIComponent(enterprise)}/grants`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [headerName]: token,
      },
      body: JSON.stringify({ capabilityId: 'quality-check', enterpriseFunction: 'quality-check' }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 201 && response.status !== 200) {
      return grantError(response.status, body);
    }
    if (!body || typeof body !== 'object') return grantFailure;
    const grant = body as Record<string, unknown>;
    if (
      !['tenantId', 'capabilityId', 'enterpriseFunction', 'grantedAt'].every((field) =>
        nonemptyString(grant[field]),
      )
    )
      return grantFailure;
    return response.status === 201 ? '已开通给这家企业' : '已开通';
  } catch {
    return grantFailure;
  }
}
