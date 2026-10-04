import type { Invitation, Tenant } from './identity';

export interface PlatformOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  platform: 'AVAILABLE';
  database: 'AVAILABLE';
  invitationDelivery: 'LOCAL' | 'DISABLED';
  checkedAt: string;
}
export interface TenantOwner {
  accountId: string | null;
  name: string | null;
  state:
    'ASSIGNED' | 'UNDESIGNATED' | 'AWAITING_RESPONSIBILITY' | 'AWAITING_INVITATION' | 'INVITATION_INACTIVE';
}
export interface TenantSummary extends Tenant {
  createdAt: string;
  activeMemberCount: number;
  owner: TenantOwner;
}
export interface ServiceChange {
  status: 'ACTIVE' | 'SUSPENDED';
  internalReason: string;
  publicReason: string;
  changedAt: string;
}
export interface TenantDetail {
  serviceChange: ServiceChange | null;
  owner: TenantOwner;
  tenant: Tenant;
  version: number;
  createdAt: string;
  initialAdminInvitation: Invitation | null;
  activeMemberCount: number;
  workspaceCount: number;
}
export type PlatformAction =
  | 'TENANT_CREATE'
  | 'TENANT_SUSPEND'
  | 'TENANT_RESUME'
  | 'INITIAL_ADMIN_INVITATION_REPLACE'
  | 'INITIAL_ADMIN_INVITATION_REVOKE';
export interface ManagementRecord {
  id: number;
  actorId: string;
  actorName: string;
  action: PlatformAction;
  targetId: string;
  outcome: 'SUCCESS';
  internalReason: string | null;
  publicReason: string | null;
  createdAt: string;
}
export interface ChangeTenantStatus {
  requestId: string;
  expectedVersion: number;
  status: Tenant['status'];
  internalReason: string;
  publicReason: string;
}
export interface ReplaceInitialInvitation {
  requestId: string;
  expectedVersion: number;
  email?: string;
  phone?: string;
}
