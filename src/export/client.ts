import type {
  CreateExport,
  ExportBatch,
  ExportChoice,
  ExportItem,
  ExportOptions,
  ExportPage,
  ExportScope,
  ExportSelection,
  ExportSummary,
} from '../../contracts/public-api/export.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const date = (v: unknown) => text(v, 50) && Number.isFinite(Date.parse(v));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const states = ['QUEUED', 'GENERATING', 'READY', 'PARTIAL', 'FAILED', 'EXPIRED', 'REVOKED', 'REMOVED'];
const cleanupStates = ['NONE', 'PENDING', 'FAILED', 'COMPLETE'];
const limits = (v: Record<string, unknown>) =>
  Array.isArray(v.retentionDays) &&
  v.retentionDays.length > 0 &&
  v.retentionDays.length <= 3 &&
  v.retentionDays.every((n) => [1, 3, 7].includes(n)) &&
  new Set(v.retentionDays).size === v.retentionDays.length &&
  integer(v.maxItems, 1, 50) &&
  integer(v.maxBytes, 1, 33554432);
export const isSelection = (v: unknown): v is ExportSelection =>
  record(v) && uuid(v.objectId) && integer(v.version, 1) && one(v.format, ['docx', 'pdf']);
export const isChoice = (v: unknown): v is ExportChoice =>
  record(v) &&
  isSelection(v.selection) &&
  (v.versionId === null || uuid(v.versionId)) &&
  text(v.title, 180) &&
  integer(v.sizeBytes, -1, 2097152) &&
  date(v.createdAt);
const base = (v: unknown): v is ExportSummary =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  one(v.scope, ['PRIVATE', 'ENTERPRISE']) &&
  integer(v.revision, 1) &&
  one(v.state, states) &&
  integer(v.requestedCount, 1, 50) &&
  date(v.createdAt) &&
  (v.expiresAt === null || date(v.expiresAt));
const isItem = (v: unknown): v is ExportItem =>
  record(v) &&
  integer(v.ordinal, 1, 50) &&
  isSelection(v.selection) &&
  (v.versionId === null || uuid(v.versionId)) &&
  (v.title === null || text(v.title, 180)) &&
  one(v.state, ['PENDING', 'WRITING', 'INCLUDED', 'FAILED']) &&
  (v.archivePath === null || text(v.archivePath, 150)) &&
  (v.sizeBytes === null || integer(v.sizeBytes, 1, 2097152)) &&
  (v.sha256 === null || hash(v.sha256)) &&
  (v.errorCode === null || text(v.errorCode, 80)) &&
  typeof v.visible === 'boolean' &&
  (v.visible ||
    (v.title === null &&
      v.archivePath === null &&
      v.sha256 === null &&
      v.sizeBytes === null &&
      v.versionId === null));
export const isBatch = (v: unknown): v is ExportBatch =>
  base(v) &&
  record(v) &&
  integer(v.includedCount, 0, 50) &&
  integer(v.failedCount, 0, 50) &&
  v.includedCount + v.failedCount <= v.requestedCount &&
  integer(v.bytes, 0, 41943040) &&
  (v.sha256 === null || hash(v.sha256)) &&
  (v.generatedAt === null || date(v.generatedAt)) &&
  integer(v.retentionDays, 1, 7) &&
  (v.errorCode === null || text(v.errorCode, 80)) &&
  typeof v.canDownload === 'boolean' &&
  record(v.cleanup) &&
  one(v.cleanup.state, cleanupStates) &&
  (v.cleanup.reason === null || text(v.cleanup.reason, 32)) &&
  integer(v.cleanup.attempts) &&
  (v.cleanup.completedAt === null || date(v.cleanup.completedAt)) &&
  integer(v.cleanup.removedBytes) &&
  v.cleanup.backupState === 'BACKUPS_SEPARATE' &&
  Array.isArray(v.items) &&
  v.items.length === v.requestedCount &&
  v.items.every(isItem) &&
  new Set(v.items.map((i) => i.ordinal)).size === v.items.length &&
  v.items.filter((i) => i.state === 'INCLUDED').length === v.includedCount &&
  v.items.filter((i) => i.state === 'FAILED').length === v.failedCount &&
  (!v.canDownload ||
    (one(v.state, ['READY', 'PARTIAL']) &&
      v.includedCount > 0 &&
      v.bytes > 0 &&
      hash(v.sha256) &&
      date(v.generatedAt) &&
      date(v.expiresAt) &&
      v.cleanup.state === 'NONE' &&
      v.items.filter((i) => i.state === 'INCLUDED').every((i) => i.visible)));
const messages: Record<string, string> = {
  BULK_EXPORT_REQUIRED: '需要明确的批量导出资格；管理身份不会自动授予内容读取或导出权限。',
  EXPORT_BATCH_NOT_FOUND: '找不到此导出批次，或当前账号没有权限。',
  EXPORT_ITEM_UNAVAILABLE: '所选成果或来源目前不可读取。',
  EXPORT_SCOPE_UNAVAILABLE: '当前工作空间不可用于所选导出范围。',
  EXPORT_REVISION_CONFLICT: '批次状态已变化，请刷新后再操作。',
  EXPORT_STATE_CONFLICT: '当前批次不能执行此操作。',
  EXPORT_NOT_DOWNLOADABLE: '临时包已过期、已移除或尚未生成。',
  EXPORT_ARCHIVE_UNAVAILABLE: '导出包未通过完整性检查，请重新生成。',
  EXPORT_NO_CONTENT: '没有成功生成的内容，不能下载空包。',
};
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createExportClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (t: string) => `/api/v1/tenants/${id(t)}/export-batches`;
  const send: typeof request = async (...args) => {
    try {
      return await request(...args);
    } catch (e) {
      if (e instanceof IdentityError && messages[e.code]) e.message = messages[e.code];
      throw e;
    }
  };
  const scoped =
    (t: string, b?: string) =>
    (v: unknown): v is ExportBatch =>
      isBatch(v) && v.tenantId === t && (!b || v.id === b);
  return {
    options(
      t: string,
      workspace: string,
      scope: ExportScope,
      format: 'docx' | 'pdf' = 'docx',
      offset = 0,
      object?: string,
      signal?: AbortSignal,
    ) {
      const q = new URLSearchParams({
        workspaceId: id(workspace),
        scope,
        format,
        offset: String(offset),
        limit: '20',
        ...(object ? { objectId: id(object) } : {}),
      });
      return send(
        root(t) + '/options?' + q,
        'GET',
        (v): v is ExportOptions =>
          record(v) &&
          limits(v) &&
          typeof v.hasMore === 'boolean' &&
          typeof v.canExport === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(isChoice) &&
          (scope !== 'ENTERPRISE' || v.items.every((i) => uuid(i.versionId))) &&
          (!object || v.items.every((i) => i.selection.objectId === object)),
        undefined,
        signal,
      );
    },
    list(t: string, workspace: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + `?offset=${offset}&limit=20&workspaceId=${id(workspace)}`,
        'GET',
        (v): v is ExportPage =>
          record(v) &&
          limits(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (i) =>
              base(i) &&
              i.tenantId === t &&
              i.workspaceId === workspace &&
              record(i) &&
              one(i.cleanupState, cleanupStates),
          ),
        undefined,
        signal,
      );
    },
    get(t: string, b: string, signal?: AbortSignal) {
      return send(root(t) + '/' + id(b), 'GET', scoped(t, b), undefined, signal);
    },
    create(t: string, body: CreateExport) {
      return send(
        root(t),
        'POST',
        (v): v is ExportBatch =>
          scoped(t)(v) &&
          v.workspaceId === body.workspaceId &&
          v.scope === body.scope &&
          v.retentionDays === body.retentionDays &&
          v.items.length === body.items.length &&
          v.items.every(
            (i, n) =>
              i.selection.objectId === body.items[n].objectId &&
              i.selection.version === body.items[n].version &&
              i.selection.format === body.items[n].format,
          ),
        body,
      );
    },
    command(
      t: string,
      b: string,
      body: { requestId: string; expectedRevision: number; action: 'RETRY' | 'REMOVE' },
    ) {
      return send(root(t) + '/' + id(b), 'POST', scoped(t, b), body);
    },
    async download(t: string, b: string, signal?: AbortSignal) {
      try {
        const response = await fetcher(root(t) + '/' + id(b) + '/archive', {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
        });
        if (!response.ok) {
          const error: unknown = await response.json().catch(() => null);
          const code =
            record(error) && typeof error.code === 'string' ? error.code : 'EXPORT_ARCHIVE_UNAVAILABLE';
          const e = new IdentityError(code, response.status);
          if (messages[code]) e.message = messages[code];
          throw e;
        }
        const length = Number(response.headers.get('content-length')),
          checksum = response.headers.get('x-content-sha256');
        if (
          response.headers.get('content-type') !== 'application/zip' ||
          !response.headers.get('content-disposition')?.startsWith('attachment;') ||
          !integer(length, 1, 41943040) ||
          !hash(checksum) ||
          !response.body
        )
          throw new IdentityError('CONTRACT_MISMATCH');
        const reader = response.body.getReader(),
          parts: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const p = await reader.read();
            if (p.done) break;
            bytes += p.value.length;
            if (bytes > length) throw new IdentityError('CONTRACT_MISMATCH');
            parts.push(p.value);
          }
        } finally {
          await reader.cancel();
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const p of parts) {
          data.set(p, offset);
          offset += p.length;
        }
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('');
        if (bytes !== length || actual !== checksum || data[0] !== 0x50 || data[1] !== 0x4b)
          throw new IdentityError('CONTRACT_MISMATCH');
        return new Blob([data], { type: 'application/zip' });
      } catch (e) {
        if (e instanceof IdentityError) throw e;
        throw new IdentityError(signal?.aborted ? 'CANCELLED' : 'EXPORT_ARCHIVE_UNAVAILABLE');
      }
    },
  };
}
export const exportClient = createExportClient();
