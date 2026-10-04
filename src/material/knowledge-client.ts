import type {
  MaterialProcessingPage,
  KnowledgeAnalysis,
  KnowledgeChunk,
  KnowledgeResults,
} from '../../contracts/public-api/knowledge';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export const isChunk = (v: unknown): v is KnowledgeChunk =>
  record(v) &&
  [v.id, v.tenantId, v.workspaceId, v.materialId, v.versionId, v.runId].every(uuid) &&
  count(v.version) &&
  v.version > 0 &&
  text(v.filename) &&
  text(v.locator) &&
  text(v.content) &&
  ['TEXT', 'TABLE', 'OCR'].includes(String(v.method));
export const isAnalysis = (v: unknown): v is KnowledgeAnalysis =>
  record(v) &&
  [v.tenantId, v.workspaceId, v.materialId, v.versionId].every(uuid) &&
  count(v.generation) &&
  ['NOT_STARTED', 'QUEUED', 'RUNNING', 'READY', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(
    String(v.status),
  ) &&
  (v.parserVersion === null || text(v.parserVersion)) &&
  Array.isArray(v.warnings) &&
  v.warnings.every(text) &&
  typeof v.canMaintain === 'boolean' &&
  typeof v.available === 'boolean' &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.chunks) &&
  v.chunks.every(
    (c) =>
      isChunk(c) &&
      c.tenantId === v.tenantId &&
      c.workspaceId === v.workspaceId &&
      c.materialId === v.materialId &&
      c.versionId === v.versionId,
  );
export const isProcessing = (v: unknown): v is MaterialProcessingPage =>
  record(v) &&
  uuid(v.tenantId) &&
  (v.workspaceId === null || uuid(v.workspaceId)) &&
  typeof v.query === 'string' &&
  ['ALL', 'READY', 'PROCESSING', 'ATTENTION', 'NOT_STARTED'].includes(String(v.state)) &&
  typeof v.parserAvailable === 'boolean' &&
  count(v.maxUploadBytes) &&
  v.maxUploadBytes > 0 &&
  record(v.summary) &&
  [v.summary.total, v.summary.ready, v.summary.processing, v.summary.attention, v.summary.notStarted].every(
    count,
  ) &&
  v.summary.total ===
    Number(v.summary.ready) +
      Number(v.summary.processing) +
      Number(v.summary.attention) +
      Number(v.summary.notStarted) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.items) &&
  v.items.length <= 50 &&
  v.items.every(
    (x) =>
      record(x) &&
      [x.materialId, x.workspaceId, x.versionId].every(uuid) &&
      (v.workspaceId === null || x.workspaceId === v.workspaceId) &&
      text(x.workspaceName) &&
      text(x.name) &&
      count(x.version) &&
      x.version > 0 &&
      count(x.sizeBytes) &&
      count(x.generation) &&
      ['NOT_STARTED', 'QUEUED', 'RUNNING', 'READY', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(
        String(x.status),
      ) &&
      text(x.updatedAt) &&
      Number.isFinite(Date.parse(x.updatedAt)) &&
      (x.finishedAt === null || (text(x.finishedAt) && Number.isFinite(Date.parse(x.finishedAt)))) &&
      typeof x.canMaintain === 'boolean',
  );
const id = (value: string) => {
  if (!uuid(value)) throw new IdentityError('INVALID_REQUEST', 400);
  return value;
};
export function createKnowledgeClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}`;
  const path = (tenant: string, space: string, material: string, version: string) =>
    `${root(tenant)}/workspaces/${id(space)}/materials/${id(material)}/versions/${id(version)}/analysis`;
  const scoped =
    (tenant: string, space: string, material: string, version: string) =>
    (v: unknown): v is KnowledgeAnalysis =>
      isAnalysis(v) &&
      v.tenantId === tenant &&
      v.workspaceId === space &&
      v.materialId === material &&
      v.versionId === version;
  return {
    processing(
      tenant: string,
      space: string | null,
      q: string,
      state: MaterialProcessingPage['state'],
      offset = 0,
      signal?: AbortSignal,
    ) {
      const params = new URLSearchParams({ q, state, offset: String(offset), limit: '20' });
      if (space) params.set('workspace', id(space));
      return request(
        root(tenant) + '/knowledge/processing?' + params,
        'GET',
        (v): v is MaterialProcessingPage =>
          isProcessing(v) &&
          v.tenantId === tenant &&
          v.workspaceId === space &&
          v.query === q.trim() &&
          v.state === state,
        undefined,
        signal,
      );
    },
    analysis(
      tenant: string,
      space: string,
      material: string,
      version: string,
      offset = 0,
      signal?: AbortSignal,
    ) {
      return request(
        path(tenant, space, material, version) + `?offset=${offset}&limit=20`,
        'GET',
        scoped(tenant, space, material, version),
        undefined,
        signal,
      );
    },
    parse(
      tenant: string,
      space: string,
      material: string,
      version: string,
      body: { requestId: string; expectedGeneration: number },
      signal?: AbortSignal,
    ) {
      return request(
        path(tenant, space, material, version),
        'POST',
        scoped(tenant, space, material, version),
        body,
        signal,
      );
    },
    search(tenant: string, space: string | null, q: string, offset = 0, signal?: AbortSignal) {
      const query = new URLSearchParams({ q, offset: String(offset), limit: '20' });
      if (space) query.set('workspace', id(space));
      return request(
        root(tenant) + '/knowledge/search?' + query,
        'GET',
        (v): v is KnowledgeResults =>
          record(v) &&
          v.tenantId === tenant &&
          v.workspaceId === space &&
          v.query === q.trim() &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every((c) => isChunk(c) && c.tenantId === tenant && (!space || c.workspaceId === space)),
        undefined,
        signal,
      );
    },
    citation(tenant: string, chunk: string, signal?: AbortSignal) {
      return request(
        root(tenant) + '/knowledge/chunks/' + id(chunk),
        'GET',
        (v): v is KnowledgeChunk => isChunk(v) && v.tenantId === tenant && v.id === chunk,
        undefined,
        signal,
      );
    },
  };
}
export const knowledgeClient = createKnowledgeClient();
