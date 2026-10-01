import test from 'node:test';
import assert from 'node:assert/strict';
import { createForwardingClient, isForwardBatch, isForwardDelivery } from '../src/forwarding/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = {
  publicationId: id(2),
  workspaceId: id(3),
  workspaceName: '企业成果',
  materialId: id(4),
  materialVersionId: id(5),
  materialVersion: 1,
  filename: '合成.docx',
  format: 'docx',
  sha256: 'a'.repeat(64),
  publishedAt: '2026-10-01T00:00:00Z',
};
const recipient = {
  receiptId: id(8),
  accountId: id(9),
  name: '同事',
  state: 'ACCEPTED',
  openedAt: null,
  currentlyAccessible: true,
};
const batch = {
  id: id(6),
  publicationId: id(2),
  materialVersionId: id(5),
  requestId: id(7),
  acceptedAt: '2026-10-01T00:00:00Z',
  note: '请核对',
  source,
  recipients: [recipient],
};
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
test('guards reject impossible opened claims, duplicate receivers and wrong exact version', () => {
  assert.ok(isForwardBatch(batch));
  assert.equal(isForwardBatch({ ...batch, recipients: [recipient, recipient] }), false);
  assert.equal(isForwardBatch({ ...batch, materialVersionId: id(99) }), false);
  assert.equal(isForwardBatch({ ...batch, recipients: [{ ...recipient, state: 'OPENED' }] }), false);
  assert.ok(
    isForwardDelivery({
      id: id(8),
      batchId: id(6),
      senderId: id(10),
      senderName: '发送者',
      acceptedAt: batch.acceptedAt,
      openedAt: null,
      state: 'ACCEPTED',
      note: '',
      source,
    }),
  );
});
test('lost acceptance retry preserves key, exact scope and receiver list with csrf', async () => {
  let lost = true;
  const bodies: unknown[] = [];
  const api = createForwardingClient(async (url, init) => {
    assert.equal(init?.cache, 'no-store');
    if (String(url).endsWith('/csrf')) return response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    bodies.push(JSON.parse(String(init?.body)));
    if (lost) {
      lost = false;
      throw new TypeError('lost accepted reply');
    }
    return response(batch);
  });
  const body = { publicationId: id(2), materialVersionId: id(5), recipients: [id(9)], note: '请核对' };
  await assert.rejects(api.send(id(1), body, id(7)));
  assert.equal((await api.send(id(1), body, id(7))).id, id(6));
  assert.deepEqual(bodies, [
    { ...body, requestId: id(7) },
    { ...body, requestId: id(7) },
  ]);
});
test('client does not treat another batch/version or expanded recipients as success', async () => {
  const api = createForwardingClient(async (url) =>
    String(url).endsWith('/csrf')
      ? response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })
      : response({ ...batch, recipients: [{ ...recipient, accountId: id(11) }] }),
  );
  await assert.rejects(
    api.send(id(1), { publicationId: id(2), materialVersionId: id(5), recipients: [id(9)], note: '' }, id(7)),
    { code: 'CONTRACT_MISMATCH' },
  );
  await assert.rejects(api.batch(id(1), id(99)), { code: 'CONTRACT_MISMATCH' });
  const people = createForwardingClient(async () => response({ source, items: [], hasMore: false }));
  await assert.rejects(people.recipients(id(1), id(2), id(99)), { code: 'CONTRACT_MISMATCH' });
});
test('revoked reads return denial and invalid scope never sends a request', async () => {
  let calls = 0;
  const api = createForwardingClient(async () => {
    calls++;
    return new Response(JSON.stringify({ contractVersion: '1.0', code: 'FORWARDING_NOT_AVAILABLE' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  });
  await assert.rejects(api.inbox(id(1)), { status: 404 });
  assert.throws(() => api.inbox(id(1), -1));
  await assert.rejects(api.recipients(id(1), id(2), 'bad'));
  assert.equal(calls, 1);
});
