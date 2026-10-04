import type {
  AssignedCapability,
  Capability,
  CapabilityChange,
  GovernanceChange,
  GovernanceSnapshot,
  HandoverOffer,
  MemberRoleChange,
  MemberRoleResult,
  RecoveryReceipt,
  RecoveryRequest,
} from '../../contracts/public-api/governance.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const capabilityLabels: Record<Capability, string> = {
  OWNER: '企业授权负责人',
  TENANT_CONFIG: '企业配置管理',
  PROFILE_MAINTAIN: '档案维护',
  CONTENT_MAINTAIN: '资料维护',
  EXPERIENCE_MAINTAIN: '经验维护',
  EVALUATION_MAINTAIN: '评估维护',
  LIFECYCLE_PURGE: '永久清理',
  BULK_EXPORT: '批量导出',
  METHOD_ADOPT: '方法采用',
  PLAN_CONFIGURE: '持续计划配置',
  MEMBER_OFFBOARD: '成员正式离职',
  TENANT_EXIT: '企业正式退出',
};
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const capability = (v: unknown): v is Capability =>
  typeof v === 'string' && Object.hasOwn(capabilityLabels, v);
const scope = (v: unknown) =>
  record(v) && (v.workspaceId === null || uuid(v.workspaceId)) && capability(v.capability);
const handover = (v: unknown) =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.fromAccount) &&
  uuid(v.toAccount) &&
  text(v.fromName) &&
  text(v.toName) &&
  ['TENANT_ADMIN', 'MEMBER'].includes(String(v.previousOwnerRole));
export const isSnapshot = (v: unknown): v is GovernanceSnapshot =>
  record(v) &&
  uuid(v.tenantId) &&
  (v.ownerId === null || uuid(v.ownerId)) &&
  count(v.revision) &&
  ['owner', 'canConfigure', 'canAcceptInitialResponsibility', 'canEnterManagement'].every(
    (k) => typeof v[k] === 'boolean',
  ) &&
  Array.isArray(v.capabilities) &&
  v.capabilities.every(scope) &&
  (v.ownerName === undefined || v.ownerName === null || text(v.ownerName)) &&
  (v.pendingHandover === null ||
    (handover(v.pendingHandover) && record(v.pendingHandover) && v.pendingHandover.status === 'PENDING')) &&
  (v.latestHandover === undefined ||
    v.latestHandover === null ||
    (handover(v.latestHandover) &&
      record(v.latestHandover) &&
      ['ACCEPTED', 'REJECTED', 'CANCELLED'].includes(String(v.latestHandover.status))));
export const isRecovery = (v: unknown): v is RecoveryReceipt =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  ['OWNER_UNAVAILABLE', 'LEGACY_OWNER_UNVERIFIED'].includes(String(v.reason)) &&
  v.status === 'PENDING_VERIFICATION' &&
  text(v.createdAt) &&
  Number.isFinite(Date.parse(v.createdAt));
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createGovernanceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    path = (tenant: string) => `/api/v1/tenants/${id(tenant)}/governance`;
  const check =
    (tenant: string) =>
    (v: unknown): v is GovernanceSnapshot =>
      isSnapshot(v) && v.tenantId === tenant;
  const recoveryCheck =
    (tenant: string) =>
    (v: unknown): v is RecoveryReceipt =>
      isRecovery(v) && v.tenantId === tenant;
  const platform = (tenant: string) =>
    `/api/platform-admin/v1/tenants/${id(tenant)}/governance-recovery-requests`;
  return {
    snapshot: (tenant: string, signal?: AbortSignal) =>
      request(path(tenant), 'GET', check(tenant), undefined, signal),
    acceptInitial: (tenant: string, body: GovernanceChange) =>
      request(path(tenant) + '/accept-initial-responsibility', 'POST', check(tenant), body),
    offer: (tenant: string, body: HandoverOffer) =>
      request(path(tenant) + '/handover', 'POST', check(tenant), body),
    acceptHandover: (tenant: string, handover: string, body: GovernanceChange) =>
      request(path(tenant) + `/handover/${id(handover)}/accept`, 'POST', check(tenant), body),
    closeHandover: (tenant: string, handover: string, action: 'reject' | 'cancel', body: GovernanceChange) =>
      request(path(tenant) + `/handover/${id(handover)}/${action}`, 'POST', check(tenant), body),
    appoint: (tenant: string, account: string, body: MemberRoleChange) =>
      request(
        path(tenant) + `/members/${id(account)}/role`,
        'POST',
        (v): v is MemberRoleResult =>
          record(v) &&
          v.accountId === account &&
          ['MEMBER', 'TENANT_ADMIN'].includes(String(v.role)) &&
          count(v.version),
        body,
      ),
    capability: (tenant: string, body: CapabilityChange) =>
      request(path(tenant) + '/capabilities', 'POST', check(tenant), body),
    assigned: (tenant: string, account: string, signal?: AbortSignal) =>
      request(
        path(tenant) + `/capabilities?accountId=${id(account)}`,
        'GET',
        (v): v is AssignedCapability[] =>
          Array.isArray(v) &&
          v.every(
            (x) =>
              record(x) &&
              x.accountId === account &&
              scope(x) &&
              uuid(x.grantedBy) &&
              text(x.createdAt) &&
              Number.isFinite(Date.parse(x.createdAt)),
          ),
        undefined,
        signal,
      ),
    recovery: (tenant: string, body: RecoveryRequest) =>
      request(path(tenant) + '/recovery-requests', 'POST', recoveryCheck(tenant), body),
    platformRecovery: (tenant: string, body: RecoveryRequest) =>
      request(platform(tenant), 'POST', recoveryCheck(tenant), body),
    platformRecoveryRecord: (tenant: string, recovery: string, signal?: AbortSignal) =>
      request(
        platform(tenant) + `/${id(recovery)}`,
        'GET',
        (v): v is RecoveryReceipt => isRecovery(v) && v.tenantId === tenant && v.id === recovery,
        undefined,
        signal,
      ),
  };
}
export const governanceClient = createGovernanceClient();
