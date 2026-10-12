import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import type { KnowledgeWorkbench, WorkbenchState } from '../../contracts/public-api/knowledge-workbench.ts';
const count = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
const date = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
export function isWorkbench(v: unknown): v is KnowledgeWorkbench {
  if (!record(v) || !uuid(v.tenantId) || !date(v.checkedAt) || !record(v.summary)) return false;
  const s = v.summary;
  return (
    [s.total, s.ready, s.processing, s.attention, s.notStarted].every(count) &&
    s.total === Number(s.ready) + Number(s.processing) + Number(s.attention) + Number(s.notStarted) &&
    count(v.filteredTotal) &&
    v.filteredTotal <= Number(s.total) &&
    typeof v.hasMore === 'boolean' &&
    Array.isArray(v.spaces) &&
    v.spaces.every(
      (x) => record(x) && (x.id === null || uuid(x.id)) && typeof x.name === 'string' && count(x.count),
    ) &&
    v.spaces.reduce((n, x) => n + x.count, 0) === s.total &&
    Array.isArray(v.items) &&
    v.items.length <= 20 &&
    v.items.every(
      (x) =>
        record(x) &&
        uuid(x.id) &&
        uuid(x.workspaceId) &&
        typeof x.workspaceName === 'string' &&
        typeof x.name === 'string' &&
        count(x.version) &&
        x.version > 0 &&
        date(x.updatedAt) &&
        [
          'NOT_STARTED',
          'QUEUED',
          'RUNNING',
          'READY',
          'PARTIAL',
          'FAILED',
          'UNSUPPORTED',
          'CANCELLED',
        ].includes(String(x.status)),
    )
  );
}
export function createWorkbenchClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return (
    tenant: string,
    state: WorkbenchState,
    space: string | null,
    query: string,
    offset: number,
    signal?: AbortSignal,
  ) => {
    if (!uuid(tenant) || (space !== null && !uuid(space))) throw new IdentityError('INVALID_REQUEST', 400);
    const params = new URLSearchParams({ state, q: query, offset: String(offset) });
    if (space) params.set('workspace', space);
    return request(
      `/api/v1/tenants/${tenant}/knowledge/workbench?${params}`,
      'GET',
      (v): v is KnowledgeWorkbench => isWorkbench(v) && v.tenantId === tenant,
      undefined,
      signal,
    );
  };
}
export const readWorkbench = createWorkbenchClient();
