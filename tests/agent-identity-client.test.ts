import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentIdentityClient } from '../src/identity/agent-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const me = {
  accountId: '00000000-0000-4000-8000-000000000040',
  displayName: '合成总部管理员',
  roles: ['AGENT_ADMIN'],
};

test('第四端严格按独立登录契约取 CSRF、提交账号，刷新与退出不访问客户域', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = createAgentIdentityClient(async (path, init) => {
    calls.push({ path: String(path), init });
    if (String(path).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic-agent' });
    if (String(path).endsWith('/logout')) return new Response(null, { status: 204 });
    return Response.json(me);
  });
  const identity = await client.login('synthetic_admin', 'synthetic-password');
  assert.equal(identity.account.id, me.accountId);
  assert.equal(identity.account.displayName, me.displayName);
  assert.equal(identity.platformAdmin, false);
  assert.deepEqual(identity.memberships, []);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/api/agent-admin/v1/auth/csrf', '/api/agent-admin/v1/auth/login'],
  );
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    username: 'synthetic_admin',
    password: 'synthetic-password',
  });
  assert.equal(new Headers(calls[1].init?.headers).get('X-CSRF-TOKEN'), 'synthetic-agent');
  await client.me();
  await client.logout();
  assert.deepEqual(
    calls.slice(2).map((c) => c.path),
    ['/api/agent-admin/v1/auth/me', '/api/agent-admin/v1/auth/csrf', '/api/agent-admin/v1/auth/logout'],
  );
});

test('普通客户身份或缺少第四端角色的响应不能通过第四端会话校验', async () => {
  for (const value of [
    { ...me, roles: ['MEMBER'] },
    { ...me, roles: [] },
    { ...me, accountId: 'invalid' },
    { account: {}, platformAdmin: true, memberships: [] },
  ]) {
    const client = createAgentIdentityClient(async () => Response.json(value));
    await assert.rejects(
      client.me(),
      (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
});
