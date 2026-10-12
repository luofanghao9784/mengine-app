/** Private task-derived drafts; reading a source does not publish shared knowledge. */
export interface WikiDraft {
  id: string;
  tenantId: string;
  materialId: string;
  versionId: string;
  conversationId: string;
  taskId: string;
  sourceName: string;
  sourceVersion: number;
  status:
    | 'QUEUED'
    | 'RUNNING'
    | 'WAITING_CAPABILITY'
    | 'WAITING_INPUT'
    | 'PAUSED'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'
    | 'PARTIAL'
    | 'SOURCE_CHANGED'
    | 'RESULT_UNKNOWN'
    | 'INTERRUPTED';
  executionClass: string | null;
  modelName: string | null;
  article: {
    title: string;
    intro: string;
    content: string;
    evidence: { chunkId: string; quote: string }[];
  } | null;
}
export interface WikiDraftPage {
  items: WikiDraft[];
  hasMore: boolean;
}
