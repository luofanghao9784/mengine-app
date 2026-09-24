import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityClient, IdentityError } from '../src/identity/client.ts';

const id = '00000000-0000-4000-8000-000000000001';
const identity = {
  account: { id, email: 'synthetic@example.test', displayName: '合成' },
  platformAdmin: false,
  memberships: [{ tenantId: id, tenantName: '合成企业', role: 'MEMBER' }],
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('writes get a fresh CSRF token and use same-origin cookies without retrying mutations', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    return String(path).endsWith('csrf')
      ? json({ token: 'test-csrf', headerName: 'X-CSRF-TOKEN' })
      : json(identity);
  };
  const client = createIdentityClient(fetcher);
  await client.login('synthetic@example.test', 'synthetic-password-only');
  await client.login('synthetic@example.test', 'synthetic-password-only');
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/api/v1/auth/csrf', '/api/v1/auth/login', '/api/v1/auth/csrf', '/api/v1/auth/login'],
  );
  assert.equal(calls[1].init?.credentials, 'same-origin');
  assert.equal(calls[1].init?.redirect, 'error');
  assert.equal(new Headers(calls[1].init?.headers).get('X-CSRF-TOKEN'), 'test-csrf');
  let writes = 0;
  const failing = createIdentityClient(async (path) => {
    if (String(path).endsWith('csrf')) return json({ token: 'test', headerName: 'X-CSRF-TOKEN' });
    writes++;
    throw new TypeError('secret upstream details');
  });
  await assert.rejects(
    failing.accept({ token: 'test' }),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT' && !e.message.includes('secret'),
  );
  assert.equal(writes, 1);
});

test('runtime validation rejects invented privileges, wrong tenant context and malformed identities', async () => {
  for (const value of [
    { ...identity, platformAdmin: 'true' },
    { ...identity, memberships: [{ tenantId: id, tenantName: '合成', role: 'PLATFORM_ADMIN' }] },
    {},
  ]) {
    await assert.rejects(
      createIdentityClient(async () => json(value)).me(),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
  const client = createIdentityClient(async () =>
    json({
      tenant: { id: id.replace(/1$/, '2'), name: '其他企业', status: 'ACTIVE' },
      role: 'MEMBER',
      workspaces: [],
    }),
  );
  await assert.rejects(
    client.context(id),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
});

test('anonymous, forbidden, unavailable and cancelled requests remain distinct without Demo fallback', async () => {
  for (const status of [401, 403, 503]) {
    const client = createIdentityClient(async () => json({ message: 'server secret' }, status));
    await assert.rejects(
      client.me(),
      (e) => e instanceof IdentityError && e.status === status && !e.message.includes('server secret'),
    );
  }
  const controller = new AbortController();
  controller.abort();
  const cancelled = createIdentityClient(async (_path, init) => {
    init?.signal?.throwIfAborted();
    return json(identity);
  });
  await assert.rejects(
    cancelled.me(controller.signal),
    (e) => e instanceof IdentityError && e.code === 'CANCELLED',
  );
});
