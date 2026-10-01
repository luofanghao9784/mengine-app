/** Duties govern actions; no management duty implies access to private content. */
export type Capability = 'OWNER' | 'TENANT_CONFIG' | 'PROFILE_MAINTAIN' | 'CONTENT_MAINTAIN'
  | 'EXPERIENCE_MAINTAIN' | 'EVALUATION_MAINTAIN' | 'LIFECYCLE_PURGE' | 'BULK_EXPORT'
  | 'METHOD_ADOPT' | 'PLAN_CONFIGURE' | 'MEMBER_OFFBOARD' | 'TENANT_EXIT';
export interface ScopeCapability { workspaceId: string | null; capability: Capability }
export interface GovernanceSnapshot {
  tenantId: string; ownerId: string | null; revision: number; owner: boolean; canConfigure: boolean;
  canAcceptInitialResponsibility: boolean; canEnterManagement: boolean; capabilities: ScopeCapability[];
  pendingHandover: { id: string; fromAccount: string; toAccount: string; status: 'PENDING' } | null;
}
export interface GovernanceChange { requestId: string; expectedVersion: number }
export interface CapabilityChange extends GovernanceChange {
  accountId: string; workspaceId: string | null;
  capability: Exclude<Capability, 'OWNER' | 'TENANT_CONFIG' | 'CONTENT_MAINTAIN'>; enabled: boolean;
}
export interface MemberRoleChange extends GovernanceChange { role: 'TENANT_ADMIN' | 'MEMBER' }
export interface MemberRoleResult { accountId: string; role: 'TENANT_ADMIN' | 'MEMBER'; version: number }
export interface HandoverOffer extends GovernanceChange { accountId: string }
export interface RecoveryRequest { requestId: string; reason: 'OWNER_UNAVAILABLE' | 'LEGACY_OWNER_UNVERIFIED' }
export interface RecoveryReceipt {
  id: string; tenantId: string; reason: RecoveryRequest['reason'];
  status: 'PENDING_VERIFICATION'; createdAt: string;
}

export interface AssignedCapability extends ScopeCapability { accountId: string; grantedBy: string; createdAt: string }
