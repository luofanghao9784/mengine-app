import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityRequest, IdentityError } from '../src/identity/client.ts';
import { createNativeConversationClient } from '../src/native-conversation/client.ts';
import { nativeSessionTitle } from '../src/native-conversation/labels.ts';

const tenant = '00000000-0000-4000-8000-000000000001';
const space = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
const legacy = '00000000-0000-4000-8000-000000000004';
const session = {
  id,
  tenantId: tenant,
  ownerId: tenant,
  workspaceId: space,
  legacyConversationId: null,
  state: 'ACTIVE',
  createdAt: '2026-10-26T07:26:00Z',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function harness(reply: (path: string, init?: RequestInit) => Response) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    if (String(path).endsWith('/auth/csrf')) return json({ token: 'csrf', headerName: 'X-CSRF-TOKEN' });
    calls.push({
      path: String(path),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return reply(String(path), init);
  };
  return { calls, api: createNativeConversationClient(createIdentityRequest(fetcher)) };
}

test('availability, listing and lifecycle use the tenant-scoped native endpoints', async () => {
  const { calls, api } = harness((path) =>
    path.endsWith('/availability')
      ? json({ enabled: true })
      : path.includes('?workspaceId=')
        ? json([session])
        : json(session),
  );
  assert.deepEqual(await api.availability(tenant), { enabled: true });
  assert.equal((await api.list(tenant, space))[0].id, id);
  await api.open(tenant, space, legacy, 'request-1');
  await api.stop(tenant, id);
  await api.resume(tenant, id);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path.replace(`/api/v1/tenants/${tenant}/native-conversations`, '')}`),
    ['GET /availability', `GET ?workspaceId=${space}`, 'POST ', `POST /${id}/stop`, `POST /${id}/resume`],
  );
  assert.deepEqual(calls[2].body, {
    requestId: 'request-1',
    workspaceId: space,
    legacyConversationId: legacy,
  });
});

test("publishing sends the employee's own confirmation, never a default", async () => {
  const { calls, api } = harness(() => json({ artifactId: id, materialId: legacy, workspaceId: space }));
  await api.publish(tenant, id, { artifactId: id, workspaceId: space, acknowledged: false }, 'request-2');
  assert.deepEqual(calls[0].body, {
    requestId: 'request-2',
    artifactId: id,
    workspaceId: space,
    acknowledged: false,
  });
});

test('malformed or unknown session states are rejected instead of shown', async () => {
  const { api } = harness(() => json([{ ...session, state: 'RUNNING' }]));
  await assert.rejects(api.list(tenant, space), (e) => e instanceof IdentityError);
});

test('sessions are named by what they continue, or by when they began', () => {
  const titles = new Map([[legacy, '万象汇退款复核']]);
  assert.equal(
    nativeSessionTitle({ ...session, legacyConversationId: legacy } as never, titles),
    '接续：万象汇退款复核',
  );
  assert.equal(
    nativeSessionTitle({ ...session, legacyConversationId: legacy } as never, new Map()),
    '接续旧会话',
  );
  assert.match(nativeSessionTitle(session as never, titles), /^新会话 · 10\/26 15:26$/);
});
