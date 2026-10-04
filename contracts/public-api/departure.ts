/** Effective execution is distinct from V29 preparation and from temporary export archives. */
export type DepartureKind = 'MEMBER_OFFBOARD' | 'TENANT_EXIT';
export type DepartureState =
  'ISOLATING' | 'ISOLATED' | 'EXPORT_WINDOW' | 'RESTORING' | 'CLEANING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export interface DepartureSummary {
  id: string;
  tenantId: string;
  kind: DepartureKind;
  targetAccountId: string | null;
  state: DepartureState;
  revision: number;
  effectiveAt: string;
  deadline: string;
  completedAt: string | null;
  errorCode: string | null;
}
export interface ExportGrant {
  accountId: string;
  workspaceId: string;
}
export interface DepartureView {
  execution: DepartureSummary;
  targetName: string | null;
  reason: string;
  policyKey: 'OFFBOARD_ISOLATION' | 'TENANT_EXIT_WINDOW';
  policyRevision: number;
  stopComplete: boolean;
  isolationComplete: boolean;
  materialsComplete: boolean;
  objectsComplete: boolean;
  cancelledAt: string | null;
  workerAttempts: number;
  backupState: 'PENDING_VERIFICATION';
  canCancel: boolean;
  canRetry: boolean;
  exportGrants: (ExportGrant & { workspaceName: string | null })[];
  materialProgress: {
    discovered: number;
    isolated: number;
    queued: number;
    purged: number;
    failed: number;
    remaining: number;
    discoveryComplete: boolean;
    complete: boolean;
  } | null;
  coverage: string[];
}
export interface DepartureMember {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  revision: number;
}
export interface SharedResponsibility {
  kind: 'WORKSPACE_OWNER' | 'SOURCE_CONTACT';
  workspaceId: string;
  workspaceName: string;
  objectId: string;
  name: string;
  responsibleId: string;
  revision: number;
}
export interface DepartureOptions {
  tenantRevision: number;
  members: DepartureMember[];
  membersHaveMore: boolean;
  responsibilities: SharedResponsibility[];
  responsibilitiesHaveMore: boolean;
  canOffboard: boolean;
  canExit: boolean;
  selectedMember?: DepartureMember | null;
  selectedOwner?: boolean;
  currentExecutionId?: string | null;
  isolationDays?: number;
}
export interface DeparturePage<T> {
  items: T[];
  hasMore: boolean;
}
export interface HandoverReceipt {
  id: string;
  kind: SharedResponsibility['kind'];
  workspaceId: string;
  objectId: string;
  fromAccountId: string;
  toAccountId: string;
  resultingRevision: number;
  createdAt: string;
}
export interface OffboardInput {
  requestId: string;
  targetAccountId: string;
  expectedMemberRevision: number;
  reason: string;
  acceptScheduledCleanup: boolean;
}
export interface ExitInput {
  requestId: string;
  expectedTenantRevision: number;
  reason: string;
  exportGrants: ExportGrant[];
  acceptScheduledCleanup: boolean;
}
export interface DepartureCommand {
  requestId: string;
  expectedRevision: number;
  action: 'CANCEL_OFFBOARD' | 'RETRY';
}
export interface ExitInventory {
  id: string;
  executionId: string;
  workspaceId: string;
  includeHistory: boolean;
  state: 'READY' | 'EXPIRED' | 'REVOKED';
  revision: number;
  itemCount: number;
  pending: number;
  included: number;
  failed: number;
  selectedScopeComplete: boolean;
  fullTenantMigration: false;
  createdAt: string;
  coverage: string[];
}
export interface ExitItem {
  ordinal: number;
  kind: 'MATERIAL_VERSION' | 'EXPERIENCE_VERSION' | 'DATASET_SNAPSHOT';
  objectId: string;
  versionId: string;
  version: number;
  state: 'PENDING' | 'INCLUDED' | 'FAILED';
  filename: string | null;
  sha256: string | null;
  errorCode: string | null;
}
export interface ExitPart {
  id: string;
  setId: string;
  number: number;
  state: 'QUEUED' | 'GENERATING' | 'READY' | 'PARTIAL' | 'FAILED' | 'EXPIRED' | 'REVOKED' | 'REMOVED';
  revision: number;
  requestedCount: number;
  bytes: number;
  sha256: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  errorCode: string | null;
  cleanupState: 'NONE' | 'PENDING' | 'FAILED' | 'COMPLETE';
  cleanedAt: string | null;
  removedBytes: number;
  canDownload: boolean;
  items: ExitItem[];
}
export interface ExitCleanupReceipt {
  partId: string;
  state: ExitPart['state'];
  cleanupState: ExitPart['cleanupState'];
  attempts: number;
  completedAt: string | null;
  removedBytes: number;
  backupState: 'PENDING_VERIFICATION';
}
export interface DepartureBusinessStatus {
  tenantId: string;
  businessEnabled: boolean;
  exitState: DepartureState | null;
  exportDeadline: string | null;
  canExport: boolean;
}
