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
export interface TenantDetail {
  tenant: Tenant;
  version: number;
  createdAt: string;
  initialAdminInvitation: Invitation | null;
  activeMemberCount: number;
  workspaceCount: number;
}
export type PlatformAction =
  'TENANT_CREATE' | 'TENANT_SUSPEND' | 'TENANT_RESUME' | 'INITIAL_ADMIN_INVITATION_REPLACE';
export interface ManagementRecord {
  id: number;
  actorId: string;
  actorName: string;
  action: PlatformAction;
  targetId: string;
  outcome: 'SUCCESS';
  createdAt: string;
}
export interface ChangeTenantStatus {
  requestId: string;
  expectedVersion: number;
  status: Tenant['status'];
}
export interface ReplaceInitialInvitation {
  requestId: string;
  expectedVersion: number;
  email?: string;
  phone?: string;
}
