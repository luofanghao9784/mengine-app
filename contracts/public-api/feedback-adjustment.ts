import type { Feedback, FeedbackTarget } from './feedback';
export interface AdjustmentReading {
  workspaceId: string;
  cardId: string;
  cardKind: 'BRIEFING' | 'PUBLICATION';
  target: FeedbackTarget;
  title: string;
  excerpt: string;
  truncated: boolean;
  presentation: string;
  sourceVersions: string[];
  contentSha256: string;
}
export interface AdjustmentMessage {
  id: string;
  ordinal: number;
  taskId: string;
  taskRevision: number;
  status: string;
  waitReason: string | null;
  request: string;
  reading: AdjustmentReading;
  historyTaskIds: string[];
  reply: string | null;
  requiredInput: string | null;
  supplementalInput: string;
  createdAt: string;
}
export interface AdjustmentView {
  reading: AdjustmentReading;
  threadId: string | null;
  conversationId: string | null;
  threadRevision: number;
  feedbackRevision: number;
  items: AdjustmentMessage[];
  hasMore: boolean;
  nextOffset: number;
}
export interface SendAdjustment {
  rating: 'USEFUL' | 'NOT_USEFUL';
  requestId: string;
  target: FeedbackTarget;
  expectedThreadRevision: number;
  expectedFeedbackRevision: number;
  message: string;
}
export interface AdjustmentSent {
  threadId: string;
  conversationId: string;
  threadRevision: number;
  message: AdjustmentMessage;
  feedback: Feedback;
}
