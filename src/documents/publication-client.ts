import type {
  DocumentPublication,
  PublicationPage,
  PublishDocument,
} from '../../contracts/public-api/document.ts';
import { createIdentityRequest, record, text, uuid, IdentityError } from '../identity/client.ts';
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const publication = (v: unknown): v is DocumentPublication =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.documentId) &&
  positive(v.documentVersion) &&
  uuid(v.workspaceId) &&
  (v.folderId === null || uuid(v.folderId)) &&
  uuid(v.materialId) &&
  uuid(v.materialVersionId) &&
  positive(v.materialVersion) &&
  text(v.filename) &&
  v.filename.length <= 180 &&
  ['docx', 'pdf'].includes(String(v.format)) &&
  text(v.sha256) &&
  /^[0-9a-f]{64}$/.test(v.sha256) &&
  text(v.publishedAt) &&
  Number.isFinite(Date.parse(v.publishedAt));
export function createPublicationClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant: string, document: string) => {
      if (!uuid(tenant) || !uuid(document)) throw new IdentityError('INVALID_REQUEST', 400);
      return `/api/v1/tenants/${tenant}/documents/${document}`;
    };
  return {
    list(tenant: string, document: string, page = 0, signal?: AbortSignal) {
      return request(
        root(tenant, document) + `/publications?offset=${page * 20}&limit=20`,
        'GET',
        (v): v is PublicationPage =>
          record(v) &&
          v.tenantId === tenant &&
          v.documentId === document &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((p) => publication(p) && p.tenantId === tenant && p.documentId === document) &&
          new Set(v.items.map((p) => p.id)).size === v.items.length,
        undefined,
        signal,
      );
    },
    publish(tenant: string, document: string, version: number, body: PublishDocument) {
      return request(
        root(tenant, document) + `/versions/${version}/publications`,
        'POST',
        (v): v is DocumentPublication =>
          publication(v) &&
          v.tenantId === tenant &&
          v.documentId === document &&
          v.documentVersion === version &&
          v.workspaceId === body.workspaceId &&
          v.format === body.format &&
          (!body.materialId ? v.folderId === (body.folderId || null) : v.materialId === body.materialId),
        body,
      );
    },
  };
}
export const publicationClient = createPublicationClient();
