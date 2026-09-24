/** Shared activity 1.0.0. A version is one event; no private conversation or source-document identifiers. */
export type ActivityKind =
  'MATERIAL_UPLOADED' | 'MATERIAL_UPDATED' | 'DOCUMENT_PUBLISHED' | 'DOCUMENT_UPDATED';
export interface ActivityItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  materialId: string;
  version: number;
  filename: string;
  actorName: string;
  kind: ActivityKind;
  occurredAt: string;
}
export interface ActivityPage {
  tenantId: string;
  workspaceId: string | null;
  items: ActivityItem[];
  nextCursor: string | null;
}
