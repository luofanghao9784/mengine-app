import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformClient } from '../src/platform/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const detail = {
  tenant: { id, name: '合成企业', status: 'ACTIVE' },
  version: 0,
  createdAt: '2026-09-22T01:00:00Z',
  initialAdminInvitation: null,
  activeMemberCount: 0,
  workspaceCount: 0,
};
const client = (value: unknown) =>
  createPlatformClient(async () => new Response(JSON.stringify(value), { status: 200 }));
const mismatch = (error: unknown) => error instanceof IdentityError && error.code === 'CONTRACT_MISMATCH';

test('platform detail rejects foreign enterprise, foreign invitation and invalid state version', async () => {
  await assert.rejects(client({ ...detail, tenant: { ...detail.tenant, id: other } }).detail(id), mismatch);
  await assert.rejects(client({ ...detail, version: -1 }).detail(id), mismatch);
  await assert.rejects(
    client({
      ...detail,
      initialAdminInvitation: {
        id,
        tenantId: other,
        email: 'synthetic@example.test',
        role: 'TENANT_ADMIN',
        status: 'PENDING',
        expiresAt: '2026-09-25T01:00:00Z',
      },
    }).detail(id),
    mismatch,
  );
  assert.deepEqual(await client(detail).detail(id), detail);
});
test('platform record projection rejects employee activity outside the management action allowlist', async () => {
  const record = {
    id: 1,
    actorId: id,
    actorName: '合成平台管理员',
    targetId: id,
    outcome: 'SUCCESS',
    createdAt: '2026-09-22T01:00:00Z',
  };
  await assert.rejects(client([{ ...record, action: 'INVITATION_ACCEPT' }]).records(id), mismatch);
  assert.equal((await client([{ ...record, action: 'TENANT_CREATE' }]).records(id)).length, 1);
});


test('platform writes obtain platform CSRF and never borrow a customer session token', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createPlatformClient(async (path, init) => {
    calls.push({ path: String(path), init });
    return Response.json(String(path).endsWith('/csrf') ? { token: 'platform-csrf', headerName: 'X-CSRF-TOKEN' } : detail);
  });
  await api.status(id, { requestId: other, expectedVersion: 0, status: 'SUSPENDED' });
  assert.equal(calls[0].path, '/api/platform-admin/v1/auth/csrf');
  assert.equal((calls[1].init?.headers as Record<string,string>)['X-CSRF-TOKEN'], 'platform-csrf');
});
