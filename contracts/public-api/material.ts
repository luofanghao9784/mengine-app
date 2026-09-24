/** M2-C1 platform-owned originals; upload does not imply parsing or AI availability. */
export interface MaterialEntry {
  id: string;
  tenantId: string;
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  kind: 'FOLDER' | 'DOCUMENT';
  name: string;
  version: number;
  sizeBytes: number | null;
  updatedAt: string;
  path: string[];
  canMaintain: boolean;
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
  createdAt: string;
}
export interface MaterialDetail {
  document: MaterialEntry;
  versions: MaterialVersion[];
  hasMore: boolean;
}
export interface MaterialUpload {
  requestId: string;
  folderId?: string | null;
  expectedVersion?: number;
}
