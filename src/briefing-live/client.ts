import type {
  BriefingCard,
  BriefingPreference,
  BriefingPage,
  BriefingFilter,
  BriefingUpdate,
} from '../../contracts/public-api/briefing';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const isPreference = (v: unknown): v is BriefingPreference =>
  record(v) &&
  count(v.revision) &&
  typeof v.pinned === 'boolean' &&
  typeof v.hidden === 'boolean' &&
  ['STANDARD', 'WIDE'].includes(String(v.size));
const card = (v: unknown): v is BriefingCard =>
  record(v) &&
  uuid(v.conversationId) &&
  uuid(v.taskId) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName) &&
  v.workspaceName.length <= 200 &&
  text(v.title) &&
  v.title.length <= 200 &&
  text(v.excerpt) &&
  v.excerpt.length <= 1200 &&
  typeof v.truncated === 'boolean' &&
  text(v.completedAt) &&
  Number.isFinite(Date.parse(v.completedAt)) &&
  ['verification', 'live'].includes(String(v.executionClass)) &&
  text(v.engineVersion) &&
  v.engineVersion.length <= 64 &&
  count(v.artifactCount) &&
  v.artifactCount <= 8 &&
  count(v.citationCount) &&
  v.citationCount <= 10 &&
  count(v.originalCount) &&
  v.originalCount <= 3 &&
  isPreference(v.preference);
const id = (value: string) => {
  if (!uuid(value)) throw new IdentityError('INVALID_REQUEST', 400);
  return value;
};
export function createBriefingClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/briefing`;
  return {
    list(tenant: string, filter: BriefingFilter, offset = 0, signal?: AbortSignal) {
      const query = new URLSearchParams({
        view: filter.view,
        zone: filter.zone,
        offset: String(offset),
        limit: '20',
      });
      if (filter.date) query.set('date', filter.date);
      if (filter.workspaceId) query.set('workspaceId', id(filter.workspaceId));
      return request(
        root(tenant) + '?' + query,
        'GET',
        (v): v is BriefingPage =>
          record(v) &&
          v.tenantId === tenant &&
          v.view === filter.view &&
          v.date === filter.date &&
          v.zone === filter.zone &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (c) =>
              card(c) &&
              (!filter.workspaceId || c.workspaceId === filter.workspaceId) &&
              c.preference.hidden === (filter.view === 'HIDDEN') &&
              (filter.view !== 'FOCUSED' || c.preference.pinned),
          ) &&
          new Set(v.items.map((c) => (c as BriefingCard).conversationId)).size === v.items.length,
        undefined,
        signal,
      );
    },
    update(tenant: string, conversation: string, body: BriefingUpdate) {
      return request(root(tenant) + '/' + id(conversation), 'POST', isPreference, body);
    },
  };
}
export const briefingClient = createBriefingClient();
