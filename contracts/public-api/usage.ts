export const usagePeriods = ['THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS'] as const;
export type UsagePeriod = (typeof usagePeriods)[number];
export type UsageClass = 'live' | 'verification' | 'unknown';
export interface ModelUsageGroup {
  purpose: 'WORK' | 'MAINTENANCE';
  executionClass: UsageClass;
  basis: 'REQUEST_STARTED' | 'RUN_STARTED';
  units: number;
  reportedUnits: number;
  unknownCallUnits: number;
  pendingUnits: number;
  modelCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface UsageDay {
  date: string;
  workRequests: number;
  maintenanceCalls: number | null;
  unknownMaintenanceRuns: number;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface ToolUsageGroup {
  executionClass: UsageClass;
  starts: number;
  succeeded: number;
  failed: number;
  pending: number;
  timed: number;
  elapsedMillis: number | null;
}
export interface UsageOverview {
  tenantId: string | null;
  period: UsagePeriod;
  timeZone: string;
  from: string;
  until: string;
  checkedAt: string;
  groups: ModelUsageGroup[];
  days: UsageDay[];
  tools: ToolUsageGroup[];
  storage: { originals: number; versions: number; registeredBytes: number };
  coverage: {
    unmeteredWorkAttempts: number;
    legacyToolReceipts: number;
    /** All-history jobs with unverified governance call times; excluded from period totals. Omitted by older platforms. */
    legacyGovernanceJobs?: number;
    evaluation: 'NOT_CONNECTED';
    evolution: 'NOT_ENABLED';
  };
  quota: { state: 'NOT_CONFIGURED'; unit: null; limit: null; remaining: null };
}
export interface UsageCost {
  state: 'NOT_CONNECTED';
  currency: null;
  verifiedMinor: null;
  estimatedMinor: null;
  sharedAllocation: 'NOT_CONFIGURED';
}
export interface PlatformUsage {
  usage: UsageOverview;
  cost: UsageCost;
}
