/** Preparation and policy metadata only. No response grants content rights or confirms effective offboarding/exit. */
export type RetentionKind = 'MEMBER_OFFBOARD' | 'TENANT_EXIT';
export type RetentionState = 'DRAFT' | 'ASSESSED' | 'CANCELLED';
export type CheckStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'NOT_APPLICABLE';
export interface RetentionDefinition {
  key: string;
  label: string;
  defaultDays: number | null;
  anchor: string;
  currentEnforcement: string;
  configurable: boolean;
  remainingAdapter: string;
}
export interface RetentionPolicy {
  definition: RetentionDefinition;
  revision: number;
  configuredDays: number | null;
  changedBy: string | null;
  effectiveAt: string | null;
  reason: string | null;
  application: 'FUTURE_RECORDS_ONLY_ADAPTER_REQUIRED' | 'FUTURE_RECORDS_ONLY' | 'PLATFORM_FIXED_POLICY';
}
export interface RetentionCatalogue {
  items: RetentionPolicy[];
  canConfigure: boolean;
  canOffboard: boolean;
  canExit: boolean;
}
export interface RetentionSpace {
  id: string;
  name: string;
}
export interface RetentionOptions {
  members: { id: string; name: string; status: 'ACTIVE' | 'DISABLED' }[];
  hasMore: boolean;
  spaces: RetentionSpace[];
  spacesHaveMore: boolean;
}
export interface RetentionCheck {
  key: string;
  status: CheckStatus;
}
export interface RetentionGroup {
  key: string;
  label: string;
  count: number | null;
  exportSupport:
    | 'SINGLE_ITEM_DOWNLOAD'
    | 'EXISTING_RESULT_BATCH'
    | 'BULK_CAPABILITY_REQUIRED'
    | 'NOT_IMPLEMENTED'
    | 'NOT_INCLUDED'
    | 'EXIT_INVENTORY_AFTER_START';
  scopeNote: string;
}
export interface RetentionQueue {
  id: string;
  state: 'QUEUED' | 'CLEANING' | 'FAILED' | 'COMPLETE';
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP';
}
export interface RetentionScope {
  workspaceId: string;
  name: string;
  groups: RetentionGroup[];
  unfinishedTasks: number | null;
  activePlans: number | null;
  cleanup: RetentionQueue[];
  cleanupHasMore: boolean;
}
export interface RetentionAssessment {
  assessedAt: string;
  scopeCoverage: 'SELECTED_AUTHORIZED_SHARED_SCOPES';
  completeMigration: false;
  executionEnabled: false;
  blockers: string[];
  scopes: RetentionScope[];
  restrictedScopeCount: number;
  exclusions: string[];
  policyRevisions: Record<string, number>;
}
export interface RetentionSummary {
  id: string;
  tenantId: string;
  kind: RetentionKind;
  targetAccountId: string | null;
  label: string;
  state: RetentionState;
  revision: number;
  createdAt: string;
  changedAt: string;
}
export interface RetentionCase {
  summary: RetentionSummary;
  targetName: string | null;
  targetStatus: 'ACTIVE' | 'DISABLED' | null;
  acceptedRevision: number;
  versionState: RetentionState;
  selectedScopes: RetentionSpace[];
  restrictedScopeCount: number;
  checkDefinitions: { key: string; label: string }[];
  checklist: RetentionCheck[];
  assessment: RetentionAssessment | null;
  executionState: 'PREPARATION_ONLY';
}
export interface RetentionVersion {
  revision: number;
  state: RetentionState;
  action: 'CREATED' | 'CHECK' | 'ASSESS' | 'CANCEL';
  changedBy: string;
  createdAt: string;
  hasAssessment: boolean;
}
export interface RetentionPage<T> {
  items: T[];
  hasMore: boolean;
}
export interface CreateRetentionCase {
  requestId: string;
  kind: RetentionKind;
  targetAccountId: string | null;
  label: string;
  workspaceIds: string[];
}
export interface RetentionCommand {
  requestId: string;
  expectedRevision: number;
  action: 'CHECK' | 'ASSESS' | 'CANCEL';
  checklist?: RetentionCheck[];
}
