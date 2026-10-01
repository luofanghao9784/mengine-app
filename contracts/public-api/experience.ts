export type ExperienceKind = 'METHOD' | 'CASE' | 'CORRECTION' | 'ASSET';
export type ExperienceAccess = 'SOURCE_BOUND' | 'INDEPENDENT_COPY';
export interface ExperienceContent {
  kind: ExperienceKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  applicable: string;
  excluded: string;
  dependencies: string;
  basis: string;
  accessMode: ExperienceAccess;
}
export interface ExperienceEvidence {
  kind: 'MATERIAL_VERSION' | 'TASK';
  referenceId: string;
  workspaceId: string;
}
export interface ExperienceVersion {
  id: string;
  number: number;
  schemaVersion: 1;
  content: ExperienceContent;
  evidence: ExperienceEvidence[];
  origin: 'MANUAL';
  evaluation: 'NOT_EVALUATED';
  createdBy: string;
  createdAt: string;
}
export interface ExperienceEntry {
  id: string;
  tenantId: string;
  workspaceId: string;
  revision: number;
  status: 'CANDIDATE' | 'PUBLISHED' | 'WITHDRAWN';
  latestNumber: number;
  publishedVersion: string | null;
  canMaintain: boolean;
  version: ExperienceVersion;
}
export interface ExperienceSummary {
  id: string;
  versionId: string;
  number: number;
  revision: number;
  status: ExperienceEntry['status'];
  title: string;
  summary: string;
  tags: string[];
  applicable: string;
  excluded: string;
  origin: 'MANUAL';
  evaluation: 'NOT_EVALUATED';
}
export interface ExperiencePage {
  items: ExperienceSummary[];
  hasMore: boolean;
  canMaintain: boolean;
  indexStatus: 'READY';
}
export type Applicability = 'DIRECT' | 'ADAPTED' | 'UNKNOWN' | 'NOT_APPLICABLE';
export interface ExperienceUseInput {
  versionId: string;
  taskId: string | null;
  contextKey: string;
  decision: Applicability;
  adopted: boolean;
  conditions: string;
  adjustments: string;
}
export interface ExperienceUse extends ExperienceUseInput {
  id: string;
  entryId: string;
  createdAt: string;
}
export interface ExperienceFeedback {
  id: string;
  useId: string;
  result: 'UNKNOWN' | 'COMPLETED' | 'FAILED' | 'CORRECTED';
  note: string;
  createdAt: string;
}
export interface ExperienceEvent {
  id: string;
  revision: number;
  versionId: string | null;
  action: 'CREATED' | 'REVISED' | 'PUBLISHED' | 'WITHDRAWN';
  actorId: string;
  createdAt: string;
}
