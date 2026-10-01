/** Platform-owned M2-A1 DTOs. Runtime validation remains required at HTTP boundaries. */
export type TenantRole = 'TENANT_ADMIN' | 'MEMBER';
export interface Account {
  id: string;
  email: string;
  displayName: string;
}
export interface Membership {
  tenantId: string;
  tenantName: string;
  role: TenantRole;
}
export interface Identity {
  account: Account;
  platformAdmin: boolean;
  memberships: Membership[];
}
export interface Tenant {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
}
export interface Workspace {
  id: string;
  name: string;
  kind: 'PERSONAL' | 'SHARED';
}
export interface TenantContext {
  tenant: Tenant;
  role: TenantRole;
  workspaces: Workspace[];
}
export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}
export interface TenantCreated {
  tenant: Tenant;
  invitation: Invitation;
}
export interface Csrf {
  token: string;
  headerName: 'X-CSRF-TOKEN';
}
export interface CreateTenant {
  requestId: string;
  name: string;
  adminEmail: string;
  /** Explicit nomination; invited member must separately accept this responsibility. */
  designateAuthorizationOwner?: boolean;
}
export interface InviteMember {
  requestId: string;
  email: string;
}
export type AcceptInvitation = { token: string; displayName: string; password: string } | { token: string };
