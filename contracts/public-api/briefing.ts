import type { BriefingDocument } from './briefing-content';
export type BriefingView = 'LATEST' | 'FOCUSED' | 'HIDDEN';
export interface BriefingPreference {
  revision: number;
  pinned: boolean;
  hidden: boolean;
  size: 'STANDARD' | 'WIDE';
}
export interface BriefingCard {
  cardId?: string;
  briefing?: BriefingDocument | null;
  conversationId: string;
  taskId: string;
  taskRevision: number;
  attempt: number;
  presentationVersion: 'briefing-basic-v1';
  workspaceId: string;
  workspaceName: string;
  title: string;
  excerpt: string;
  truncated: boolean;
  completedAt: string;
  executionClass: 'verification' | 'live';
  engineVersion: string;
  artifactCount: number;
  citationCount: number;
  originalCount: number;
  preference: BriefingPreference;
}
export interface BriefingPage {
  asOf?: string;
  tenantId: string;
  view: BriefingView;
  date: string | null;
  zone: string;
  items: BriefingCard[];
  hasMore: boolean;
}
export interface BriefingFilter {
  asOf?: string;
  businessType?: string;
  view: BriefingView;
  date: string | null;
  zone: string;
  workspaceId?: string;
}
export interface BriefingUpdate {
  requestId: string;
  expectedRevision: number;
  pinned: boolean;
  hidden: boolean;
  size: BriefingPreference['size'];
}
export interface BriefingLayout {
  tenantId: string;
  revision: number;
}
export interface BriefingLayoutMove {
  requestId: string;
  expectedRevision: number;
  conversationId: string;
  anchorId: string;
  direction: 'BEFORE' | 'AFTER';
}
export interface BriefingLayoutReceipt {
  id: string;
  conversationId: string;
  anchorId: string;
  direction: 'BEFORE' | 'AFTER';
  appliedRevision: number;
  currentRevision: number;
}

/** Date summaries cover all readable cards for the local completion day. */
export interface BriefingDay {
  date: string;
  total: number;
  items: BriefingCard[];
}
export interface BriefingTimelinePage {
  tenantId: string;
  zone: string;
  asOf: string;
  items: BriefingDay[];
  hasMore: boolean;
}
