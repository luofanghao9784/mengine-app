import { createIdentityRequest, IdentityError, record, uuid, text } from '../identity/client.ts';
import type { WikiGraph, WikiGraphPage } from '../../contracts/public-api/wiki-graphs.ts';
const bounded = (v: unknown, n: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= n;
export function isWikiGraph(v: unknown): v is WikiGraph {
  if (
    !record(v) ||
    ![v.id, v.tenantId, v.taskId, v.conversationId].every(uuid) ||
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
    !(v.modelName === null || text(v.modelName)) ||
    !Array.isArray(v.documents) ||
    v.documents.length > 12
  )
    return false;
  const docs = v.documents;
  if (
    docs.some(
      (d) =>
        !record(d) ||
        !uuid(d.id) ||
        !Number.isSafeInteger(d.revision) ||
        Number(d.revision) < 1 ||
        !bounded(d.title, 80) ||
        !bounded(d.content, 1500),
    ) ||
    new Set(docs.map((d) => d.id)).size !== docs.length
  )
    return false;
  if (v.status === 'SOURCE_CHANGED') return v.graph === null && !docs.length;
  if (!docs.length) return false;
  if (v.status !== 'SUCCEEDED') return v.graph === null;
  const g = v.graph;
  if (
    !record(g) ||
    !Array.isArray(g.selected) ||
    !g.selected.length ||
    g.selected.length > 6 ||
    new Set(g.selected).size !== g.selected.length ||
    g.selected.some((id) => !docs.some((d) => d.id === id)) ||
    !Array.isArray(g.relations) ||
    g.relations.length > 4
  )
    return false;
  const selected = g.selected;
  const pairs = new Set<string>();
  return g.relations.every((r) => {
    if (
      !record(r) ||
      !selected.includes(r.from) ||
      !selected.includes(r.to) ||
      r.from === r.to ||
      !['topic', 'complement', 'dependency', 'sequence'].includes(String(r.kind)) ||
      !bounded(r.reason, 120) ||
      !Array.isArray(r.evidence) ||
      r.evidence.length < 2 ||
      r.evidence.length > 6
    )
      return false;
    const pair = [r.from, r.to].sort().join('/');
    if (pairs.has(pair)) return false;
    pairs.add(pair);
    return (
      new Set(r.evidence.map((e) => (record(e) ? e.articleId : undefined))).size === 2 &&
      r.evidence.every(
        (e) =>
          record(e) &&
          [r.from, r.to].includes(e.articleId) &&
          bounded(e.quote, 80) &&
          e.quote.length >= 6 &&
          docs.some((d) => d.id === e.articleId && d.content.includes(e.quote)),
      )
    );
  });
}
export function createWikiGraphsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
    if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
    return v;
  };
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/wiki-graphs`;
  const scoped =
    (tenant: string, graph?: string) =>
    (v: unknown): v is WikiGraph =>
      isWikiGraph(v) && v.tenantId === tenant && (!graph || v.id === graph);
  return {
    automatic(tenant: string, requestId: string) {
      return request(root(tenant) + '/automatic', 'POST', scoped(tenant), { requestId: id(requestId) });
    },
    list(tenant: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?offset=${offset}`,
        'GET',
        (v): v is WikiGraphPage =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(scoped(tenant)),
        undefined,
        signal,
      );
    },
    detail(tenant: string, graph: string, signal?: AbortSignal) {
      return request(root(tenant) + '/' + id(graph), 'GET', scoped(tenant, graph), undefined, signal);
    },
    start(tenant: string, articles: { articleId: string; revision: number }[], requestId: string) {
      return request(root(tenant), 'POST', scoped(tenant), { requestId: id(requestId), articles });
    },
  };
}
export const wikiGraphs = createWikiGraphsClient();
