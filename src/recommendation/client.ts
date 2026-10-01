import { isTarget } from '../feedback/client.ts';
import type {
  DeliveryTarget,
  OpenedDelivery,
  RecommendationContent,
  RecommendationItem,
  RecommendationPage,
  RecommendationSettings,
} from '../../contracts/public-api/recommendation';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const num = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nullableId = (v: unknown) => v === null || uuid(v);
export const isSettings = (v: unknown): v is RecommendationSettings =>
  record(v) && num(v.revision) && typeof v.enabled === 'boolean';
export const isContent = (v: unknown): v is RecommendationContent =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  str(v.workspaceName, 200) &&
  str(v.title, 255) &&
  str(v.excerpt, 1200) &&
  typeof v.truncated === 'boolean' &&
  date(v.createdAt) &&
  nullableId(v.conversationId) &&
  num(v.taskRevision) &&
  num(v.attempt) &&
  num(v.preferenceRevision) &&
  nullableId(v.materialId) &&
  num(v.materialVersion) &&
  str(v.filename, 255) &&
  typeof v.pinned === 'boolean' &&
  (v.openedAt === null || date(v.openedAt)) &&
  (v.kind === 'TASK'
    ? uuid(v.conversationId) &&
      v.materialId === null &&
      Number(v.attempt) > 0 &&
      ['verification', 'live'].includes(String(v.executionClass)) &&
      v.versionKey === `task:${v.id}:${v.taskRevision}:${v.attempt}`
    : v.kind === 'PUBLICATION' &&
      v.conversationId === null &&
      uuid(v.materialId) &&
      Number(v.materialVersion) > 0 &&
      v.executionClass === 'PUBLISHED_COPY' &&
      v.versionKey === `publication:${v.id}`);
export const isItem = (v: unknown): v is RecommendationItem =>
  record(v) &&
  isContent(v.content) &&
  typeof v.score === 'number' &&
  Number.isFinite(v.score) &&
  v.score >= 0 &&
  v.score <= 1 &&
  record(v.method) &&
  nullableId(v.method.versionId) &&
  num(v.method.adoptionRevision) &&
  ['BUILTIN', 'TENANT', 'WORKSPACE'].includes(String(v.method.scope)) &&
  nullableId(v.method.workspaceId) &&
  hash(v.method.configurationSha) &&
  record(v.presentation) &&
  v.presentation.renderer === 'source-preserving-v1' &&
  ['DEFAULT', 'CONCISE', 'TABLE_FIRST', 'CONCLUSION_FIRST', 'DETAIL_FIRST'].includes(
    String(v.presentation.style),
  ) &&
  nullableId(v.presentation.profileId) &&
  num(v.presentation.profileRevision) &&
  str(v.reason, 200) &&
  v.availability === 'AVAILABLE_IN_APP' &&
  (v.content.kind === 'PUBLICATION'
    ? isTarget(v.feedbackTarget) &&
      v.feedbackTarget.kind === 'PUBLICATION' &&
      v.feedbackTarget.materialVersionId === v.content.id &&
      v.feedbackTarget.materialVersion === v.content.materialVersion
    : isTarget(v.feedbackTarget) &&
      v.feedbackTarget.kind === 'BRIEFING' &&
      v.feedbackTarget.taskId === v.content.id &&
      v.feedbackTarget.taskRevision === v.content.taskRevision &&
      v.feedbackTarget.attempt === v.content.attempt &&
      v.feedbackTarget.presentationVersion === 'recommendation-v1' &&
      num(v.feedbackTarget.presentationRevision) &&
      v.feedbackTarget.presentationRevision > 0);
export function createRecommendationClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant: string) => {
    if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/v1/tenants/${tenant}/recommendations`;
  };
  return {
    list(tenant: string, workspace: string | null, offset = 0, snapshot?: string, signal?: AbortSignal) {
      const q = new URLSearchParams({ offset: String(offset), limit: '20' });
      if (workspace) q.set('workspaceId', workspace);
      if (snapshot) q.set('snapshot', snapshot);
      return request(
        root(tenant) + '?' + q,
        'GET',
        (v): v is RecommendationPage =>
          record(v) &&
          v.tenantId === tenant &&
          isSettings(v.settings) &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((i) => isItem(i) && (!workspace || i.content.workspaceId === workspace)) &&
          new Set(v.items.map((i) => i.content.id)).size === v.items.length &&
          hash(v.snapshot) &&
          typeof v.hasMore === 'boolean' &&
          num(v.eligibleTotal) &&
          num(v.rankedCount) &&
          v.rankedCount <= 1000 &&
          v.eligibleTotal >= v.rankedCount &&
          typeof v.poolLimited === 'boolean' &&
          v.poolLimit === 1000 &&
          v.businessOutcome === 'NOT_ASSESSED',
        undefined,
        signal,
      );
    },
    configure(tenant: string, body: { requestId: string; expectedRevision: number; enabled: boolean }) {
      return request(root(tenant) + '/settings', 'POST', isSettings, body);
    },
    opened(tenant: string, target: DeliveryTarget) {
      return request(
        root(tenant) + '/opened',
        'POST',
        (v): v is OpenedDelivery =>
          record(v) &&
          record(v.target) &&
          v.target.id === target.id &&
          v.target.kind === target.kind &&
          v.target.versionKey === target.versionKey &&
          date(v.openedAt) &&
          v.evidence === 'USER_OPEN_ACTION' &&
          v.businessOutcome === 'NOT_ASSESSED',
        target,
      );
    },
  };
}
export const recommendationClient = createRecommendationClient();
