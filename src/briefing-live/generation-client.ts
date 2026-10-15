import type {
  GenerationBatch,
  GenerationPolicy,
  GenerationState,
} from '../../contracts/public-api/briefing-generation';
import { createIdentityRequest, record, uuid } from '../identity/client';
const statuses = [
  'QUEUED',
  'RUNNING',
  'WAITING_DATA',
  'WAITING_RESOURCE',
  'WAITING_CAPABILITY',
  'SUCCEEDED',
  'NO_NEW_CONTENT',
  'FAILED',
  'CANCELLED',
  'AUTHORITY_REVOKED',
];
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const batch = (v: unknown): v is GenerationBatch =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  typeof v.trigger === 'string' &&
  nullableText(v.businessType) &&
  statuses.includes(String(v.status)) &&
  nullableText(v.reason) &&
  (v.taskId === null || uuid(v.taskId)) &&
  Array.isArray(v.cardIds) &&
  v.cardIds.every(uuid) &&
  typeof v.createdAt === 'string' &&
  Number.isFinite(Date.parse(v.createdAt)) &&
  (v.finishedAt === null || (typeof v.finishedAt === 'string' && Number.isFinite(Date.parse(v.finishedAt))));
const policy = (v: unknown): v is GenerationPolicy =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  typeof v.workspaceName === 'string' &&
  typeof v.enabled === 'boolean' &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) > 0 &&
  nullableText(v.reason);
const quota = (v: unknown) =>
  record(v) &&
  ['limit', 'used', 'reserved', 'remaining'].every((k) => Number.isSafeInteger(v[k]) && Number(v[k]) >= 0);
const request = createIdentityRequest();
const root = (tenant: string) => `/api/v1/tenants/${tenant}/briefing/generation`;
export const generationClient = {
  state: (tenant: string, signal?: AbortSignal) =>
    request(
      root(tenant),
      'GET',
      (v): v is GenerationState =>
        record(v) &&
        Array.isArray(v.policies) &&
        v.policies.every(policy) &&
        Array.isArray(v.batches) &&
        v.batches.every(batch) &&
        (v.quota === undefined || quota(v.quota)) &&
        (v.automaticQuota === undefined || quota(v.automaticQuota)),
      undefined,
      signal,
    ),
  batch: (tenant: string, id: string, signal?: AbortSignal) =>
    request(root(tenant) + `/${id}`, 'GET', batch, undefined, signal),
  generate: (tenant: string, body: { requestId: string; workspaceId?: string; businessType?: string }) =>
    request(root(tenant), 'POST', batch, body),
  generateSelection: (
    tenant: string,
    /** topic is only sent when the server advertises capabilities.TOPIC. */
    body: { requestId: string; workspaceId?: string; count: number; types: string[]; topic?: string },
  ) =>
    request(
      root(tenant) + '/selection',
      'POST',
      (v): v is GenerationBatch[] => Array.isArray(v) && v.every(batch),
      body,
    ),
  cancel: (tenant: string, id: string) => request(root(tenant) + `/${id}/cancel`, 'POST', batch, {}),
  configure: (tenant: string, p: GenerationPolicy) =>
    request(root(tenant) + '/policy', 'POST', policy, {
      workspaceId: p.workspaceId,
      expectedRevision: p.revision,
      enabled: !p.enabled,
    }),
};
