import type {BriefingDocument} from './briefing-content';
import type { FeedbackTarget } from './feedback';
export interface RecommendationSettings {
  revision: number;
  enabled: boolean;
}
export interface DeliveryTarget {
  kind: 'TASK' | 'PUBLICATION';
  id: string;
  versionKey: string;
}
export interface RecommendationContent extends DeliveryTarget {
  workspaceId: string;
  workspaceName: string;
  title: string;
  excerpt: string;
  truncated: boolean;
  createdAt: string;
  executionClass: 'verification' | 'live' | 'PUBLISHED_COPY';
  conversationId: string | null;
  taskRevision: number;
  attempt: number;
  preferenceRevision: number;
  materialId: string | null;
  materialVersion: number;
  filename: string;
  pinned: boolean;
  openedAt: string | null;
}
export interface MethodReference {
  versionId: string | null;
  adoptionRevision: number;
  scope: 'BUILTIN' | 'TENANT' | 'WORKSPACE';
  workspaceId: string | null;
  configurationSha: string;
}
export interface RecommendationItem {
  briefing?: BriefingDocument | null;
  content: RecommendationContent;
  score: number;
  method: MethodReference;
  presentation: {
    renderer: 'source-preserving-v1';
    style: 'DEFAULT' | 'CONCISE' | 'TABLE_FIRST' | 'CONCLUSION_FIRST' | 'DETAIL_FIRST';
    profileId: string | null;
    profileRevision: number;
  };
  reason: string;
  availability: 'AVAILABLE_IN_APP';
  feedbackTarget: FeedbackTarget;
}
export interface RecommendationPage {
  tenantId: string;
  settings: RecommendationSettings;
  items: RecommendationItem[];
  snapshot: string;
  hasMore: boolean;
  eligibleTotal: number;
  rankedCount: number;
  poolLimited: boolean;
  poolLimit: 1000;
  businessOutcome: 'NOT_ASSESSED';
}
export interface OpenedDelivery {
  target: DeliveryTarget;
  openedAt: string;
  evidence: 'USER_OPEN_ACTION';
  businessOutcome: 'NOT_ASSESSED';
}
