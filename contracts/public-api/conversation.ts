import type { KnowledgeChunk } from './knowledge';
export interface Conversation {
  id: string;
  tenantId: string;
  workspaceId: string;
  title: string;
  updatedAt: string;
  managementRevision?: number;
  running?: boolean;
  unread?: boolean;
  briefingDiscussion?: boolean;
  replyRevision?: number;
  latestReplyTaskId?: string | null;
  trashedAt?: string | null;
}
export interface ConversationManagementReceipt {
  id: string;
  revision: number;
  trashedAt: string | null;
}
export interface TaskArtifact {
  id: string;
  filename: string;
  sha256: string;
  bytes: number;
}
export interface WebSource {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  sha256: string;
  retrievedAt: string;
  publishedAt?: string | null;
  kind: 'SEARCH' | 'PAGE';
  truncated: boolean;
}
export interface TaskSkill {
  id: string;
  version: string;
  sha256: string;
}
export interface OriginalSelection {
  materialId: string;
  versionId: string;
}
export interface TaskOriginal extends OriginalSelection {
  workspaceId?: string;
  attachmentConversationId?: string | null;
  filename: string;
  version: number;
  bytes: number;
  sha256: string;
  read: boolean;
}
export interface ConversationTask {
  originals: TaskOriginal[];
  publicQuery: string | null;
  webSources: WebSource[];
  skills: TaskSkill[];
  reply: string | null;
  executionClass: 'live' | 'verification' | null;
  modelName: string | null;
  artifacts: TaskArtifact[];
  id: string;
  prompt: string;
  mode: 'SOURCE_LOOKUP' | 'AGENT';
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'
    | 'INTERRUPTED'
    | 'PAUSED'
    | 'WAITING_INPUT'
    | 'WAITING_CAPABILITY'
    | 'PARTIAL'
    | 'RESULT_UNKNOWN';
  waitReason?: string | null;
  requiredInput?: string | null;
  supplementalInput?: string | null;
  reconciliationRequired?: boolean;
  revision: number;
  attempt: number;
  summaryCode: 'SOURCES_FOUND' | 'NO_SOURCES' | null;
  errorCode: string | null;
  engineVersion: string | null;
  sourcesUnavailable: boolean;
  sources: KnowledgeChunk[];
  createdAt: string;
}
export interface ConversationPage {
  publicWebEnabled: boolean;
  agentMode: 'off' | 'verification' | 'live';
  tenantId: string;
  enabled: boolean;
  items: Conversation[];
  hasMore: boolean;
}
export interface BriefingReference {
  conversationId: string;
  taskId: string;
  workspaceId: string;
  taskRevision: number;
  attempt: number;
}
export interface BriefingDiscussion {
  conversationId: string | null;
  title: string;
  briefingContext: BriefingReference;
}
export interface ConversationDetail {
  briefingContext?: BriefingReference | null;
  conversation: Conversation;
  tasks: ConversationTask[];
  hasMore: boolean;
  cursor: number;
}
export interface ConversationEvents {
  conversationId: string;
  items: { seq: number; taskId: string; kind: string; revision: number }[];
  cursor: number;
  hasMore: boolean;
}
export interface SendTask {
  briefingContext?: BriefingReference;
  sourceScope?: 'AUTHORIZED_LIBRARY' | 'SELECTED';
  originals?: OriginalSelection[];
  publicQuery?: string;
  requestId: string;
  workspaceId: string;
  prompt: string;
  mode: 'SOURCE_LOOKUP' | 'AGENT';
}

export type TaskAction = 'CANCEL' | 'RETRY' | 'PAUSE' | 'RESUME' | 'RECONCILE' | 'SUPPLEMENT';
export interface TaskAttempt {
  number: number;
  status: ConversationTask['status'];
  input: string;
  reply: string | null;
  summaryCode: string | null;
  errorCode: string | null;
  engineVersion: string | null;
  modelName: string | null;
  tools: { callId: string; name: string; status: 'STARTED' | 'succeeded' | 'failed' }[];
  sources: KnowledgeChunk[];
  artifacts: TaskArtifact[];
  startedAt: string | null;
  finishedAt: string | null;
  provenance: 'RECORDED' | 'LEGACY_CURRENT_ONLY';
  reconciliationCode: string | null;
}
export interface TaskAttempts {
  taskId: string;
  items: TaskAttempt[];
  hasMore: boolean;
}

/** Version 1 full snapshots are replay-safe; provisional text is not a completed result. */
export interface LiveTask {
  taskId: string;
  attempt: number;
  status: ConversationTask['status'];
  enabled: boolean;
  stopping: boolean;
  outputs: { step: number; version: number; text: string; state: 'STREAMING' | 'COMPLETE' | 'INTERRUPTED' }[];
  inputs: { id: string; text: string; applied: boolean; attempt?: number; resumeAnswer?: boolean }[];
  tools: { sequence: number; name: string; status: 'STARTED' | 'succeeded' | 'failed' }[];
  questions: { id: string; text: string; options: string[]; blocking: boolean; answered: boolean }[];
}
export interface LiveSnapshot {
  conversationId: string;
  items: LiveTask[];
}
