import type {
  PrivateDocument,
  DocumentDetail,
  DocumentPage,
  CreateDocument,
  SaveDocument,
} from '../../contracts/public-api/document';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
import { withTimeout } from '../shared/abort-timeout.ts';
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const document = (v: unknown): v is PrivateDocument =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  uuid(v.sourceWorkspaceId) &&
  uuid(v.conversationId) &&
  uuid(v.taskId) &&
  (v.artifactId === null || uuid(v.artifactId)) &&
  positive(v.revision) &&
  text(v.title) &&
  v.title.length <= 160 &&
  date(v.updatedAt);
const detail = (v: unknown): v is DocumentDetail =>
  record(v) &&
  document(v.document) &&
  record(v.version) &&
  positive(v.version.number) &&
  v.version.number <= v.document.revision &&
  text(v.version.title) &&
  v.version.title.length <= 160 &&
  text(v.version.body) &&
  v.version.body.length <= 32768 &&
  date(v.version.createdAt);
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createDocumentClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/documents`;
  const scoped =
    (tenant: string, doc?: string) =>
    (v: unknown): v is DocumentDetail =>
      detail(v) && v.document.tenantId === tenant && (!doc || v.document.id === doc);
  return {
    list(tenant: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?offset=${offset}&limit=20`,
        'GET',
        (v): v is DocumentPage =>
          record(v) &&
          v.tenantId === tenant &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((d) => document(d) && d.tenantId === tenant) &&
          new Set(v.items.map((d) => (d as PrivateDocument).id)).size === v.items.length,
        undefined,
        signal,
      );
    },
    detail(tenant: string, doc: string, version?: number, signal?: AbortSignal) {
      return request(
        root(tenant) + '/' + id(doc) + (version ? `?version=${version}` : ''),
        'GET',
        (v): v is DocumentDetail =>
          scoped(tenant, doc)(v) && v.version.number === (version || v.document.revision),
        undefined,
        signal,
      );
    },
    create(tenant: string, body: CreateDocument) {
      return request(
        root(tenant),
        'POST',
        (v): v is DocumentDetail =>
          scoped(tenant)(v) &&
          v.document.conversationId === body.conversationId &&
          v.document.taskId === body.taskId &&
          v.document.artifactId === (body.artifactId || null),
        body,
      );
    },
    save(tenant: string, doc: string, body: SaveDocument) {
      return request(root(tenant) + '/' + id(doc) + '/versions', 'POST', scoped(tenant, doc), body);
    },
    async download(
      tenant: string,
      doc: string,
      version: number,
      format: 'docx' | 'pdf',
      signal?: AbortSignal,
    ) {
      const type =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      try {
        const response = await fetcher(root(tenant) + `/${id(doc)}/versions/${version}/exports/${format}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: withTimeout(signal, 30000),
        });
        if (!response.ok) {
          const v: unknown = await response.json().catch(() => null);
          throw new IdentityError(
            record(v) && typeof v.code === 'string' ? v.code : 'DOCUMENT_EXPORT_UNAVAILABLE',
            response.status,
          );
        }
        const hash = response.headers.get('x-content-sha256'),
          expected = Number(response.headers.get('content-length'));
        if (
          response.headers.get('content-type') !== type ||
          !response.headers.get('content-disposition')?.startsWith('attachment;') ||
          !hash ||
          !/^[0-9a-f]{64}$/.test(hash) ||
          !Number.isSafeInteger(expected) ||
          expected < 1 ||
          expected > 2097152 ||
          !response.body
        )
          throw new IdentityError('CONTRACT_MISMATCH');
        const reader = response.body.getReader(),
          parts: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > expected) throw new IdentityError('CONTRACT_MISMATCH');
            parts.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (actual !== hash || length !== expected) throw new IdentityError('CONTRACT_MISMATCH');
        return new Blob([bytes], { type });
      } catch (e) {
        if (e instanceof IdentityError) throw e;
        throw new IdentityError(signal?.aborted ? 'CANCELLED' : 'DOCUMENT_EXPORT_UNAVAILABLE');
      }
    },
  };
}
export const documentClient = createDocumentClient();
