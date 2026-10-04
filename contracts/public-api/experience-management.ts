import type { ExperienceSummary } from './experience';
export type ExperienceProcessingState =
  | 'WAITING'
  | 'PROCESSING'
  | 'RETRYING'
  | 'ADMITTED'
  | 'UPDATED'
  | 'DUPLICATE'
  | 'NOT_ADMITTED'
  | 'UNAVAILABLE'
  | 'FAILED'
  | 'UNKNOWN';
export interface ExperienceScope {
  id: string;
  name: string;
}
export interface ManagedExperience {
  experience: ExperienceSummary;
  workspaceId: string;
  workspaceName: string;
  updatedAt: string;
}
export interface ExperienceContentPage {
  scopes: ExperienceScope[];
  items: ManagedExperience[];
  hasMore: boolean;
}
export interface ExperienceProcessingRecord {
  id: string;
  sourceKind: 'TASK' | 'FEEDBACK' | 'ADJUSTMENT';
  state: ExperienceProcessingState;
  reason: string | null;
  updatedAt: string;
  entryId: string | null;
  versionId: string | null;
  workspaceId: string;
}
export interface ExperienceProcessingPage {
  enabled: boolean;
  scopes: ExperienceScope[];
  counts: Record<ExperienceProcessingState, number>;
  items: ExperienceProcessingRecord[];
  hasMore: boolean;
}

export interface ExperienceHistory {
  items: {
    id: string;
    number: number;
    origin: 'MANUAL' | 'AUTOMATIC';
    evaluation: 'NOT_EVALUATED' | 'AUTOMATIC_CHECKED';
    createdAt: string;
    current: boolean;
  }[];
  hasMore: boolean;
}
