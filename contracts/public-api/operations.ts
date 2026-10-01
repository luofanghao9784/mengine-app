/** Operations 1.2.0: current state of tasks created in [from, checkedAt); not a billing ledger. */
export type OperationsDays = 7 | 30;
export type OperationsErrorCode =
  | 'TASK_SOURCE_UNAVAILABLE'
  | 'TASK_RUNTIME_INCOMPATIBLE'
  | 'TASK_RUNTIME_UNAVAILABLE'
  | 'TASK_MODEL_FAILED'
  | 'TASK_LIMIT'
  | 'TASK_TOOL_FAILED'
  | 'MODEL_NOT_CONFIGURED'
  | 'PUBLIC_WEB_NOT_CONFIGURED'
  | 'TASK_FILE_UNSUPPORTED'
  | 'TASK_FILE_ENCODING'
  | 'TASK_FILE_INVALID'
  | 'TASK_FILE_LIMIT'
  | 'TASK_FILE_DATA'
  | 'TASK_INTERRUPTED'
  | 'TASK_RESULT_UNKNOWN'
  | 'TASK_PLAN_STOPPED'
  | 'TASK_PLAN_EXPIRED'
  | 'OTHER';
export interface OperationsOverview {
  tenantId: string | null;
  days: OperationsDays;
  from: string;
  checkedAt: string;
  tasks: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    interrupted: number;
    paused: number;
    waitingInput: number;
    waitingCapability: number;
    partial: number;
    resultUnknown: number;
    retryStarts: number;
  };
  /** All originals not yet physically removed, including historical versions, irrespective of task window. */
  storage: { materials: number; versions: number; originalBytes: number };
  /** Successful Agent receipts only. Partial coverage and verification mode must stay visible. */
  models: {
    executionClass: 'live' | 'verification';
    succeededTasks: number;
    reportedTasks: number;
    modelCalls: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  /** Current failed/interrupted/unknown tasks; a successfully retried task leaves this view. */
  /** Attempts started in [from, checkedAt), including retries. V15 onward, no historic backfill. */
  attemptUsage: {
    executionClass: 'live' | 'verification';
    attempts: number;
    meteredAttempts: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    interrupted: number;
    paused: number;
    waitingInput: number;
    waitingCapability: number;
    partial: number;
    resultUnknown: number;
    requests: number;
    pendingRequests: number;
    reportedRequests: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  errors: { code: OperationsErrorCode; tasks: number; lastOccurredAt: string }[];
}
