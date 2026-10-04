export interface GeneralMethod {
  title: string;
  summary: string;
  steps: string[];
  applicable: string[];
  excluded: string[];
  tags: string[];
  basis: 'OBSERVED_EXECUTION' | 'FEEDBACK_CORRECTION';
}
export interface GeneralExperienceSummary {
  id: string;
  versionId: string;
  number: number;
  status: 'AVAILABLE' | 'STOPPED';
  title: string;
  summary: string;
  tags: string[];
  updatedAt: string;
}
export interface GeneralExperiencePage {
  items: GeneralExperienceSummary[];
  hasMore: boolean;
}
export interface GeneralExperienceDetail {
  id: string;
  versionId: string;
  number: number;
  status: 'AVAILABLE' | 'STOPPED';
  method: GeneralMethod;
  updatedAt: string;
}
export type GeneralProcessingState =
  | 'WAITING'
  | 'PROCESSING'
  | 'RETRYING'
  | 'ADMITTED'
  | 'DUPLICATE'
  | 'NOT_ADMITTED'
  | 'UNAVAILABLE'
  | 'FAILED'
  | 'UNKNOWN';
export interface GeneralExperienceProcessing {
  enabled: boolean;
  counts: Record<GeneralProcessingState, number>;
  available: number;
  stopped: number;
  withdrawn: number;
  checkedAt: string;
}

export interface GeneralExperienceUsage {
  entryId: string;
  versionId: string;
  enabled: boolean;
  revision: number;
  canManage: boolean;
}
export interface GeneralExperienceUsageChange {
  requestId: string;
  versionId: string;
  expectedRevision: number;
  enabled: boolean;
}
export interface GeneralExperienceUsageReceipt {
  requestId: string;
  entryId: string;
  versionId: string;
  enabled: boolean;
  revision: number;
}

export interface GeneralExperienceAvailability {
  entryId: string;
  versionId: string;
  status: 'AVAILABLE' | 'STOPPED';
  revision: number;
  reason: string | null;
  changedAt: string;
}
export interface GeneralExperienceAvailabilityChange {
  requestId: string;
  versionId: string;
  expectedRevision: number;
  status: 'AVAILABLE' | 'STOPPED';
  reason: string;
}
export interface GeneralExperienceAvailabilityReceipt {
  requestId: string;
  entryId: string;
  versionId: string;
  status: 'AVAILABLE' | 'STOPPED';
  revision: number;
}

export interface GeneralExperienceSuggestionChange {
  requestId: string;
  versionId: string;
  workspaceId: string;
  intent: 'FEEDBACK' | 'ADAPTATION';
  content: string;
}
export interface GeneralExperienceSuggestion {
  id: string;
  versionId: string;
  workspaceId: string;
  intent: 'FEEDBACK' | 'ADAPTATION';
  state: GeneralProcessingState;
  resultEntryId: string | null;
  resultVersionId: string | null;
  createdAt: string;
}
export interface GeneralExperienceSuggestions {
  enabled: boolean;
  canSubmit: boolean;
  scopes: { id: string; name: string }[];
  items: GeneralExperienceSuggestion[];
}

export type GeneralAdjustmentState =
  | 'QUEUED'
  | 'RETRY_WAIT'
  | 'RUNNING'
  | 'UNCERTAIN'
  | 'PUBLISHING'
  | 'ADMITTED'
  | 'SKIPPED'
  | 'REJECTED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'UNAVAILABLE'
  | 'CONFLICT';
export interface GeneralExperienceAdjustmentChange {
  requestId: string;
  versionId: string;
  expectedRevision: number;
  content: string;
}
export interface GeneralExperienceAdjustment {
  id: string;
  versionId: string;
  state: GeneralAdjustmentState;
  resultVersionId: string | null;
  createdAt: string;
}
export interface GeneralExperienceAdjustments {
  enabled: boolean;
  canSubmit: boolean;
  revision: number;
  currentVersionId: string;
  items: GeneralExperienceAdjustment[];
}

export interface GeneralExperienceVersions {
  entryId: string;
  currentVersionId: string;
  items: { versionId: string; number: number; createdAt: string }[];
  hasMore: boolean;
}
export interface GeneralExperienceHistorical {
  entryId: string;
  currentVersionId: string;
  versionId: string;
  number: number;
  method: GeneralMethod;
  createdAt: string;
}

export interface GeneralExperienceActivity {
  entryId: string;
  currentVersionId: string;
  versionId: string;
  scope: 'PLATFORM_AGGREGATE' | 'AUTHORIZED_SHARED_SPACES';
  referencedAttempts: number;
  fullyReadAttempts: number;
  assessedAttempts: number;
  adoptedAttempts: number;
  applicationOutcome: 'UNKNOWN';
  checkedAt: string;
}
