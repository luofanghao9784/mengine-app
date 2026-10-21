import { createIdentityRequest, record, uuid, IdentityError } from '../identity/client.ts';
import type {
  GovernanceItem,
  GovernancePage,
  GovernanceChange,
  GovernanceResult,
} from '../../contracts/public-api/material-governance.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const date = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
const sources = ['NOT_CHECKED', 'ORIGINAL_TEXT', 'PARSED_TEXT', 'PARTIAL_TEXT', 'NO_TEXT'];
export const isGovernanceItem = (v: unknown): v is GovernanceItem =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  typeof v.name === 'string' &&
  typeof v.workspaceName === 'string' &&
  (v.uploadedBy === undefined || v.uploadedBy === null || uuid(v.uploadedBy)) &&
  (v.uploadedByName === undefined || v.uploadedByName === null || typeof v.uploadedByName === 'string') &&
  count(v.version) &&
  v.version > 0 &&
  count(v.revision) &&
  typeof v.canEdit === 'boolean' &&
  typeof v.canRedact === 'boolean' &&
  sources.includes(String(v.source)) &&
  (v.quality === null || (count(v.quality) && v.quality <= 100)) &&
  strings(v.issues) &&
  strings(v.tags) &&
  date(v.reviewAt) &&
  date(v.checkedAt);
export const isGovernancePage = (v: unknown): v is GovernancePage =>
  record(v) &&
  uuid(v.tenantId) &&
  record(v.summary) &&
  [v.summary.total, v.summary.checked, v.summary.attention, v.summary.sensitive].every(count) &&
  (v.summary.average === null ||
    (typeof v.summary.average === 'number' && v.summary.average >= 0 && v.summary.average <= 100)) &&
  count(v.filteredTotal) &&
  v.filteredTotal <= Number(v.summary.total) &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(isGovernanceItem) &&
  typeof v.hasMore === 'boolean';
const isResult = (v: unknown): v is GovernanceResult =>
  record(v) &&
  uuid(v.reportId) &&
  count(v.version) &&
  count(v.revision) &&
  sources.includes(String(v.source)) &&
  strings(v.issues) &&
  strings(v.tags) &&
  date(v.reviewAt) &&
  typeof v.redacted === 'boolean';
export function createGovernanceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher, 30000);
  const root = (t: string) => {
    if (!uuid(t)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/v1/tenants/${t}/material-governance`;
  };
  const target = (t: string, id: string) => {
    if (!uuid(id)) throw new IdentityError('INVALID_REQUEST', 400);
    return root(t) + '/' + id;
  };
  return {
    list: (
      tenant: string,
      q: string,
      queue: string,
      rule: string,
      sort: string,
      offset: number,
      signal?: AbortSignal,
    ) =>
      request(
        root(tenant) + '?' + new URLSearchParams({ q, queue, rule, sort, offset: String(offset) }),
        'GET',
        (v): v is GovernancePage => isGovernancePage(v) && v.tenantId === tenant,
        undefined,
        signal,
      ),
    detail: (tenant: string, id: string, signal?: AbortSignal) =>
      request(
        target(tenant, id),
        'GET',
        (v): v is GovernanceItem => isGovernanceItem(v) && v.id === id,
        undefined,
        signal,
      ),
    change: (tenant: string, id: string, body: GovernanceChange, redact: boolean) =>
      request(target(tenant, id) + (redact ? '/redact' : '/check'), 'POST', isResult, body),
  };
}
export const governanceApi = createGovernanceClient();
