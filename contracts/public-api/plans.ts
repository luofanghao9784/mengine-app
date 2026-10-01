/** Persisted personal delegations. No management role grants access to someone else's plan. */
export type PlanBehavior = 'SOURCE_LOOKUP' | 'ANALYZE';
export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'EXPIRED' | 'AUTHORIZATION_REQUIRED';
export type PlanRuntime =
  | 'IDLE'
  | 'WAITING_TIME'
  | 'WAITING_DATA'
  | 'WAITING_CAPABILITY'
  | 'WAITING_RESOURCE'
  | 'RUNNING'
  | 'NEEDS_ATTENTION';
export interface PlanConfiguration {
  workspaceId: string;
  goal: string;
  purpose: string;
  query: string;
  behavior: PlanBehavior;
  materialEvents: boolean;
  dailyTime: string | null;
  timeZone: string;
  /** Execution counts and cadence, not a currency or token spending guarantee. */
  minIntervalSeconds: number;
  maxRunsPerDay: number;
  maxTotalRuns: number;
  expiresAt: string;
  notificationsEnabled: boolean;
}
export interface Plan {
  id: string;
  tenantId: string;
  ownerId: string;
  revision: number;
  executionEpoch: number;
  status: PlanStatus;
  runtimeState: PlanRuntime;
  reason: string | null;
  configuration: PlanConfiguration;
  nextDue: string | null;
  lastDispatchedAt: string | null;
  runs: number;
  todayRuns: number;
  checkedAt: string | null;
}
export interface PlanPage {
  items: Plan[];
  hasMore: boolean;
}
export interface PlanConfigurationVersion {
  planId: string;
  revision: number;
  configuration: PlanConfiguration;
  createdAt: string;
}
export interface PlanRun {
  id: string;
  planId: string;
  planRevision: number;
  executionEpoch: number;
  triggerKind: 'MATERIAL_VERSION' | 'DAILY' | 'RETRY';
  scheduledFor: string | null;
  missedSlots: number;
  eventThrough: number;
  sourceVersions: { materialId: string; versionId: string; parseStatus: string }[];
  conversationId: string;
  taskId: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface PlanRuns {
  items: PlanRun[];
  hasMore: boolean;
}
export interface PlanAttention {
  id: string;
  workspaceId: string;
  title: string;
  reason: string | null;
  status: PlanStatus;
  revision: number;
  taskId: string | null;
  conversationId: string | null;
  action: 'OPEN_PLAN' | 'OPEN_TASK';
}
export interface PlanAttentionPage {
  items: PlanAttention[];
  hasMore: boolean;
}
export interface CreatePlan {
  requestId: string;
  configuration: PlanConfiguration;
}
export interface UpdatePlan extends CreatePlan {
  expectedRevision: number;
}
export type PlanAction = 'ENABLE' | 'PAUSE' | 'RESUME' | 'STOP' | 'RETRY' | 'MUTE' | 'UNMUTE';
export interface ActOnPlan {
  requestId: string;
  expectedRevision: number;
  action: PlanAction;
  delegationAccepted: boolean;
}
/**
 * POST creates DRAFT; explicit ENABLE accepts its immutable configuration version.
 * At most 20 unclosed plans/owner, 48 dispatched tasks/UTC day/owner, 2 concurrent plan tasks/owner.
 * Per-plan cadence: >=60 seconds, <=24 runs/local day, <=10000 total, expiry <=366 days at acceptance.
 * DAILY: one local-date check, DST gap -> first valid time, overlap -> earlier occurrence only.
 * Missed dates coalesce into one current check with missedSlots; they are never reported executed.
 * Material events coalesce committed version identities; event replay and empty ticks create no task.
 * Each DAILY commitment can reuse current source versions. MODEL_NOT_CONFIGURED does not consume a run.
 * A run's sourceVersions is the trigger-time coverage; the actual task's citations are its used evidence.
 * PAUSE/STOP/expiry revoke pending execution; RESUME rechecks scope and never revives old attempts.
 * Editing requires a draft/paused plan and returns DRAFT for explicit renewed acceptance.
 * MUTE changes delivery preference only. APIs are private,no-store and require session + CSRF on writes.
 */
