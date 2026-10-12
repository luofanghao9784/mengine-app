export interface GovernanceProposal {
  id: string;
  tenantId: string;
  materialId: string;
  sourceName: string;
  kind: 'TAGS' | 'SUMMARY';
  status: 'PENDING' | 'APPLIED' | 'REJECTED';
  stale: boolean;
  patch: {
    tags: string[] | null;
    summary: string | null;
    executionClass: 'live' | 'verification' | null;
    modelName: string | null;
    evidence: { chunkId: string; quote: string }[];
  } | null;
  reason: string | null;
  actorId: string;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface GovernancePreparation {
  versionId: string;
  version: number;
  generation: number | null;
  tagsRevision: number;
  summaryRevision: number;
  tags: string[];
  summary: string | null;
  summaryExecutionClass: 'live' | 'verification' | null;
  canMaintain: boolean;
}
export interface GovernanceProposalCreate {
  versionId: string;
  expectedRevision: number;
  kind: 'TAGS' | 'SUMMARY';
  tags: string[] | null;
  summary: string | null;
  draftId: string | null;
  reason: string;
}
