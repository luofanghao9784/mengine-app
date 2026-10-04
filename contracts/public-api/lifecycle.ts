export type MaterialObjectKind = 'MATERIAL' | 'FOLDER';
export type LifecycleAction = 'TRASH' | 'RESTORE' | 'PURGE' | 'RETRY_CLEANUP';
export interface LifecycleItem {
  id: string;
  kind: MaterialObjectKind;
  name: string;
  state: 'ACTIVE' | 'TRASHED' | 'PURGING' | 'PURGED';
  revision: number;
  trashedAt: string | null;
  purgeAfter: string | null;
  cleanupJobId: string | null;
  canPurge: boolean;
  path: string[];
  parentAvailable: boolean;
}
export interface LifecyclePreview {
  item: LifecycleItem;
  documents: number;
  versions: number;
  folders: number;
  restoration: 'CURRENT_PERMISSIONS_NO_TASK_RESTART';
}
export interface LifecycleReceipt {
  objectId: string;
  kind: MaterialObjectKind;
  action: LifecycleAction;
  resultingState: LifecycleItem['state'];
  revision: number;
  occurredAt: string;
  purgeAfter: string | null;
  cleanupJobId: string | null;
}
export interface CleanupStatus {
  id: string;
  state: 'QUEUED' | 'CLEANING' | 'FAILED' | 'COMPLETE';
  revision: number;
  attempts: number;
  errorCode: string | null;
  originals: number;
  originalsRemoved: number;
  completedAt: string | null;
  backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP';
}
