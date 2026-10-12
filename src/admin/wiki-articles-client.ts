import { createIdentityRequest, IdentityError, record, uuid, text } from '../identity/client.ts';
import type {
  WikiArticle,
  WikiArticlePage,
  WikiPreparation,
  WikiArticleHistory,
  WikiArticleBody,
} from '../../contracts/public-api/wiki-articles.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const bounded = (v: unknown, n: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
export const isArticleBody = (a: unknown): a is WikiArticleBody =>
  record(a) &&
  bounded(a.title, 80) &&
  bounded(a.intro, 250) &&
  bounded(a.content, 1500) &&
  Array.isArray(a.evidence) &&
  a.evidence.length > 0 &&
  a.evidence.length <= 4 &&
  a.evidence.every(
    (e) => record(e) && uuid(e.chunkId) && bounded(e.quote, 200) && String(e.quote).length >= 6,
  );
export const isArticle = (v: unknown): v is WikiArticle =>
  record(v) &&
  [v.id, v.tenantId, v.materialId, v.sourceVersionId].every(uuid) &&
  count(v.revision) &&
  count(v.sourceVersion) &&
  text(v.sourceName) &&
  ['archived', 'sourceChanged', 'canMaintain'].every((k) => typeof v[k] === 'boolean') &&
  ['live', 'verification'].includes(String(v.executionClass)) &&
  (v.modelName === null || text(v.modelName)) &&
  (v.sourceChanged ? v.article === null : isArticleBody(v.article));
export type ArticleText = { title: string; intro: string; content: string };
export function createWikiArticlesClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
    if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
    return v;
  };
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/wiki-articles`;
  const scoped =
    (tenant: string, article?: string) =>
    (v: unknown): v is WikiArticle =>
      isArticle(v) && v.tenantId === tenant && (!article || v.id === article);
  return {
    list(tenant: string, archived: boolean, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?archived=${archived}&offset=${offset}`,
        'GET',
        (v): v is WikiArticlePage =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((x) => scoped(tenant)(x) && x.archived === archived),
        undefined,
        signal,
      );
    },
    detail(tenant: string, article: string, signal?: AbortSignal) {
      return request(root(tenant) + '/' + id(article), 'GET', scoped(tenant, article), undefined, signal);
    },
    prepare(tenant: string, draft: string, signal?: AbortSignal) {
      return request(
        root(tenant) + '/prepare/' + id(draft),
        'GET',
        (v): v is WikiPreparation =>
          record(v) &&
          Number.isSafeInteger(v.expectedRevision) &&
          Number(v.expectedRevision) >= 0 &&
          typeof v.canPublish === 'boolean',
        undefined,
        signal,
      );
    },
    publish(
      tenant: string,
      draft: string,
      body: ArticleText & { requestId: string; expectedRevision: number; acknowledged: boolean },
    ) {
      return request(root(tenant) + '/publish/' + id(draft), 'POST', scoped(tenant), body);
    },
    change(
      tenant: string,
      article: string,
      body: {
        requestId: string;
        expectedRevision: number;
        action: 'EDIT' | 'ARCHIVE' | 'RESTORE';
      } & Partial<ArticleText>,
    ) {
      return request(root(tenant) + '/' + id(article), 'POST', scoped(tenant, article), body);
    },
    history(tenant: string, article: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + '/' + id(article) + `/history?offset=${offset}`,
        'GET',
        (v): v is WikiArticleHistory =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (x) =>
              record(x) &&
              count(x.revision) &&
              ['PUBLISH', 'EDIT', 'ARCHIVE', 'RESTORE'].includes(String(x.action)) &&
              uuid(x.actorId) &&
              text(x.createdAt) &&
              typeof x.sourceChanged === 'boolean' &&
              (x.sourceChanged ? x.article === null : isArticleBody(x.article)),
          ),
        undefined,
        signal,
      );
    },
  };
}
export const wikiArticles = createWikiArticlesClient();
