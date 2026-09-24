import test from 'node:test';
import assert from 'node:assert/strict';
import { createBriefingClient } from '../src/briefing-live/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const preference = { revision: 1, pinned: true, hidden: false, size: 'WIDE' as const };
const card = {
  conversationId: id,
  taskId: id,
  workspaceId: space,
  workspaceName: '合成空间',
  title: '合成任务',
  excerpt: '<script>literal</script>',
  truncated: false,
  completedAt: '2026-09-23T08:00:00Z',
  executionClass: 'verification',
  engineVersion: '0.8.0',
  artifactCount: 2,
  citationCount: 1,
  originalCount: 1,
  preference,
};
const filter = { view: 'LATEST' as const, date: null, zone: 'Asia/Shanghai', workspaceId: space };
const page = {
  tenantId: tenant,
  view: 'LATEST',
  date: null,
  zone: filter.zone,
  items: [card],
  hasMore: false,
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
test('briefing accepts escaped text but rejects foreign scopes, duplicate conversations and invalid receipts', async () => {
  assert.deepEqual(await createBriefingClient(async () => response(page)).list(tenant, filter), page);
  for (const value of [
    { ...page, tenantId: id },
    { ...page, items: [{ ...card, workspaceId: id }] },
    { ...page, items: [card, card] },
    { ...page, items: [{ ...card, excerpt: 'x'.repeat(1201) }] },
    { ...page, items: [{ ...card, executionClass: 'pretend-live' }] },
    { ...page, items: [{ ...card, artifactCount: 9 }] },
    { ...page, items: [{ ...card, preference: { ...preference, revision: -1 } }] },
    { ...page, items: [{ ...card, preference: { ...preference, hidden: true } }] },
    { ...page, date: '2026-09-22' },
    { ...page, zone: 'UTC' },
  ])
    await assert.rejects(
      createBriefingClient(async () => response(value)).list(tenant, filter),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});
test('focused and hidden feeds validate preferences and requested calendar day', async () => {
  const day = { ...filter, view: 'FOCUSED' as const, date: '2026-09-23' };
  await createBriefingClient(async (url, init) => {
    const query = new URL(String(url), 'http://localhost').searchParams;
    assert.equal(query.get('date'), day.date);
    assert.equal(query.get('zone'), day.zone);
    assert.equal(query.get('offset'), '20');
    assert.equal(init?.cache, 'no-store');
    return response({ ...page, view: day.view, date: day.date });
  }).list(tenant, day, 20);
  await assert.rejects(
    createBriefingClient(async () =>
      response({
        ...page,
        view: 'FOCUSED',
        items: [{ ...card, preference: { ...preference, pinned: false } }],
      }),
    ).list(tenant, { ...filter, view: 'FOCUSED' }),
  );
  await assert.rejects(
    createBriefingClient(async () => response({ ...page, view: 'HIDDEN' })).list(tenant, {
      ...filter,
      view: 'HIDDEN',
    }),
  );
});
test('briefing updates retain request id, revision and CSRF without replaying lost replies', async () => {
  const body = { requestId: id, expectedRevision: 1, pinned: true, hidden: true, size: 'WIDE' as const };
  let sends = 0;
  await assert.rejects(
    createBriefingClient(async (url, init) => {
      if (String(url).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
      sends++;
      assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      throw new TypeError('lost response');
    }).update(tenant, id, body),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sends, 1);
});
