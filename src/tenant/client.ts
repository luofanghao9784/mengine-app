import type { Invitation, InviteMember } from '../../contracts/public-api/identity';
import type {
  TenantOverview,
  TenantMember,
  SharedWorkspace,
  WorkspaceGrant,
  TenantRecord,
  VersionedChange,
  EmergencyDisable,
  EmergencyDisableReceipt,
} from '../../contracts/public-api/tenant-admin';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const active = (v: unknown) => v === 'ACTIVE' || v === 'DISABLED';
const nullableText = (v: unknown) => v === null || text(v);
const role = (v: unknown) => v === 'TENANT_ADMIN' || v === 'MEMBER';
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
export const isOverview = (v: unknown): v is TenantOverview =>
  record(v) &&
  uuid(v.tenantId) &&
  text(v.name) &&
  count(v.version) &&
  count(v.activeMemberCount) &&
  count(v.disabledMemberCount) &&
  count(v.sharedWorkspaceCount) &&
  ['LOCAL', 'DISABLED'].includes(String(v.invitationDelivery));
const isPerson = (v: unknown) =>
  record(v) &&
  uuid(v.accountId) &&
  text(v.email) &&
  text(v.displayName) &&
  active(v.status) &&
  active(v.accountStatus);
export const isGrant = (v: unknown): v is WorkspaceGrant =>
  record(v) && isPerson(v) && typeof v.canMaintain === 'boolean';
export const isMember = (v: unknown): v is TenantMember =>
  record(v) && role(v.role) && count(v.version) && isPerson(v);
export const isSpace = (v: unknown): v is SharedWorkspace =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  text(v.name) &&
  v.kind === 'SHARED' &&
  count(v.version) &&
  count(v.memberCount);
export const isInvitation = (v: unknown): v is Invitation =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  text(v.email) &&
  role(v.role) &&
  ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(String(v.status)) &&
  date(v.expiresAt);
const actions = [
  'INVITATION_CREATE',
  'INVITATION_REVOKE',
  'INVITATION_ACCEPT',
  'MEMBER_ENABLE',
  'MEMBER_DISABLE',
  'MEMBER_SECURITY_DISABLE',
  'MEMBER_ROLE',
  'WORKSPACE_CREATE',
  'WORKSPACE_RENAME',
  'WORKSPACE_GRANT',
  'WORKSPACE_REVOKE',
  'WORKSPACE_MAINTAIN',
  'WORKSPACE_READONLY',
  'TENANT_RENAME',
];
export const isRecord = (v: unknown): v is TenantRecord =>
  record(v) &&
  count(v.id) &&
  uuid(v.actorId) &&
  text(v.actorName) &&
  actions.includes(String(v.action)) &&
  uuid(v.targetId) &&
  nullableText(v.targetName) &&
  (v.relatedAccountId === null || uuid(v.relatedAccountId)) &&
  nullableText(v.relatedAccountName) &&
  date(v.createdAt);
const list =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is T[] =>
    Array.isArray(v) && v.every(check);
const id = (value: string) => {
  if (!uuid(value)) throw new IdentityError('INVALID_REQUEST', 400);
  return value;
};
const page = (offset: number, extra: Record<string, string> = {}) =>
  '?' + new URLSearchParams({ offset: String(offset), limit: '21', ...extra });
export function createTenantClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const path = (tenant: string) => `/api/tenant-admin/v1/tenants/${id(tenant)}`;
  const scoped =
    <T extends { tenantId: string }>(tenant: string, check: (v: unknown) => v is T) =>
    (v: unknown): v is T =>
      check(v) && v.tenantId === tenant;
  const spaceCheck =
    (tenant: string, space: string) =>
    (v: unknown): v is SharedWorkspace =>
      isSpace(v) && v.tenantId === tenant && v.id === space;
  return {
    overview: (tenant: string, signal?: AbortSignal) =>
      request(path(tenant) + '/overview', 'GET', scoped(tenant, isOverview), undefined, signal),
    settings: (tenant: string, body: VersionedChange & { name: string }) =>
      request(path(tenant) + '/settings', 'POST', scoped(tenant, isOverview), body),
    members: (tenant: string, q = '', status = '', offset = 0, signal?: AbortSignal) =>
      request(
        path(tenant) + '/members' + page(offset, { q, status }),
        'GET',
        list(isMember),
        undefined,
        signal,
      ),
    status: (tenant: string, account: string, body: VersionedChange & { status: TenantMember['status'] }) =>
      request(
        path(tenant) + `/members/${id(account)}/status`,
        'POST',
        (v): v is TenantMember => isMember(v) && v.accountId === account,
        body,
      ),
    emergencyDisable: (tenant: string, account: string, body: EmergencyDisable) =>
      request(
        path(tenant) + `/members/${id(account)}/emergency-disable`,
        'POST',
        (v): v is EmergencyDisableReceipt =>
          record(v) &&
          v.accountId === account &&
          v.status === 'DISABLED' &&
          count(v.version) &&
          v.securityAction === 'SECURITY_RISK' &&
          ((v.recoveryRequestId === null && v.recoveryStatus === null) ||
            (uuid(v.recoveryRequestId) && v.recoveryStatus === 'PENDING_VERIFICATION')),
        body,
      ),
    invitations: (tenant: string, offset = 0, signal?: AbortSignal) =>
      request(
        path(tenant) + '/invitations' + page(offset),
        'GET',
        list(scoped(tenant, isInvitation)),
        undefined,
        signal,
      ),
    invite: (tenant: string, body: InviteMember) =>
      request(path(tenant) + '/invitations', 'POST', scoped(tenant, isInvitation), body),
    revoke: (tenant: string, invitation: string) =>
      request(path(tenant) + `/invitations/${id(invitation)}`, 'DELETE', (v): v is null => v === null),
    spaces: (tenant: string, q = '', offset = 0, signal?: AbortSignal) =>
      request(
        path(tenant) + '/workspaces' + page(offset, { q }),
        'GET',
        list(scoped(tenant, isSpace)),
        undefined,
        signal,
      ),
    space: (tenant: string, space: string, signal?: AbortSignal) =>
      request(path(tenant) + `/workspaces/${id(space)}`, 'GET', spaceCheck(tenant, space), undefined, signal),
    createSpace: (tenant: string, body: { requestId: string; name: string }) =>
      request(path(tenant) + '/workspaces', 'POST', scoped(tenant, isSpace), body),
    renameSpace: (tenant: string, space: string, body: VersionedChange & { name: string }) =>
      request(path(tenant) + `/workspaces/${id(space)}/settings`, 'POST', spaceCheck(tenant, space), body),
    grants: (tenant: string, space: string, offset = 0, signal?: AbortSignal) =>
      request(
        path(tenant) + `/workspaces/${id(space)}/members` + page(offset),
        'GET',
        list(isGrant),
        undefined,
        signal,
      ),
    grant: (tenant: string, space: string, account: string, body: VersionedChange & { enabled: boolean }) =>
      request(
        path(tenant) + `/workspaces/${id(space)}/members/${id(account)}`,
        'POST',
        spaceCheck(tenant, space),
        body,
      ),
    maintenance: (
      tenant: string,
      space: string,
      account: string,
      body: VersionedChange & { enabled: boolean },
    ) =>
      request(
        path(tenant) + `/workspaces/${id(space)}/members/${id(account)}/maintenance`,
        'POST',
        spaceCheck(tenant, space),
        body,
      ),
    records: (tenant: string, offset = 0, signal?: AbortSignal) =>
      request(path(tenant) + '/records' + page(offset), 'GET', list(isRecord), undefined, signal),
  };
}
export const tenantClient = createTenantClient();
