import type { TenantRole } from './identity';
export interface TenantOverview {
  tenantId: string;
  name: string;
  version: number;
  activeMemberCount: number;
  disabledMemberCount: number;
  sharedWorkspaceCount: number;
  invitationDelivery: 'LOCAL' | 'DISABLED';
}
export interface TenantMember {
  accountId: string;
  email: string | null;
  phone?: string | null;
  displayName: string;
  role: TenantRole;
  status: 'ACTIVE' | 'DISABLED';
  accountStatus: 'ACTIVE' | 'DISABLED';
  version: number;
}
export interface SharedWorkspace {
  id: string;
  tenantId: string;
  name: string;
  kind: 'SHARED';
  version: number;
  memberCount: number;
  ownerId: string | null;
  ownerName: string | null;
  description: string;
}
export type WorkspaceGrant = Pick<
  TenantMember,
  'accountId' | 'email' | 'phone' | 'displayName' | 'status' | 'accountStatus'
> & { canMaintain: boolean };
export type TenantAction =
  | 'INVITATION_CREATE'
  | 'INVITATION_REVOKE'
  | 'INVITATION_ACCEPT'
  | 'MEMBER_ENABLE'
  | 'MEMBER_DISABLE'
  | 'MEMBER_SECURITY_DISABLE'
  | 'GOVERNANCE_ROLE'
  | 'OWNER_ACCEPT'
  | 'OWNER_HANDOVER_OFFER'
  | 'OWNER_HANDOVER_ACCEPT'
  | 'OWNER_HANDOVER_REJECT'
  | 'OWNER_HANDOVER_CANCEL'
  | 'MEMBER_ROLE'
  | 'WORKSPACE_CREATE'
  | 'WORKSPACE_OWNER_CHANGE'
  | 'WORKSPACE_RENAME'
  | 'WORKSPACE_GRANT'
  | 'WORKSPACE_REVOKE'
  | 'WORKSPACE_MAINTAIN'
  | 'WORKSPACE_READONLY'
  | 'TENANT_RENAME';
export interface TenantRecord {
  id: number;
  actorId: string;
  actorName: string;
  action: TenantAction;
  targetId: string;
  targetName: string | null;
  relatedAccountId: string | null;
  relatedAccountName: string | null;
  createdAt: string;
}
export interface VersionedChange {
  requestId: string;
  expectedVersion: number;
}
/** Explicit tenant-scoped safety stop. It cannot transfer ownership or disable other tenant memberships. */
export interface EmergencyDisable extends VersionedChange {
  securityAction: 'SECURITY_RISK';
}
/** Historical operation receipt; status is not a substitute for refetching the current member state. */
export interface EmergencyDisableReceipt {
  accountId: string;
  status: 'DISABLED';
  version: number;
  securityAction: 'SECURITY_RISK';
  recoveryRequestId: string | null;
  recoveryStatus: 'PENDING_VERIFICATION' | null;
}

export interface SpaceOwnerChange {
  id: string;
  actorName: string;
  previousOwnerName: string | null;
  nextOwnerName: string;
  previousAccess: 'READ' | 'MAINTAIN' | 'REMOVE' | 'NONE';
  createdAt: string;
}

export interface TenantMemberDetail { tenantId: string; member: TenantMember; owner: boolean; canOffboard: boolean; offboarded: boolean; departureId: string | null }
