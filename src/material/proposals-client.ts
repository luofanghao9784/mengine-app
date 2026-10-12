import { createIdentityRequest, IdentityError, record, uuid, text } from '../identity/client.ts';
import type {
  GovernanceProposal,
  GovernancePreparation,
  GovernanceProposalCreate,
} from '../../contracts/public-api/governance-proposals.ts';
const bounded = (v: unknown, n: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= n;
export function isProposal(v: unknown): v is GovernanceProposal {
  if (
    !record(v) ||
    ![v.id, v.tenantId, v.materialId, v.actorId].every(uuid) ||
    !text(v.sourceName) ||
    !['TAGS', 'SUMMARY'].includes(String(v.kind)) ||
    !['PENDING', 'APPLIED', 'REJECTED'].includes(String(v.status)) ||
    typeof v.stale !== 'boolean' ||
    !(v.resolvedBy === null || uuid(v.resolvedBy)) ||
    !text(v.createdAt) ||
    !(v.resolvedAt === null || text(v.resolvedAt))
  )
    return false;
  if (v.stale) return v.patch === null && v.reason === null;
  const p = v.patch;
  if (
    !record(p) ||
    !bounded(v.reason, 500) ||
    !(p.executionClass === null || ['live', 'verification'].includes(String(p.executionClass))) ||
    !(p.modelName === null || text(p.modelName)) ||
    !Array.isArray(p.evidence) ||
    p.evidence.length > 4 ||
    p.evidence.some((e) => !record(e) || !uuid(e.chunkId) || !bounded(e.quote, 200) || e.quote.length < 6)
  )
    return false;
  return v.kind === 'TAGS'
    ? p.summary === null &&
        Array.isArray(p.tags) &&
        p.tags.length > 0 &&
        p.tags.length <= 12 &&
        p.tags.every((t) => bounded(t, 40)) &&
        p.evidence.length === 0
    : p.tags === null && bounded(p.summary, 2000);
}
export const isPreparation = (v: unknown): v is GovernancePreparation =>
  record(v) &&
  uuid(v.versionId) &&
  Number.isSafeInteger(v.version) &&
  Number(v.version) > 0 &&
  (v.generation === null || (Number.isSafeInteger(v.generation) && Number(v.generation) > 0)) &&
  [v.tagsRevision, v.summaryRevision].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) &&
  Array.isArray(v.tags) &&
  v.tags.length <= 12 &&
  v.tags.every((t) => bounded(t, 40)) &&
  (v.summary === null || bounded(v.summary, 2000)) &&
  (v.summaryExecutionClass === null || ['live', 'verification'].includes(String(v.summaryExecutionClass))) &&
  typeof v.canMaintain === 'boolean';
export function createProposalsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
    if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
    return v;
  };
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/governance-proposals`;
  const scoped =
    (tenant: string, proposal?: string) =>
    (v: unknown): v is GovernanceProposal =>
      isProposal(v) && v.tenantId === tenant && (!proposal || proposal === v.id);
  return {
    prepare(tenant: string, material: string, signal?: AbortSignal) {
      return request(root(tenant) + '/prepare/' + id(material), 'GET', isPreparation, undefined, signal);
    },
    list(tenant: string, status: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?status=${encodeURIComponent(status)}&offset=${offset}`,
        'GET',
        (v): v is { items: GovernanceProposal[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          typeof v.hasMore === 'boolean' &&
          v.items.every((x) => scoped(tenant)(x) && (status === 'ALL' || x.status === status)),
        undefined,
        signal,
      );
    },
    detail(tenant: string, proposal: string, signal?: AbortSignal) {
      return request(root(tenant) + '/' + id(proposal), 'GET', scoped(tenant, proposal), undefined, signal);
    },
    create(tenant: string, material: string, body: GovernanceProposalCreate, requestId: string) {
      return request(
        root(tenant) + '/sources/' + id(material),
        'POST',
        (v): v is GovernanceProposal => scoped(tenant)(v) && v.materialId === material,
        { ...body, requestId: id(requestId) },
      );
    },
    resolve(tenant: string, proposal: string, decision: 'APPROVE' | 'REJECT', requestId: string) {
      return request(root(tenant) + '/' + id(proposal) + '/resolve', 'POST', scoped(tenant, proposal), {
        decision,
        requestId: id(requestId),
      });
    },
  };
}
export const proposals = createProposalsClient();
