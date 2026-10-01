import type {
  TaskPlanCheckReceipt,
  TaskPreferenceReceipt,
  TaskWorkReceipts,
} from '../../contracts/public-api/task-work.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
export const isPlanCheck = (v: unknown): v is TaskPlanCheckReceipt =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.taskId) &&
  uuid(v.planId) &&
  uuid(v.requestId) &&
  number(v.acceptedRevision) &&
  v.acceptedRevision >= 1 &&
  number(v.executionEpoch) &&
  date(v.checkAt) &&
  typeof v.reason === 'string' &&
  v.reason.length <= 500 &&
  one(v.state, ['PENDING', 'DISPATCHED', 'CANCELLED']) &&
  typeof v.currentlyEffective === 'boolean' &&
  (v.dispatchedTaskId === null || uuid(v.dispatchedTaskId)) &&
  typeof v.dispatchUnavailable === 'boolean' &&
  v.dispatchUnavailable === (v.state === 'DISPATCHED' && v.dispatchedTaskId === null) &&
  (!v.currentlyEffective || v.state === 'PENDING');
export const isPreferenceReceipt = (v: unknown): v is TaskPreferenceReceipt =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.taskId) &&
  uuid(v.requestId) &&
  one(v.category, ['RESPONSE_LENGTH', 'RESPONSE_FORMAT', 'TONE']) &&
  one(
    v.choice,
    v.category === 'RESPONSE_LENGTH'
      ? ['CONCISE', 'DETAILED']
      : v.category === 'RESPONSE_FORMAT'
        ? ['PARAGRAPHS', 'BULLETS']
        : ['DIRECT', 'FRIENDLY'],
  ) &&
  typeof v.label === 'string' &&
  v.label.length > 0 &&
  v.label.length < 100 &&
  uuid(v.profileId) &&
  number(v.acceptedRevision) &&
  v.acceptedRevision >= 1 &&
  number(v.currentRevision) &&
  v.currentRevision >= v.acceptedRevision &&
  one(v.currentStatus, ['ACTIVE', 'PROPOSED', 'WITHDRAWN', 'EXPIRED', 'UNAVAILABLE']) &&
  typeof v.currentlyEffective === 'boolean' &&
  typeof v.canUndo === 'boolean' &&
  v.canUndo === v.currentlyEffective &&
  (!v.currentlyEffective || (v.currentRevision === v.acceptedRevision && v.currentStatus === 'ACTIVE')) &&
  one(v.evidenceSource, ['PROMPT', 'SUPPLEMENT']) &&
  date(v.createdAt);
export const isTaskWorkReceipts = (v: unknown): v is TaskWorkReceipts =>
  record(v) &&
  Array.isArray(v.checks) &&
  v.checks.length <= 20 &&
  v.checks.every(isPlanCheck) &&
  Array.isArray(v.preferences) &&
  v.preferences.length <= 20 &&
  v.preferences.every(isPreferenceReceipt) &&
  typeof v.hasMore === 'boolean';
export function createTaskWorkClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    path = (tenant: string, task: string) => {
      if (!uuid(tenant) || !uuid(task)) throw new IdentityError('INVALID_REQUEST', 400);
      return `/api/v1/tenants/${tenant}/tasks/${task}/work-receipts`;
    };
  return {
    async list(tenant: string, task: string, offset = 0, signal?: AbortSignal) {
      if (!number(offset) || offset > 100000) throw new IdentityError('INVALID_REQUEST', 400);
      const value = await request(
        `${path(tenant, task)}?offset=${offset}`,
        'GET',
        isTaskWorkReceipts,
        undefined,
        signal,
      );
      if (
        !isTaskWorkReceipts(value) ||
        [...value.checks, ...value.preferences].some((r) => r.taskId !== task)
      )
        throw new IdentityError('CONTRACT_MISMATCH', 502);
      return value;
    },
    async undo(tenant: string, task: string, receipt: string, requestId: string) {
      if (!uuid(receipt) || !uuid(requestId)) throw new IdentityError('INVALID_REQUEST', 400);
      const value = await request(`${path(tenant, task)}/${receipt}/undo`, 'POST', isPreferenceReceipt, {
        requestId,
      });
      if (!isPreferenceReceipt(value) || value.id !== receipt || value.taskId !== task)
        throw new IdentityError('CONTRACT_MISMATCH', 502);
      return value;
    },
  };
}
export const taskWorkClient = createTaskWorkClient();
