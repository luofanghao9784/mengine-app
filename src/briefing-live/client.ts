import { isBriefingDocument } from './content.ts';
import type {
  BriefingTimelinePage,
  BriefingCard,
  BriefingPreference,
  BriefingPage,
  BriefingFilter,
  BriefingUpdate,
  BriefingLayout,
  BriefingLayoutMove,
  BriefingLayoutReceipt,
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
  (v.briefing == null || isBriefingDocument(v.briefing)) &&
  (v.cardId === undefined || uuid(v.cardId)) &&
  uuid(v.conversationId) &&
  uuid(v.taskId) &&
  count(v.taskRevision) &&
  count(v.attempt) &&
  v.attempt > 0 &&
  v.presentationVersion === 'briefing-basic-v1' &&
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
    timeline(tenant: string, zone: string, offset = 0, asOf?: string, signal?: AbortSignal) {
      const query = new URLSearchParams({ zone, offset: String(offset), limit: '20' });
      if (asOf) query.set('asOf', asOf);
      return request(
        root(tenant) + '/timeline?' + query,
        'GET',
        (v): v is BriefingTimelinePage =>
          record(v) &&
          v.tenantId === tenant &&
          v.zone === zone &&
          text(v.asOf) &&
          Number.isFinite(Date.parse(v.asOf)) &&
          (!asOf || v.asOf === asOf) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (day, index, days) =>
              record(day) &&
              text(day.date) &&
              /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
              (!index || String(days[index - 1].date) > day.date) &&
              count(day.total) &&
              day.total > 0 &&
              Array.isArray(day.items) &&
              day.items.length === Math.min(3, day.total) &&
              day.items.every((c) => card(c) && !c.preference.hidden) &&
              new Set(day.items.map((c) => c.cardId || c.taskId)).size === day.items.length,
          ),
        undefined,
        signal,
      );
    },
    timelineDay(
      tenant: string,
      date: string,
      zone: string,
      offset: number,
      asOf: string,
      signal?: AbortSignal,
    ) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new IdentityError('INVALID_REQUEST', 400);
      const query = new URLSearchParams({ zone, offset: String(offset), limit: '20', asOf });
      return request(
        root(tenant) + '/timeline/' + date + '?' + query,
        'GET',
        (v): v is BriefingPage =>
          record(v) &&
          v.tenantId === tenant &&
          v.view === 'LATEST' &&
          v.date === date &&
          v.zone === zone &&
          v.asOf === asOf &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((c) => card(c) && !c.preference.hidden) &&
          new Set(v.items.map((c) => c.cardId || c.taskId)).size === v.items.length,
        undefined,
        signal,
      );
    },
    cardPreference(tenant: string, card: string) {
      return request(root(tenant) + '/cards/' + id(card) + '/preference', 'GET', isPreference);
    },
    cardUpdate(tenant: string, card: string, body: BriefingUpdate) {
      return request(root(tenant) + '/cards/' + id(card) + '/preference', 'POST', isPreference, body);
    },
    async cardMove(tenant: string, body: BriefingLayoutMove) {
      const result = await request(
        root(tenant) + '/cards/layout',
        'POST',
        (
          v,
        ): v is {
          id: string;
          cardId: string;
          anchorId: string;
          direction: string;
          appliedRevision: number;
          currentRevision: number;
        } =>
          record(v) &&
          uuid(v.id) &&
          v.cardId === body.conversationId &&
          v.anchorId === body.anchorId &&
          v.direction === body.direction &&
          count(v.appliedRevision) &&
          count(v.currentRevision),
        {
          requestId: body.requestId,
          expectedRevision: body.expectedRevision,
          cardId: body.conversationId,
          anchorId: body.anchorId,
          direction: body.direction,
        },
      );
      return { ...result, conversationId: result.cardId };
    },
    preference(tenant: string, conversation: string, signal?: AbortSignal) {
      return request(
        root(tenant) + '/' + id(conversation) + '/preference',
        'GET',
        isPreference,
        undefined,
        signal,
      );
    },
    layout(tenant: string, signal?: AbortSignal) {
      return request(
        root(tenant) + '/layout',
        'GET',
        (v): v is BriefingLayout => record(v) && v.tenantId === tenant && count(v.revision),
        undefined,
        signal,
      );
    },
    move(tenant: string, body: BriefingLayoutMove) {
      return request(
        root(tenant) + '/layout',
        'POST',
        (v): v is BriefingLayoutReceipt =>
          record(v) &&
          uuid(v.id) &&
          v.conversationId === body.conversationId &&
          v.anchorId === body.anchorId &&
          v.direction === body.direction &&
          count(v.appliedRevision) &&
          count(v.currentRevision) &&
          v.currentRevision >= v.appliedRevision,
        body,
      );
    },
    list(tenant: string, filter: BriefingFilter, offset = 0, signal?: AbortSignal) {
      const query = new URLSearchParams({
        view: filter.view,
        zone: filter.zone,
        offset: String(offset),
        limit: '20',
        generatedOnly: 'true',
      });
      if (filter.asOf) query.set('asOf', filter.asOf);
      if (filter.businessType) query.set('businessType', filter.businessType);
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
          new Set(v.items.map((c) => (c as BriefingCard).cardId || (c as BriefingCard).taskId)).size ===
            v.items.length,
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
