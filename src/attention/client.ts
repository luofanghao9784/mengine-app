import type { AttentionItem, AttentionPage } from '../../contracts/public-api/attention';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export const isItem = (v: unknown): v is AttentionItem =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName) &&
  v.workspaceName.length <= 200 &&
  text(v.title) &&
  v.title.length <= 200 &&
  text(v.instruction) &&
  v.instruction.length <= 200 &&
  text(v.actionLabel) &&
  v.actionLabel.length <= 50 &&
  count(v.revision) &&
  (v.dueAt === null || date(v.dueAt)) &&
  date(v.changedAt) &&
  (v.kind === 'TASK'
    ? uuid(v.conversationId) && ['WAITING_INPUT', 'PARTIAL', 'RESULT_UNKNOWN'].includes(String(v.state))
    : v.kind === 'SOURCE'
      ? v.conversationId === null && ['OVERDUE', 'MISSING_DATA'].includes(String(v.state))
      : v.kind === 'PLAN' && v.conversationId === null && ['MISSING_DATA', 'AUTHORIZATION_REQUIRED', 'PLAN_NEEDS_ATTENTION'].includes(String(v.state)));
export function createAttentionClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return (tenant: string, managed: boolean, offset = 0, signal?: AbortSignal) => {
    if (!uuid(tenant) || !count(offset)) throw new IdentityError('INVALID_REQUEST', 400);
    return request(
      `/api/v1/tenants/${tenant}/attention?managed=${managed}&offset=${offset}&limit=50`,
      'GET',
      (v): v is AttentionPage =>
        record(v) &&
        v.tenantId === tenant &&
        v.scope === (managed ? 'MANAGED' : 'MINE') &&
        count(v.total) &&
        typeof v.hasMore === 'boolean' &&
        date(v.checkedAt) &&
        Array.isArray(v.items) &&
        v.items.length <= 50 &&
        v.items.every(isItem) &&
        v.items.length <= Number(v.total) &&
        v.hasMore === offset + v.items.length < Number(v.total) &&
        new Set(v.items.map((x) => x.kind + ':' + x.id)).size === v.items.length,
      undefined,
      signal,
    );
  };
}
export const getAttention = createAttentionClient();
