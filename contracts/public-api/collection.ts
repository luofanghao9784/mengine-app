/** Deployed structured data: schedules do not modify briefing policies or grant content access. */
export interface CollectionSchedule {
  enabled: boolean;
  frequency: 'QUARTER_HOUR' | 'HOURLY' | 'DAILY' | null;
  dailyTime: string | null;
  timeZone: string;
}
export interface CollectionRun {
  id: string;
  triggerKind: 'MANUAL' | 'SCHEDULED';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
  reason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface DataConnection {
  id: string;
  name: string;
  routeLabel: string;
  accessSummary: string;
  status: 'READY' | 'UNAVAILABLE' | 'UNCONFIGURED';
  revision: number;
  canControl: boolean;
  schedule: CollectionSchedule;
  nextDue: string | null;
  lastSuccessAt: string | null;
  currentRun: CollectionRun | null;
  lastRun: CollectionRun | null;
}
/** Supplied by deployment tools. Inference is not a verified business fact. */
export interface DatasetField {
  column: string;
  type: string;
  meaning: string;
  unit: string;
  evidence: string;
  status: 'SOURCE_DOCUMENTED' | 'DEPLOYMENT_INFERRED' | 'UNKNOWN';
}
export interface BusinessDataset {
  id: string;
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  description: string;
  columns: string[];
  fieldDefinitions?: DatasetField[];
  version: number | null;
  rowCount: number | null;
  collectedAt: string | null;
  coverageThrough: string | null;
  latestRun: CollectionRun | null;
}
export interface DataSummary {
  datasets: number;
  available: number;
  updating: number;
  failed: number;
}
export interface DatasetPage {
  items: BusinessDataset[];
  hasMore: boolean;
}
export interface DatasetPreview {
  dataset: BusinessDataset;
  rows: (string | null)[][];
  hasMore: boolean;
}

/** Explicit withdrawal is separate from irreversible online-body erasure. */
export interface DatasetLifecycle {
  id: string;
  name: string;
  state: 'ACTIVE' | 'WITHDRAWN' | 'PURGED';
  revision: number;
  snapshots: number;
  rows: number;
  canWithdraw: boolean;
  canPurge: boolean;
}
