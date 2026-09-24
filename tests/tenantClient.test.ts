import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantClient } from '../src/tenant/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  spaceId = '00000000-0000-4000-8000-000000000003';
const space = { id: spaceId, tenantId: tenant, name: '共享空间', kind: 'SHARED', version: 0, memberCount: 0 };
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
const client = (v: unknown) =>
  createTenantClient(
    async (path) =>
      new Response(
        JSON.stringify(String(path).endsWith('/csrf') ? { token: 'csrf', headerName: 'X-CSRF-TOKEN' } : v),
      ),
  );
test('tenant client rejects foreign tenants, personal spaces and response identity mismatch', async () => {
  await assert.rejects(client([{ ...space, tenantId: other }]).spaces(tenant), mismatch);
  await assert.rejects(client([{ ...space, kind: 'PERSONAL' }]).spaces(tenant), mismatch);
  await assert.rejects(client({ ...space, id: other }).space(tenant, spaceId), mismatch);
  await assert.rejects(client({ ...space, version: -1 }).space(tenant, spaceId), mismatch);
  assert.deepEqual(await client(space).space(tenant, spaceId), space);
  await assert.rejects(
    client([
      {
        id: spaceId,
        tenantId: other,
        email: 'test@example.test',
        role: 'MEMBER',
        status: 'PENDING',
        expiresAt: '2026-09-25T00:00:00Z',
      },
    ]).invitations(tenant),
    mismatch,
  );
});
test('tenant writes retain supplied request key and require fresh csrf without replay', async () => {
  const sent: { path: string; init?: RequestInit }[] = [];
  const api = createTenantClient(async (path, init) => {
    sent.push({ path: String(path), init });
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'fresh', headerName: 'X-CSRF-TOKEN' }));
    throw new TypeError('Disconnected');
  });
  const body = { requestId: other, expectedVersion: 3, enabled: true };
  await assert.rejects(
    api.grant(tenant, spaceId, other, body),
    (e: unknown) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(String(sent[1].init?.body)), body);
  assert.equal((sent[1].init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'fresh');
  assert.equal(sent[1].init?.credentials, 'same-origin');
});
test('tenant client rejects platform roles and non-management activity records', async () => {
  await assert.rejects(
    client([
      {
        accountId: other,
        email: 'test@example.test',
        displayName: '测试',
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE',
        accountStatus: 'ACTIVE',
        version: 0,
      },
    ]).members(tenant),
    mismatch,
  );
  await assert.rejects(
    client([
      {
        id: 1,
        actorId: other,
        actorName: '测试',
        action: 'CONVERSATION_READ',
        targetId: spaceId,
        targetName: '私人',
        relatedAccountId: null,
        relatedAccountName: null,
        createdAt: '2026-09-22T00:00:00Z',
      },
    ]).records(tenant),
    mismatch,
  );
  assert.equal(await client(null).revoke(tenant, other), null);
});
