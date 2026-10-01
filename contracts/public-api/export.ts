export type ExportScope = 'PRIVATE' | 'ENTERPRISE';
export interface ExportSelection {
  objectId: string;
  version: number;
  format: 'docx' | 'pdf';
}
export interface ExportChoice {
  selection: ExportSelection;
  versionId: string | null;
  title: string;
  sizeBytes: number;
  createdAt: string;
}
export interface ExportOptions {
  items: ExportChoice[];
  hasMore: boolean;
  canExport: boolean;
  retentionDays: number[];
  maxItems: number;
  maxBytes: number;
}
export type ExportState =
  'QUEUED' | 'GENERATING' | 'READY' | 'PARTIAL' | 'FAILED' | 'EXPIRED' | 'REVOKED' | 'REMOVED';
export interface ExportItem {
  ordinal: number;
  selection: ExportSelection;
  versionId: string | null;
  title: string | null;
  state: 'PENDING' | 'WRITING' | 'INCLUDED' | 'FAILED';
  archivePath: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  errorCode: string | null;
  visible: boolean;
}
export interface ExportCleanup {
  state: 'NONE' | 'PENDING' | 'FAILED' | 'COMPLETE';
  reason: string | null;
  attempts: number;
  completedAt: string | null;
  removedBytes: number;
  backupState: 'BACKUPS_SEPARATE';
}
export interface ExportSummary {
  id: string;
  tenantId: string;
  workspaceId: string;
  scope: ExportScope;
  revision: number;
  state: ExportState;
  requestedCount: number;
  createdAt: string;
  expiresAt: string | null;
  cleanupState: ExportCleanup['state'];
}
export interface ExportBatch extends Omit<ExportSummary, 'cleanupState'> {
  includedCount: number;
  failedCount: number;
  bytes: number;
  sha256: string | null;
  generatedAt: string | null;
  retentionDays: number;
  errorCode: string | null;
  canDownload: boolean;
  cleanup: ExportCleanup;
  items: ExportItem[];
}
export interface ExportPage {
  items: ExportSummary[];
  hasMore: boolean;
  retentionDays: number[];
  maxItems: number;
  maxBytes: number;
}
export interface CreateExport {
  requestId: string;
  workspaceId: string;
  scope: ExportScope;
  retentionDays: number;
  items: ExportSelection[];
}
