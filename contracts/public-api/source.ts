/** Manual acquisition metadata and declared coverage; independent of parsing and model quality. */
export interface SourceSettings {
  name: string; description: string; responsibleId: string; cadenceHours: number | null;
  expectedFrom: string | null; expectedThrough: string | null; status: 'ACTIVE' | 'PAUSED';
}
export interface BusinessSource extends SourceSettings {
  id: string; tenantId: string; workspaceId: string; revision: number;
  coverageState: 'UNKNOWN' | 'MISSING' | 'GAP' | 'DECLARED';
  lastSubmittedAt: string | null; dueAt: string | null; overdue: boolean;
  canMaintain: boolean; updatedAt: string;
}
export interface SourceSubmission {
  id: string; sourceId: string; coverageFrom: string; coverageThrough: string; note: string;
  status: 'ACTIVE' | 'WITHDRAWN'; revision: number; submittedBy: string; submittedAt: string;
  unavailableVersions: number;
  versions: { materialId: string; versionId: string; number: number; filename: string; sha256: string }[];
}
export interface SourceConfigVersion {
  revision: number; settings: SourceSettings; changedBy: string; effectiveAt: string;
}
