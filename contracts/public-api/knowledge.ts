/** Platform-owned citations; never expose provider document IDs or object-store keys. */
export interface KnowledgeChunk {
  id: string;
  tenantId: string;
  workspaceId: string;
  materialId: string;
  versionId: string;
  runId: string;
  version: number;
  filename: string;
  locator: string;
  method: 'TEXT' | 'TABLE' | 'OCR';
  content: string;
}
export interface KnowledgeAnalysis {
  tenantId: string;
  workspaceId: string;
  materialId: string;
  versionId: string;
  generation: number;
  status: 'NOT_STARTED' | 'QUEUED' | 'RUNNING' | 'READY' | 'PARTIAL' | 'FAILED' | 'UNSUPPORTED' | 'CANCELLED';
  parserVersion: string | null;
  warnings: string[];
  canMaintain: boolean;
  available: boolean;
  chunks: KnowledgeChunk[];
  hasMore: boolean;
}
export interface KnowledgeResults {
  tenantId: string;
  workspaceId: string | null;
  query: string;
  items: KnowledgeChunk[];
  hasMore: boolean;
}
