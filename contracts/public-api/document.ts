export interface PrivateDocument {
  id: string;
  tenantId: string;
  workspaceId: string;
  sourceWorkspaceId: string;
  conversationId: string;
  taskId: string;
  artifactId: string | null;
  revision: number;
  title: string;
  updatedAt: string;
}
export interface DocumentVersion {
  number: number;
  title: string;
  body: string;
  createdAt: string;
}
export interface DocumentDetail {
  document: PrivateDocument;
  version: DocumentVersion;
}
export interface DocumentPage {
  tenantId: string;
  items: PrivateDocument[];
  hasMore: boolean;
}
export interface CreateDocument {
  requestId: string;
  conversationId: string;
  taskId: string;
  artifactId?: string;
}
export interface SaveDocument {
  requestId: string;
  expectedRevision: number;
  title: string;
  body: string;
}
export interface PublishDocument {
  requestId: string;
  workspaceId: string;
  folderId?: string | null;
  materialId?: string;
  expectedMaterialVersion?: number;
  format: 'docx' | 'pdf';
  acknowledgeIndependentCopy: true;
}
export interface DocumentPublication {
  id: string;
  tenantId: string;
  documentId: string;
  documentVersion: number;
  workspaceId: string;
  folderId: string | null;
  materialId: string;
  materialVersionId: string;
  materialVersion: number;
  filename: string;
  format: 'docx' | 'pdf';
  sha256: string;
  publishedAt: string;
}
export interface PublicationPage {
  tenantId: string;
  documentId: string;
  items: DocumentPublication[];
  hasMore: boolean;
}
