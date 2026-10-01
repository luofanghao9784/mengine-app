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
export interface KnowledgeVersionCoverage {
  materialId: string;
  versionId: string;
  version: number;
  runId: string | null;
  generation: number;
  status: KnowledgeAnalysis['status'];
  /** At most four warnings of at most 64 characters; full analysis is a separate authorized read. */
  warnings: string[];
  pinned: boolean;
}
export interface KnowledgeCoverage {
  scope: 'AUTHORIZED_WORKSPACE' | 'AUTHORIZED_SHARED' | 'SELECTED_VERSIONS';
  status: 'EMPTY' | 'READY' | 'PARTIAL' | 'NOT_READY';
  totalVersions: number;
  searchableVersions: number;
  partialVersions: number;
  notReadyVersions: number;
  relevance: 'NOT_ASSESSED';
  versions: KnowledgeVersionCoverage[];
  hasMore: boolean;
}
export interface KnowledgeResults {
  tenantId: string;
  workspaceId: string | null;
  query: string;
  items: KnowledgeChunk[];
  hasMore: boolean;
  /** Optional only while consuming an older server; current servers always return both fields. */
  matchStatus?: 'MATCHED' | 'NO_MATCH';
  coverage?: KnowledgeCoverage;
}
