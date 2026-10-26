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

test('username-only accounts log in through the customer session without platform credentials', async () => {
  const bodies: unknown[] = [];
  const named = { ...identity, account: { id, email: null, phone: null, username: 'demo-user', displayName: '演示' } };
  const client = createIdentityClient(async (path, init) => {
    if (String(path).endsWith('csrf')) return json({ token: 'test', headerName: 'X-CSRF-TOKEN' });
    bodies.push(JSON.parse(String(init?.body)));
    return json(named);
  });
  assert.equal((await client.login('demo-user', 'synthetic-password')).account.username, 'demo-user');
  await client.login('19900001012', 'synthetic-password');
  assert.deepEqual(bodies, [{ username: 'demo-user', password: 'synthetic-password' }, { phone: '19900001012', password: 'synthetic-password' }]);
  await assert.rejects(createIdentityClient(async () => json({ ...named, account: { ...named.account, username: 'bad@alias' } })).me(),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH');
});

test('failures without a specific code explain what happened and what to do next', async () => {
  const fail = (fetcher: typeof fetch, timeout?: number) => createIdentityClient(fetcher, timeout).me();
  const reject = async (p: Promise<unknown>, code: string, text: string) =>
    assert.rejects(p, (e) => e instanceof IdentityError && e.code === code && e.message.includes(text));
  await reject(fail(async () => json({}, 503)), 'UNAVAILABLE', '可能正在维护或重启');
  await reject(fail(async () => json({}, 500)), 'UNAVAILABLE', '服务器处理时出错');
  await reject(fail(async () => json({}, 429)), 'UNAVAILABLE', '操作太频繁');
  await reject(
    fail(async () => {
      throw new TypeError('connection refused');
    }),
    'UNAVAILABLE',
    '无法连接到服务器',
  );
  await reject(
    fail(
      (_path, init) =>
        new Promise((_, no) => init?.signal?.addEventListener('abort', () => no(new DOMException('', 'AbortError')))),
      20,
    ),
    'UNAVAILABLE',
    '响应超时',
  );
  // A write that reached the network but got no answer may have happened: say so, never “please retry” alone.
  const uncertain = createIdentityClient(async (path) => {
    if (String(path).endsWith('csrf')) return json({ token: 'test', headerName: 'X-CSRF-TOKEN' });
    throw new TypeError('reset');
  });
  await reject(uncertain.accept({ token: 'test' }), 'UNCERTAIN_RESULT', '操作可能已经生效');
  // Codes the server does send keep their own messages.
  await reject(
    fail(async () => json({ contractVersion: '1.0', code: 'INVITATION_NOT_FOUND' }, 404)),
    'INVITATION_NOT_FOUND',
    '重新发送邀请',
  );
});
