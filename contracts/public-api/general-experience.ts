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
