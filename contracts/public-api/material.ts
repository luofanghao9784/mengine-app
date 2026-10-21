/** M2-C1 platform-owned originals; upload does not imply parsing or AI availability. */
export interface MaterialEntry {
  id: string;
  tenantId: string;
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  kind: 'FOLDER' | 'DOCUMENT' | 'DRAFT';
  name: string;
  version: number;
  sizeBytes: number | null;
  updatedAt: string;
  path: string[];
  canMaintain: boolean;
  /** Original uploader; later version contributors are recorded on MaterialVersion. */
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  canDownload?: boolean;
  canManageFiles?: boolean;
  canManagePermissions?: boolean;
}
export interface MaterialPage {
  tenantId: string;
  workspaceId: string | null;
  folderId: string | null;
  trail: { id: string; name: string }[];
  canMaintain: boolean;
  maxUploadBytes: number;
  items: MaterialEntry[];
  hasMore: boolean;
}
export interface MaterialVersion {
  origin?: 'UPLOAD' | 'DOCUMENT_PUBLICATION';
  id: string;
  number: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}
export interface MaterialDetail {
  inLibrary?: boolean;
  document: MaterialEntry;
  versions: MaterialVersion[];
  hasMore: boolean;
}
export interface MaterialUpload {
  requestId: string;
  folderId?: string | null;
  expectedVersion?: number;
}

/** Exact receipt for the upload request; a later material version is reported separately. */
export interface MaterialUploadReceipt extends MaterialEntry {
  receiptStatus: 'EXACT' | 'HISTORICAL_UNKNOWN';
  acceptedVersion: MaterialVersion | null;
  currentVersion: number;
}
