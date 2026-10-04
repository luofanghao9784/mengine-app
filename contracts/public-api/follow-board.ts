/** Account + tenant + board scoped geometry; referenced content still requires its own authorization. */
export interface FollowBoardPreference {
  sizes: Record<string, '1×1' | '1×2' | '2×1' | '2×2'>;
  layout: {
    columns: number;
    order: string[];
    manual: string[];
    positions: { id: string; row: number; col: number; size: '1×1' | '1×2' | '2×1' | '2×2' }[];
  };
}
export interface FollowBoard {
  tenantId: string;
  board: 'PRIVATE' | 'PUBLICATIONS';
  revision: number;
  preference: FollowBoardPreference | null;
}
export interface FollowBoardSave {
  requestId: string;
  expectedRevision: number;
  preference: FollowBoardPreference | null;
}
export interface FollowBoardReceipt {
  appliedRevision: number;
  current: FollowBoard;
}
