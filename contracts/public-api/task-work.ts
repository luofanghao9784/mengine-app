/** Metadata and independently saved finite expression preferences. No task token or quoted source text. */
export interface TaskPlanCheckReceipt {
  id: string;
  taskId: string;
  planId: string;
  requestId: string;
  acceptedRevision: number;
  executionEpoch: number;
  checkAt: string;
  reason: string;
  state: 'PENDING' | 'DISPATCHED' | 'CANCELLED';
  currentlyEffective: boolean;
  dispatchedTaskId: string | null;
  dispatchUnavailable: boolean;
}
export interface TaskPreferenceReceipt {
  id: string;
  taskId: string;
  requestId: string;
  category: 'RESPONSE_LENGTH' | 'RESPONSE_FORMAT' | 'TONE' | 'BRIEFING_ORDER';
  choice: 'CONCISE' | 'DETAILED' | 'PARAGRAPHS' | 'BULLETS' | 'DIRECT' | 'FRIENDLY' | 'CONCLUSION_FIRST' | 'EVIDENCE_FIRST';
  label: string;
  profileId: string;
  acceptedRevision: number;
  currentRevision: number;
  currentStatus: 'ACTIVE' | 'PROPOSED' | 'WITHDRAWN' | 'EXPIRED' | 'UNAVAILABLE';
  currentlyEffective: boolean;
  canUndo: boolean;
  evidenceSource: 'PROMPT' | 'SUPPLEMENT';
  createdAt: string;
}
export interface TaskWorkReceipts {
  checks: TaskPlanCheckReceipt[];
  preferences: TaskPreferenceReceipt[];
  hasMore: boolean;
}
