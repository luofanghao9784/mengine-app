import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageClient, isStorageStatus } from '../src/operations/storage-client.ts';
const id = '00000000-0000-4000-8000-000000000001',
  now = '2026-10-04T10:00:00Z';
const event = {
  id,
  command: 'RESTORE',
  state: 'SUCCEEDED',
  startedAt: now,
  finishedAt: now,
  snapshot: { id, createdAt: now, expiresAt: '2026-11-04T10:00:00Z', bytes: 10, files: 1, tables: 2 },
};
const value = {
  checkedAt: now,
  storage: {
    databaseBytes: 100,
    knowledgeBytes: 10,
    registeredOriginalBytes: 0,
    originalVolume: { state: 'NOT_CONFIGURED', totalBytes: null, usableBytes: null },
  },
  cleanup: { queued: 0, running: 0, failed: 0, completed: 0, lastCompletedAt: null },
  backup: { state: 'FRESH', updatedAt: now, staleSeconds: 900, events: [event] },
};
test('storage rejects private fields, unknown capacity presented as zero, forged stage facts and repeated events', () => {
  assert.ok(isStorageStatus(value));
  assert.ok(
    isStorageStatus({
      ...value,
      backup: {
        ...value.backup,
        state: 'STALE',
        events: [{ ...event, state: 'UNKNOWN', finishedAt: null, snapshot: null }],
      },
    }),
  );
  for (const field of ['path', 'content', 'credentials', 'error'])
    assert.equal(
      isStorageStatus({ ...value, backup: { ...value.backup, events: [{ ...event, [field]: 'private' }] } }),
      false,
    );
  for (const wrong of [
    { ...event, state: 'FAILED' },
    { ...event, command: 'ROTATE' },
    { ...event, snapshot: { ...event.snapshot, bytes: -1 } },
    { ...event, finishedAt: null },
  ])
    assert.equal(isStorageStatus({ ...value, backup: { ...value.backup, events: [wrong] } }), false);
  assert.equal(isStorageStatus({ ...value, backup: { ...value.backup, events: [event, event] } }), false);
  assert.equal(
    isStorageStatus({
      ...value,
      storage: { ...value.storage, originalVolume: { state: 'UNAVAILABLE', totalBytes: 0, usableBytes: 0 } },
    }),
    false,
  );
  assert.equal(isStorageStatus({ ...value, backup: { ...value.backup, state: 'UNAVAILABLE' } }), false);
});
test('storage requests independent platform read only and rejects malformed response', async () => {
  let bad = false;
  const calls: string[] = [];
  const api = createStorageClient(async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify(bad ? { ...value, private: 'secret' } : value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.equal((await api.status()).backup.events[0].command, 'RESTORE');
  assert.deepEqual(calls, ['/api/platform-admin/v1/storage-status']);
  bad = true;
  await assert.rejects(api.status());
});
