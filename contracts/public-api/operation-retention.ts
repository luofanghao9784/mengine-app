export interface OperationRetentionStatus {
  tenantId: string | null;
  pending: number;
  failed: number;
  complete: number;
  removedEvents: number;
  removedAudit: number;
  nextDeadline: string | null;
  coverage: 'NEW_CLOSED_TASK_NOTIFICATIONS';
  protectedRecords: 'BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION';
}
