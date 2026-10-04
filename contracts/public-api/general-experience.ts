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
