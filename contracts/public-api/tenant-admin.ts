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
  email: string;
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
}
export type WorkspaceGrant = Pick<
  TenantMember,
  'accountId' | 'email' | 'displayName' | 'status' | 'accountStatus'
> & { canMaintain: boolean };
export type TenantAction =
  | 'INVITATION_CREATE'
  | 'INVITATION_REVOKE'
  | 'INVITATION_ACCEPT'
  | 'MEMBER_ENABLE'
  | 'MEMBER_DISABLE'
  | 'MEMBER_ROLE'
  | 'WORKSPACE_CREATE'
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
