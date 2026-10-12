import { createIdentityRequest, IdentityError, record, uuid, text } from '../identity/client.ts';
import type { WikiDraft, WikiDraftPage } from '../../contracts/public-api/wiki-learning.ts';
const bounded = (v: unknown, n: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
export function isWikiDraft(v: unknown): v is WikiDraft {
  if (
    !record(v) ||
    ![v.id, v.tenantId, v.materialId, v.versionId, v.conversationId, v.taskId].every(uuid) ||
    !text(v.sourceName) ||
    !Number.isInteger(v.sourceVersion) ||
    Number(v.sourceVersion) < 1 ||
    ![
      'QUEUED',
      'RUNNING',
      'WAITING_CAPABILITY',
      'WAITING_INPUT',
      'PAUSED',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'PARTIAL',
      'SOURCE_CHANGED',
      'RESULT_UNKNOWN',
      'INTERRUPTED',
    ].includes(String(v.status)) ||
    !(v.executionClass === null || ['live', 'verification'].includes(String(v.executionClass))) ||
    !(v.modelName === null || text(v.modelName))
  )
    return false;
  if (v.status !== 'SUCCEEDED') return v.article === null;
  const a = v.article;
  return (
    record(a) &&
    bounded(a.title, 80) &&
    bounded(a.intro, 250) &&
    bounded(a.content, 1500) &&
    Array.isArray(a.evidence) &&
    a.evidence.length > 0 &&
    a.evidence.length <= 4 &&
    a.evidence.every(
      (e) => record(e) && uuid(e.chunkId) && bounded(e.quote, 200) && String(e.quote).length >= 6,
    )
  );
}
export function createWikiLearningClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
    if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
    return v;
  };
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/wiki-learning`;
  return {
    list(tenant: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?offset=${offset}`,
        'GET',
        (v): v is WikiDraftPage =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((x) => isWikiDraft(x) && x.tenantId === tenant),
        undefined,
        signal,
      );
    },
    detail(tenant: string, draft: string, signal?: AbortSignal) {
      return request(
        root(tenant) + '/' + id(draft),
        'GET',
        (v): v is WikiDraft => isWikiDraft(v) && v.tenantId === tenant && v.id === draft,
        undefined,
        signal,
      );
    },
    start(
      tenant: string,
      material: string,
      body: { requestId: string; versionId: string; generation: number },
    ) {
      id(body.requestId);
      id(body.versionId);
      return request(
        root(tenant) + '/sources/' + id(material),
        'POST',
        (v): v is WikiDraft =>
          isWikiDraft(v) &&
          v.tenantId === tenant &&
          v.materialId === material &&
          v.versionId === body.versionId,
        body,
      );
    },
  };
}
export const wikiLearning = createWikiLearningClient();
