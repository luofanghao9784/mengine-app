/** Current authorized shared materials, not tenant management inventory. */
export type WorkbenchState = 'ALL' | 'READY' | 'PROCESSING' | 'ATTENTION' | 'NOT_STARTED';
export type WorkbenchItem = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  version: number;
  status: string;
  updatedAt: string;
};
export type KnowledgeWorkbench = {
  tenantId: string;
  checkedAt: string;
  summary: { total: number; ready: number; processing: number; attention: number; notStarted: number };
  spaces: { id: string | null; name: string; count: number }[];
  filteredTotal: number;
  items: WorkbenchItem[];
  hasMore: boolean;
};
