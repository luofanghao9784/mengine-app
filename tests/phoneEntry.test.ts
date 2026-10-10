import test from 'node:test';
import assert from 'node:assert/strict';
import { entryTenant } from '../src/identity/entry.ts';
import { createIdentityClient, isIdentity } from '../src/identity/client.ts';
const memberships = [
  { tenantId: 'one', tenantName: '一', role: 'MEMBER' as const },
  { tenantId: 'two', tenantName: '二', role: 'MEMBER' as const },
];
test('enterprise entry prefers explicit destinations, then valid remembered choice, then the only membership', () => {
  assert.equal(entryTenant('revoked', memberships, 'one'), 'revoked');
  assert.equal(entryTenant(null, memberships, 'two'), 'two');
  assert.equal(entryTenant(null, memberships, 'revoked'), '');
  assert.equal(entryTenant(null, memberships.slice(0, 1), null), 'one');
  assert.equal(entryTenant(null, [], null), '');
});
test('phone identities require a normalized usable contact and do not invent membership', () => {
  const identity = {
    account: {
      id: '00000000-0000-4000-8000-000000000001',
      phone: '+8619900000001',
      email: null,
      displayName: '合成',
    },
    platformAdmin: false,
    memberships: [],
  };
  assert.equal(isIdentity(identity), true);
  assert.equal(isIdentity({ ...identity, account: { ...identity.account, phone: null } }), false);
  assert.equal(isIdentity({ ...identity, account: { ...identity.account, phone: '19900000001' } }), false);
});
test('normal login submits phone while legacy email migration stays explicit', async () => {
  const bodies: unknown[] = [];
  const client = createIdentityClient(async (path, init) => {
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' }));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        account: {
          id: '00000000-0000-4000-8000-000000000001',
          phone: '+8619900000001',
          email: null,
          displayName: '合成',
        },
        platformAdmin: false,
        memberships: [],
      }),
    );
  });
  await client.login('19900000001', '123456');
  await client.legacyLogin('legacy@example.test', '123456');
  assert.deepEqual(bodies, [
    { phone: '19900000001', password: '123456' },
    { email: 'legacy@example.test', password: '123456' },
  ]);
});

test('surface choice remains available when browser storage is denied', async () => {
  const { requestSurfaceChoice, pendingSurfaceChoice, clearSurfaceChoice } =
    await import('../src/identity/surface-choice.ts');
  clearSurfaceChoice();
  assert.equal(pendingSurfaceChoice(), false);
  requestSurfaceChoice();
  assert.equal(pendingSurfaceChoice(), true);
  clearSurfaceChoice();
  assert.equal(pendingSurfaceChoice(), false);
});
