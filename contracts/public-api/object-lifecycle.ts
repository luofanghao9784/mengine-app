/** Online object lifecycle. Metadata never creates an original-content reading grant. */
export type ObjectKind =
  | 'TASK'
  | 'DOCUMENT'
  | 'ARTIFACT'
  | 'EXPERIENCE_VERSION'
  | 'FEEDBACK_VERSION'
  | 'EVALUATION_VERSION'
  | 'EVALUATION_RUN'
  | 'EXPORT_CACHE'
  | 'PROFILE_VERSION'
  | 'METHOD_VERSION';
export type ObjectState =
  'ACTIVE' | 'DISABLED' | 'TRASHED' | 'ISOLATED' | 'PURGE_PENDING' | 'PURGE_FAILED' | 'PURGED';
export type ObjectAction = 'DISABLE' | 'ENABLE' | 'TRASH' | 'RESTORE' | 'PURGE' | 'RETRY' | 'CLASSIFY_TRIAL';
export interface LifecycleItem {
  kind: ObjectKind;
  objectId: string;
  workspaceId: string | null;
  state: ObjectState;
  revision: number;
  originalAnchor: string;
  formal: boolean;
  policyKey: string | null;
  policyRevision: number | null;
  policyDue: string | null;
  purgeAfter: string | null;
  attempts: number;
  errorCode: string | null;
  completedAt: string | null;
  actions: ObjectAction[];
  contentState: 'ONLINE_BODY_ERASED' | 'CURRENT_ORIGINAL_ACCESS_REQUIRED' | 'NORMAL_ACCESS_BLOCKED';
  backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP';
}
export interface LifecyclePreview {
  object: LifecycleItem;
  trashDeadline: string;
  trialDeadline: string | null;
  methodDependency: boolean;
  blockers: string[];
  irreversible: boolean;
  independentCopies: 'INDEPENDENT_ENTERPRISE_PUBLICATIONS_SURVIVE';
}
export interface LifecycleReceipt {
  acceptedRevision: number;
  current: LifecycleItem;
  receiptStatus: 'EXACT';
}
export interface LifecycleEvent {
  revision: number;
  action: string;
  actorId: string | null;
  createdAt: string;
}
export interface LifecycleTechnical {
  kind: ObjectKind;
  state: ObjectState;
  count: number;
}
