import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsClient, isOperations } from '../src/operations/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
const value = {
  tenantId: tenant,
  days: 7,
  from: '2026-09-17T00:00:00Z',
  checkedAt: '2026-09-24T00:00:00Z',
  tasks: {
    total: 2,
    queued: 0,
    running: 0,
    succeeded: 1,
    failed: 1,
    cancelled: 0,
    interrupted: 0,
    paused: 0,
    waitingInput: 0,
    waitingCapability: 0,
    partial: 0,
    resultUnknown: 0,
    retryStarts: 0,
  },
  attemptUsage: [],
  storage: { materials: 1, versions: 2, originalBytes: 12 },
  models: [
    {
      executionClass: 'live',
      succeededTasks: 1,
      reportedTasks: 0,
      modelCalls: 2,
      inputTokens: null,
      outputTokens: null,
    },
  ],
  errors: [{ code: 'TASK_MODEL_FAILED', tasks: 1, lastOccurredAt: '2026-09-24T00:00:00Z' }],
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('operations scopes and windows are checked before rendering and requests never cache', async () => {
  const client = createOperationsClient(async (path, init) => {
    assert.equal(path, `/api/tenant-admin/v1/tenants/${tenant}/operations?days=7`);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'same-origin');
    return response(value);
  });
  assert.deepEqual(await client('tenant', tenant, 7), value);
  for (const bad of [
    { ...value, tenantId: other },
    { ...value, tenantId: null },
    { ...value, days: 30 },
  ])
    await assert.rejects(
      createOperationsClient(async () => response(bad))('tenant', tenant, 7),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  await assert.rejects(
    createOperationsClient(async () => {
      throw Error('must not fetch');
    })('tenant', null, 7),
  );
});
test('operations validator rejects content, inconsistent sums, arbitrary errors and duplicate modes', () => {
  assert.ok(isOperations(value));
  for (const bad of [
    { ...value, prompt: 'private' },
    { ...value, tasks: { ...value.tasks, total: 3 } },
    { ...value, storage: { ...value.storage, filename: 'private' } },
    { ...value, models: [...value.models, ...value.models] },
    { ...value, models: [{ ...value.models[0], inputTokens: 0 }] },
    { ...value, models: [{ ...value.models[0], reportedTasks: 2 }] },
    { ...value, errors: [] },
    { ...value, errors: [{ ...value.errors[0], code: 'secret-exception' }] },
    { ...value, errors: [{ ...value.errors[0], taskId: other }] },
    { ...value, tasks: { ...value.tasks, total: Infinity } },
  ])
    assert.equal(isOperations(bad), false);
});
test('unknown usage is not turned into zero and verification stays separate', () => {
  assert.ok(isOperations(value));
  assert.ok(
    isOperations({
      ...value,
      models: [
        {
          ...value.models[0],
          executionClass: 'verification',
          reportedTasks: 1,
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
    }),
  );
  assert.equal(isOperations({ ...value, models: [{ ...value.models[0], executionClass: 'other' }] }), false);
});

test('attempt usage retains incomplete coverage and rejects impossible counts or content fields', () => {
  const row = {
    executionClass: 'live',
    attempts: 2,
    meteredAttempts: 1,
    running: 0,
    succeeded: 1,
    failed: 1,
    cancelled: 0,
    interrupted: 0,
    paused: 0,
    waitingInput: 0,
    waitingCapability: 0,
    partial: 0,
    resultUnknown: 0,
    requests: 2,
    pendingRequests: 1,
    reportedRequests: 1,
    inputTokens: 0,
    outputTokens: 0,
  };
  assert.ok(isOperations({ ...value, attemptUsage: [row] }));
  for (const bad of [
    { ...row, attempts: 1 },
    { ...row, meteredAttempts: 3 },
    { ...row, requests: 9 },
    { ...row, pendingRequests: 2 },
    { ...row, inputTokens: null },
    { ...row, reportedRequests: 0 },
    { ...row, prompt: 'private' },
    { ...row, requests: -1 },
  ])
    assert.equal(isOperations({ ...value, attemptUsage: [bad] }), false);
  assert.equal(isOperations({ ...value, attemptUsage: [row, row] }), false);
});
