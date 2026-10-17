export interface TaskFeedbackTarget {
  kind: 'BRIEFING' | 'TASK';
  taskId: string;
  taskRevision: number;
  attempt: number;
  presentationVersion: 'briefing-basic-v1' | 'recommendation-v1' | 'task-v1';
  presentationRevision: number;
  publicationId?: null;
  materialVersionId?: null;
  materialVersion?: null;
}
export interface PublicationFeedbackTarget {
  kind: 'PUBLICATION';
  taskId?: null;
  taskRevision: 0;
  attempt: 0;
  presentationVersion: 'recommendation-v1';
  presentationRevision: number;
  publicationId: string;
  materialVersionId: string;
  materialVersion: number;
}
export type FeedbackTarget = TaskFeedbackTarget | PublicationFeedbackTarget;
export type FeedbackRating = 'USEFUL' | 'NOT_USEFUL' | 'ACHIEVED' | 'PARTIAL' | 'NOT_ACHIEVED';
export type FeedbackReason =
  | 'IRRELEVANT'
  | 'REDUNDANT'
  | 'INACCURATE'
  | 'UNHELPFUL'
  | 'CUSTOM'
  | 'FACT_ERROR'
  | 'EXECUTION'
  | 'GOAL_CHANGED'
  | 'EXPRESSION'
  | 'DATA_GAP'
  | 'OTHER';
export interface FeedbackAssessment {
  rating: FeedbackRating;
  reasons: FeedbackReason[];
  suggestion: string;
}
export interface FeedbackSnapshot {
  taskState: string;
  executionClass: 'live' | 'verification' | 'external' | 'none';
  contentSha256: string;
  sourceVersionCount: number;
}
export interface Feedback {
  id: string;
  tenantId: string;
  workspaceId: string;
  target: FeedbackTarget;
  revision: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  assessment: FeedbackAssessment;
  snapshot: FeedbackSnapshot;
  createdAt: string;
  updatedAt: string;
}
export interface FeedbackVersion {
  revision: number;
  status: Feedback['status'];
  assessment: FeedbackAssessment;
  createdAt: string;
}
export type PreferenceScenario = 'GENERAL' | 'WEEKLY_REPORT' | 'TABLE_SUMMARY';
export type PreferenceStyle = 'CONCLUSION_FIRST' | 'DETAIL_FIRST' | 'TABLE_FIRST' | 'CONCISE';
export interface FeedbackPreference {
  scenario: PreferenceScenario;
  style: PreferenceStyle;
  expectedProfileRevision: number;
}
export interface FeedbackPreferenceState {
  scenario: PreferenceScenario;
  profileId: string | null;
  revision: number;
  status: 'UNSET' | 'ACTIVE' | 'PROPOSED' | 'WITHDRAWN' | 'EXPIRED' | 'UNAVAILABLE';
  style: PreferenceStyle | null;
}
/** New followups only; historical candidate actions remain read-only records. */
export type FeedbackFollowUp =
  | { kind: 'PREFERENCE'; confirmed: true; preference: FeedbackPreference; correction: null; candidate: null }
  | { kind: 'CORRECTION'; confirmed: true; preference: null; correction: string; candidate: null };
export interface FeedbackAction {
  targetWorkspaceId?: string;
  id: string;
  feedbackId: string;
  feedbackRevision: number;
  kind: FeedbackFollowUp['kind'] | 'EXPERIENCE_CANDIDATE';
  status: 'APPLIED' | 'TASK_CREATED' | 'CANDIDATE_CREATED';
  targetId: string;
  targetVersion: string | null;
  targetRevision: number | null;
  conversationId: string | null;
  acceptedState: string;
  executionClass: FeedbackSnapshot['executionClass'];
  createdAt: string;
}
