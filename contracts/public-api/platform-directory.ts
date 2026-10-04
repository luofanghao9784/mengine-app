export interface CustomerAccount {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  tenantCount: number;
}
export interface AccountDetail {
  account: CustomerAccount;
  memberships: {
    tenantId: string;
    tenantName: string;
    role: string;
    membershipStatus: string;
    serviceStatus: string;
  }[];
  records: {
    id: string;
    actorName: string;
    previousStatus: string;
    nextStatus: string;
    reason: string;
    createdAt: string;
  }[];
}
export interface PlatformStaff {
  id: string;
  displayName: string;
  loginName: string;
  status: string;
  administrator: boolean;
  version: number;
}
export interface StaffInvitation {
  id: string;
  loginName: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  deliveryMode: 'LOCAL' | 'DISABLED';
}
export interface StaffInvitePreview {
  loginName: string;
  existingAccount: boolean;
}

/** Allowlisted platform management metadata; excludes customer content/activity. */
export interface ManagementRecord {
  id: number;
  category: 'ENTERPRISE' | 'ACCOUNT' | 'STAFF' | 'SECURITY';
  action: string;
  outcome: 'SUCCESS' | 'DENIED';
  actorId: string | null;
  actorName: string | null;
  targetId: string | null;
  targetName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: string;
  internalReason: string | null;
  publicReason: string | null;
}
