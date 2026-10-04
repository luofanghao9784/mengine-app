export const backupCommands = [
  'CREATE',
  'VERIFY',
  'RESTORE',
  'REPACK',
  'ROTATE',
  'RECONCILE',
  'ACTIVATE',
] as const;
export type BackupCommand = (typeof backupCommands)[number];
export interface BackupSnapshot {
  id: string;
  createdAt: string;
  expiresAt: string;
  bytes: number;
  files: number;
  tables: number;
}
export interface BackupEvent {
  id: string;
  command: BackupCommand;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  startedAt: string;
  finishedAt: string | null;
  snapshot: BackupSnapshot | null;
}
export interface BackupObservation {
  state: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'FRESH' | 'STALE';
  updatedAt: string | null;
  staleSeconds: number;
  events: BackupEvent[];
}
export interface StorageStatus {
  checkedAt: string;
  storage: {
    databaseBytes: number;
    knowledgeBytes: number;
    registeredOriginalBytes: number;
    originalVolume: {
      state: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'OBSERVED';
      totalBytes: number | null;
      usableBytes: number | null;
    };
  };
  cleanup: {
    queued: number;
    running: number;
    failed: number;
    completed: number;
    lastCompletedAt: string | null;
  };
  backup: BackupObservation;
}
