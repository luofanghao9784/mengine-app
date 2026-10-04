import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceAdjustmentClient, isAdjustment } from '../src/experience/adjustment-client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const receipt = {
  id,
  versionId: id,
  state: 'WAITING',
  resultVersionId: null,
  createdAt: '2026-10-04T00:00:00Z',
};
const proposal = {
  title: '核对',
  summary: '摘要',
  body: '核对回执',
  tags: ['核对'],
  applicable: '有回执',
  excluded: '',
  reason: '区分执行与业务结果',
};
test('adjustment receipts reject raw proposals and unrecognized states', () => {
  assert.ok(isAdjustment(receipt));
  for (const v of [
    { ...receipt, proposal },
    { ...receipt, state: 'APPROVED' },
    { ...receipt, resultVersionId: 'wrong' },
    { ...receipt, createdAt: 'invalid' },
  ])
    assert.equal(isAdjustment(v), false);
});
test('submitting and retrying retain proposal, fixed version, request identity and CSRF', async () => {
  const bodies: string[] = [];
  const client = createExperienceAdjustmentClient((async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.match(String(url), /workspaces\/.+\/experiences\/.+\/adjustments$/);
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    bodies.push(String(init?.body));
    return Response.json(receipt);
  }) as typeof fetch);
  const body = { requestId: other, expectedRevision: 3, versionId: id, proposal };
  await client.submit(id, id, id, body);
  await client.submit(id, id, id, body);
  assert.deepEqual(JSON.parse(bodies[0]), body);
  assert.equal(bodies[0], bodies[1]);
});
test('a submit response cannot silently target a different version', async () => {
  const client = createExperienceAdjustmentClient((async (url) =>
    Response.json(
      String(url).endsWith('/csrf')
        ? { headerName: 'X-CSRF-TOKEN', token: 'synthetic' }
        : { ...receipt, versionId: other },
    )) as typeof fetch);
  await assert.rejects(
    client.submit(id, id, id, { requestId: other, expectedRevision: 3, versionId: id, proposal }),
    { code: 'CONTRACT_MISMATCH' },
  );
});
test('listing validates bounded metadata and rejects malformed scope before fetching', async () => {
  let calls = 0;
  const client = createExperienceAdjustmentClient((async () => {
    calls++;
    return Response.json({ enabled: true, items: Array(11).fill(receipt) });
  }) as typeof fetch);
  assert.throws(() => client.list('wrong', id, id), { code: 'INVALID_REQUEST' });
  assert.equal(calls, 0);
  await assert.rejects(client.list(id, id, id), { code: 'CONTRACT_MISMATCH' });
});
