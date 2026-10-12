export interface WikiGraphNode {
  id: string;
  revision: number;
  title: string;
  content: string;
}
export interface WikiGraphRelation {
  from: string;
  to: string;
  kind: 'topic' | 'complement' | 'dependency' | 'sequence';
  reason: string;
  evidence: { articleId: string; quote: string }[];
}
export interface WikiGraph {
  id: string;
  tenantId: string;
  taskId: string;
  conversationId: string;
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
  executionClass: 'live' | 'verification' | null;
  modelName: string | null;
  documents: WikiGraphNode[];
  graph: { selected: string[]; relations: WikiGraphRelation[] } | null;
}
export interface WikiGraphPage {
  items: WikiGraph[];
  hasMore: boolean;
}
