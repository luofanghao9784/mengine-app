import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchClient, isWorkbench } from '../src/admin/knowledge-workbench-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const snapshot = {
  tenantId: tenant,
  checkedAt: '2026-10-12T00:00:00Z',
  summary: { total: 0, ready: 0, processing: 0, attention: 0, notStarted: 0 },
  spaces: [],
  filteredTotal: 0,
  items: [],
  hasMore: false,
};
test('workbench contract rejects impossible totals and invalid timestamps', () => {
  assert.ok(isWorkbench(snapshot));
  assert.equal(isWorkbench({ ...snapshot, summary: { ...snapshot.summary, total: 2 } }), false);
  assert.equal(isWorkbench({ ...snapshot, checkedAt: 'invalid' }), false);
  assert.equal(isWorkbench({ ...snapshot, filteredTotal: 1 }), false);
});
test('workbench client rejects a response from another enterprise', async () => {
  const read = createWorkbenchClient(
    (async () =>
      new Response(JSON.stringify({ ...snapshot, tenantId: '00000000-0000-4000-8000-000000000002' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  );
  await assert.rejects(read(tenant, 'ALL', null, '', 0));
});
test('workbench sends filters to the server', async () => {
  const controller = new AbortController();
  let requested = '';
  let options: RequestInit | undefined;
  const read = createWorkbenchClient((async (url, init) => {
    requested = String(url);
    options = init;
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch);
  await read(tenant, 'ATTENTION', null, '金额 & 日期', 20, controller.signal);
  const url = new URL(requested, 'http://localhost');
  assert.equal(url.searchParams.get('q'), '金额 & 日期');
  assert.equal(url.searchParams.get('offset'), '20');
  assert.equal(url.searchParams.get('state'), 'ATTENTION');
  assert.ok(options?.signal instanceof AbortSignal);
});

test('workbench cancellation interrupts the pending request', async () => {
  const controller = new AbortController();
  const read = createWorkbenchClient(
    (async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      })) as typeof fetch,
  );
  const pending = read(tenant, 'ALL', null, '', 0, controller.signal);
  controller.abort();
  await assert.rejects(pending);
});
