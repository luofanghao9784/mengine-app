import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskWorkClient, isPlanCheck, isPreferenceReceipt } from '../src/taskwork/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const receipt = {
  id: id(3),
  taskId: id(2),
  requestId: id(4),
  category: 'RESPONSE_LENGTH',
  choice: 'CONCISE',
  label: '回答默认简洁',
  profileId: id(5),
  acceptedRevision: 1,
  currentRevision: 1,
  currentStatus: 'ACTIVE',
  currentlyEffective: true,
  canUndo: true,
  evidenceSource: 'PROMPT',
  createdAt: '2026-10-01T00:00:00Z',
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
test('receipt guards reject cross category and impossible current version claims', () => {
  assert.ok(isPreferenceReceipt(receipt));
  assert.equal(isPreferenceReceipt({ ...receipt, category: 'TONE' }), false);
  assert.equal(isPreferenceReceipt({ ...receipt, currentRevision: 2 }), false);
  assert.equal(isPreferenceReceipt({ ...receipt, canUndo: false }), false);
  assert.ok(
    isPreferenceReceipt({
      ...receipt,
      currentRevision: 2,
      currentStatus: 'WITHDRAWN',
      currentlyEffective: false,
      canUndo: false,
    }),
  );
  assert.equal(
    isPlanCheck({
      id: id(3),
      taskId: id(2),
      planId: id(5),
      requestId: id(4),
      acceptedRevision: 1,
      executionEpoch: 1,
      checkAt: '2026-10-01T00:00:00Z',
      reason: '',
      state: 'DISPATCHED',
      currentlyEffective: false,
      dispatchedTaskId: null,
      dispatchUnavailable: false,
    }),
    false,
  );
});
test('GET cannot accept another task receipt and never caches source-dependent metadata', async () => {
  let init: RequestInit | undefined;
  const api = createTaskWorkClient(async (_url, i) => {
    init = i;
    return response({ checks: [], preferences: [{ ...receipt, taskId: id(9) }], hasMore: false });
  });
  await assert.rejects(api.list(id(1), id(2)), { code: 'CONTRACT_MISMATCH' });
  assert.equal(init?.cache, 'no-store');
});
test('lost undo response reuses exact user retry key and mutation remains protected by csrf', async () => {
  const keys: string[] = [];
  let drop = true;
  const api = createTaskWorkClient(async (url, init) => {
    if (String(url).endsWith('/csrf')) return response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    keys.push(JSON.parse(String(init?.body)).requestId);
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    if (drop) {
      drop = false;
      throw new TypeError('synthetic lost response');
    }
    return response({
      ...receipt,
      currentRevision: 2,
      currentStatus: 'WITHDRAWN',
      currentlyEffective: false,
      canUndo: false,
    });
  });
  await assert.rejects(api.undo(id(1), id(2), id(3), id(7)));
  const r = await api.undo(id(1), id(2), id(3), id(7));
  assert.equal(r.currentStatus, 'WITHDRAWN');
  assert.deepEqual(keys, [id(7), id(7)]);
});

test('unavailable preference keeps an exact historical receipt without effect or undo', () => {
  assert(
    isPreferenceReceipt({
      ...receipt,
      currentStatus: 'UNAVAILABLE',
      currentlyEffective: false,
      canUndo: false,
    }),
  );
  assert(!isPreferenceReceipt({ ...receipt, currentStatus: 'UNAVAILABLE' }));
  assert(
    !isPreferenceReceipt({
      ...receipt,
      currentStatus: 'UNAVAILABLE',
      currentlyEffective: false,
      canUndo: true,
    }),
  );
});
test('briefing order memory receipts use the same finite preference contract', () => {
  assert.ok(
    isPreferenceReceipt({
      ...receipt,
      category: 'BRIEFING_ORDER',
      choice: 'EVIDENCE_FIRST',
      label: '画报先列依据',
    }),
  );
  assert.equal(isPreferenceReceipt({ ...receipt, category: 'BRIEFING_ORDER', choice: 'FRIENDLY' }), false);
});
