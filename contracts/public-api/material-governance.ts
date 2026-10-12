export type GovernanceItem = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  version: number;
  revision: number;
  canEdit: boolean;
  canRedact: boolean;
  source: string;
  quality: number | null;
  issues: string[];
  tags: string[];
  reviewAt: string | null;
  checkedAt: string | null;
};
export type GovernancePage = {
  tenantId: string;
  summary: { total: number; checked: number; attention: number; sensitive: number; average: number | null };
  filteredTotal: number;
  items: GovernanceItem[];
  hasMore: boolean;
};
export type GovernanceChange = {
  requestId: string;
  expectedVersion: number;
  expectedRevision: number;
  tags: string[];
  reviewAt: string | null;
};
export type GovernanceResult = {
  reportId: string;
  version: number;
  revision: number;
  source: string;
  issues: string[];
  tags: string[];
  reviewAt: string | null;
  redacted: boolean;
};
