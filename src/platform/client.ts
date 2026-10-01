import type { CreateTenant, Invitation, Tenant, TenantCreated } from '../../contracts/public-api/identity';
import type {
  PlatformOverview,
  TenantDetail,
  ManagementRecord,
  ChangeTenantStatus,
  ReplaceInitialInvitation,
} from '../../contracts/public-api/platform-admin';
import { createIdentityRequest, isContact, IdentityError, record, text, uuid } from '../identity/client.ts';

const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
export const isTenant = (v: unknown): v is Tenant =>
  record(v) && uuid(v.id) && text(v.name) && ['ACTIVE', 'SUSPENDED'].includes(String(v.status));
const isInvitation = (v: unknown): v is Invitation =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  isContact(v) &&
  v.role === 'TENANT_ADMIN' &&
  ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(String(v.status)) &&
  date(v.expiresAt);
export const isDetail = (v: unknown): v is TenantDetail =>
  record(v) &&
  isTenant(v.tenant) &&
  count(v.version) &&
  date(v.createdAt) &&
  count(v.activeMemberCount) &&
  count(v.workspaceCount) &&
  (v.initialAdminInvitation === null ||
    (isInvitation(v.initialAdminInvitation) && v.initialAdminInvitation.tenantId === v.tenant.id));
const isOverview = (v: unknown): v is PlatformOverview =>
  record(v) &&
  count(v.totalTenants) &&
  count(v.activeTenants) &&
  count(v.suspendedTenants) &&
  v.totalTenants === v.activeTenants + v.suspendedTenants &&
  v.platform === 'AVAILABLE' &&
  v.database === 'AVAILABLE' &&
  ['LOCAL', 'DISABLED'].includes(String(v.invitationDelivery)) &&
  date(v.checkedAt);
const isCreated = (v: unknown): v is TenantCreated =>
  record(v) && isTenant(v.tenant) && isInvitation(v.invitation) && v.invitation.tenantId === v.tenant.id;
const isRecord = (v: unknown): v is ManagementRecord =>
  record(v) &&
  count(v.id) &&
  uuid(v.actorId) &&
  text(v.actorName) &&
  uuid(v.targetId) &&
  v.outcome === 'SUCCESS' &&
  date(v.createdAt) &&
  ['TENANT_CREATE', 'TENANT_SUSPEND', 'TENANT_RESUME', 'INITIAL_ADMIN_INVITATION_REPLACE'].includes(
    String(v.action),
  );
const list =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is T[] =>
    Array.isArray(v) && v.every(check);

export function createPlatformClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const path = (id: string) => {
    if (!uuid(id)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/platform-admin/v1/tenants/${id}`;
  };
  const detail = async (id: string, suffix = '', body?: unknown, signal?: AbortSignal) => {
    const value = await request(path(id) + suffix, body ? 'POST' : 'GET', isDetail, body, signal);
    if (value.tenant.id !== id) throw new IdentityError('CONTRACT_MISMATCH');
    return value;
  };
  return {
    overview: (signal?: AbortSignal) =>
      request('/api/platform-admin/v1/overview', 'GET', isOverview, undefined, signal),
    tenants: (q: string, status: string, offset = 0, limit = 21, signal?: AbortSignal) =>
      request(
        '/api/platform-admin/v1/tenants?' +
          new URLSearchParams({ q, status, offset: String(offset), limit: String(limit) }),
        'GET',
        list(isTenant),
        undefined,
        signal,
      ),
    create: (body: CreateTenant) => request('/api/platform-admin/v1/tenants', 'POST', isCreated, body),
    detail: (id: string, signal?: AbortSignal) => detail(id, '', undefined, signal),
    status: (id: string, body: ChangeTenantStatus) => detail(id, '/status', body),
    replaceInvitation: (id: string, body: ReplaceInitialInvitation) =>
      detail(id, '/initial-admin-invitation', body),
    records: (id: string, offset = 0, signal?: AbortSignal) =>
      request(path(id) + `/records?offset=${offset}&limit=21`, 'GET', list(isRecord), undefined, signal),
  };
}
export const platformClient = createPlatformClient();
