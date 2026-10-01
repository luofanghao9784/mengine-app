import type {
  MaterialEntry,
  MaterialPage,
  MaterialDetail,
  MaterialUpload,
  MaterialVersion,
} from '../../contracts/public-api/material';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const nullableId = (v: unknown) => v === null || uuid(v);
export const isEntry = (v: unknown): v is MaterialEntry =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName) &&
  nullableId(v.folderId) &&
  ['FOLDER', 'DOCUMENT', 'DRAFT'].includes(String(v.kind)) &&
  text(v.name) &&
  count(v.version) &&
  (v.kind === 'FOLDER' ? v.version === 0 && v.sizeBytes === null : v.version > 0 && count(v.sizeBytes)) &&
  date(v.updatedAt) &&
  Array.isArray(v.path) &&
  v.path.length > 0 &&
  v.path.every(text) &&
  typeof v.canMaintain === 'boolean';
export const isPage = (v: unknown): v is MaterialPage =>
  record(v) &&
  uuid(v.tenantId) &&
  nullableId(v.workspaceId) &&
  nullableId(v.folderId) &&
  typeof v.canMaintain === 'boolean' &&
  count(v.maxUploadBytes) &&
  Array.isArray(v.trail) &&
  v.trail.every((c) => record(c) && uuid(c.id) && text(c.name)) &&
  Array.isArray(v.items) &&
  v.items.every(isEntry) &&
  typeof v.hasMore === 'boolean';
export const isDetail = (v: unknown): v is MaterialDetail =>
  record(v) &&
  isEntry(v.document) &&
  v.document.kind === 'DOCUMENT' &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.versions) &&
  v.versions.every(
    (x) =>
      record(x) &&
      (x.origin === undefined || x.origin === 'UPLOAD' || x.origin === 'DOCUMENT_PUBLICATION') &&
      uuid(x.id) &&
      count(x.number) &&
      x.number > 0 &&
      text(x.filename) &&
      count(x.sizeBytes) &&
      text(x.sha256) &&
      /^[0-9a-f]{64}$/.test(x.sha256) &&
      uuid(x.createdBy) &&
      date(x.createdAt),
  );
/** Exact acceptance is separate from the material's latest version. */
export interface MaterialUploadReceipt extends MaterialEntry {
  receiptStatus: 'EXACT' | 'HISTORICAL_UNKNOWN';
  acceptedVersion: MaterialVersion | null;
  currentVersion: number;
}
export const isUploadReceipt = (v: unknown): v is MaterialUploadReceipt => {
  if (
    !isEntry(v) ||
    !record(v) ||
    v.kind !== 'DOCUMENT' ||
    !count(v.currentVersion) ||
    v.currentVersion < v.version
  )
    return false;
  if (v.receiptStatus === 'HISTORICAL_UNKNOWN') return v.acceptedVersion === null;
  const a = v.acceptedVersion;
  return (
    v.receiptStatus === 'EXACT' &&
    record(a) &&
    uuid(a.id) &&
    a.number === v.version &&
    text(a.filename) &&
    a.sizeBytes === v.sizeBytes &&
    text(a.sha256) &&
    /^[0-9a-f]{64}$/.test(a.sha256) &&
    uuid(a.createdBy) &&
    date(a.createdAt) &&
    a.createdAt === v.updatedAt &&
    (a.origin === undefined || a.origin === 'UPLOAD' || a.origin === 'DOCUMENT_PUBLICATION')
  );
};
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createMaterialClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher, 120_000);
  const root = (tenant: string, space: string) => `/api/v1/tenants/${id(tenant)}/workspaces/${id(space)}`;
  const scoped =
    (tenant: string, space: string, document?: string) =>
    (v: unknown): v is MaterialEntry =>
      isEntry(v) && v.tenantId === tenant && v.workspaceId === space && (!document || v.id === document);
  return {
    list(
      tenant: string,
      space: string | null,
      folder: string | null,
      q: string,
      offset: number,
      signal?: AbortSignal,
    ) {
      const query = new URLSearchParams({ q, offset: String(offset), limit: '24' });
      if (folder) query.set('folder', id(folder));
      return request(
        (space ? root(tenant, space) : `/api/v1/tenants/${id(tenant)}`) + '/library?' + query,
        'GET',
        (v): v is MaterialPage =>
          isPage(v) &&
          v.tenantId === tenant &&
          v.workspaceId === space &&
          v.folderId === folder &&
          v.items.every((x) => x.tenantId === tenant && (!space || x.workspaceId === space)),
        undefined,
        signal,
      );
    },
    folder(
      tenant: string,
      space: string,
      body: { requestId: string; parentId: string | null; name: string },
      signal?: AbortSignal,
    ) {
      return request(
        root(tenant, space) + '/folders',
        'POST',
        (v): v is { id: string; name: string } => record(v) && uuid(v.id) && text(v.name),
        body,
        signal,
      );
    },
    upload(
      tenant: string,
      space: string,
      metadata: MaterialUpload,
      file: File,
      document?: string,
      signal?: AbortSignal,
    ) {
      const form = new FormData();
      form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      // Directory selections carry a relative path; folders are already resolved separately.
      form.set('file', file, file.name);
      return request(
        root(tenant, space) + '/materials' + (document ? `/${id(document)}/versions` : ''),
        'POST',
        (v): v is MaterialUploadReceipt =>
          isUploadReceipt(v) &&
          scoped(tenant, space, document)(v) &&
          (document ? true : v.folderId === (metadata.folderId || null)) &&
          (v.receiptStatus !== 'EXACT' ||
            (v.acceptedVersion!.sizeBytes === file.size &&
              v.acceptedVersion!.filename === file.name.trim().normalize('NFC'))),
        form,
        signal,
      );
    },
    detail(tenant: string, space: string, document: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant, space) + `/materials/${id(document)}?offset=${offset}&limit=20`,
        'GET',
        (v): v is MaterialDetail =>
          isDetail(v) &&
          scoped(tenant, space, document)(v.document) &&
          new Set(v.versions.map((x) => x.id)).size === v.versions.length,
        undefined,
        signal,
      );
    },
    version(tenant: string, space: string, document: string, version: string, signal?: AbortSignal) {
      return request(
        root(tenant, space) + `/materials/${id(document)}/versions/${id(version)}`,
        'GET',
        (v): v is MaterialVersion =>
          record(v) &&
          v.id === version &&
          count(v.number) &&
          text(v.filename) &&
          count(v.sizeBytes) &&
          text(v.sha256) &&
          uuid(v.createdBy) &&
          date(v.createdAt),
        undefined,
        signal,
      );
    },
    async download(tenant: string, space: string, document: string, version: string, signal?: AbortSignal) {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 120_000);
      const cancel = () => controller.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await fetcher(
          root(tenant, space) + `/materials/${id(document)}/versions/${id(version)}/download`,
          { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal },
        );
        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          throw new IdentityError(
            record(payload) && payload.contractVersion === '1.0' && text(payload.code)
              ? payload.code
              : response.status === 401
                ? 'AUTHENTICATION_REQUIRED'
                : 'UNAVAILABLE',
            response.status,
          );
        }
        if (
          response.headers.get('content-type') !== 'application/octet-stream' ||
          !response.headers.get('content-disposition')?.startsWith('attachment;')
        )
          throw new IdentityError('CONTRACT_MISMATCH');
        return await response.blob();
      } catch (error) {
        if (signal?.aborted) throw new IdentityError('CANCELLED');
        if (error instanceof IdentityError) throw error;
        throw new IdentityError('UNAVAILABLE');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
export const materialClient = createMaterialClient();
