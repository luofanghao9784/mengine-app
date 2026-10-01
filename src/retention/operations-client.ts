import type { OperationRetentionStatus } from '../../contracts/public-api/operation-retention.ts';
import { createIdentityRequest, record, uuid, IdentityError } from '../identity/client.ts';
export const isOperationRetentionStatus = (v: unknown): v is OperationRetentionStatus =>
  record(v) &&
  (v.tenantId === null || uuid(v.tenantId)) &&
  ['pending', 'failed', 'complete', 'removedEvents', 'removedAudit'].every(
    (k) => Number.isSafeInteger(v[k]) && Number(v[k]) >= 0,
  ) &&
  (v.nextDeadline === null ||
    (typeof v.nextDeadline === 'string' && Number.isFinite(Date.parse(v.nextDeadline)))) &&
  v.coverage === 'NEW_CLOSED_TASK_NOTIFICATIONS' &&
  v.protectedRecords === 'BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION';
export function createOperationRetentionClient(fetcher: typeof fetch = fetch) {
  const send = createIdentityRequest(fetcher);
  return (tenant: string | null, signal?: AbortSignal) => {
    if (tenant !== null && !uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
    return send(
      tenant
        ? `/api/v1/tenants/${tenant}/retention/operation-cleanup`
        : '/api/platform-admin/v1/operation-cleanup',
      'GET',
      (v): v is OperationRetentionStatus => isOperationRetentionStatus(v) && v.tenantId === tenant,
      undefined,
      signal,
    );
  };
}
export const getOperationRetention = createOperationRetentionClient();
