/** Derived from current business objects. Reading/folding never completes the source object. */
export interface AttentionItem {
  kind: 'TASK' | 'SOURCE' | 'PLAN'; id: string; workspaceId: string; workspaceName: string;
  title: string; state: 'WAITING_INPUT' | 'PARTIAL' | 'RESULT_UNKNOWN' | 'OVERDUE' | 'MISSING_DATA' | 'AUTHORIZATION_REQUIRED' | 'PLAN_NEEDS_ATTENTION';
  instruction: string; actionLabel: string; conversationId: string | null; revision: number;
  dueAt: string | null; changedAt: string;
}
export interface AttentionPage {
  tenantId: string; scope: 'MINE' | 'MANAGED'; total: number; items: AttentionItem[]; hasMore: boolean; checkedAt: string;
}
