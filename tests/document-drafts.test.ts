import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDocumentDrafts } from '../src/documents/drafts.ts';
import type { Identity } from '../contracts/public-api/identity.ts';
function storage() {
  const value = Object.assign(
    Object.create({
      removeItem(key: string) {
        delete this[key];
      },
    }),
    {
      'dreamcore:document:owner:allowed:doc': 'allowed draft',
      'dreamcore:document:owner:revoked:doc': 'revoked draft',
      'dreamcore:document:other:allowed:doc': 'different account',
      'unrelated-preference': 'keep',
    },
  );
  return value as Storage;
}
test('fresh identity removes revoked tenant and previous account drafts before readers unmount', () => {
  const value = storage();
  reconcileDocumentDrafts(
    { account: { id: 'owner' }, memberships: [{ tenantId: 'allowed' }] } as Identity,
    value,
  );
  assert.deepEqual(Object.keys(value).sort(), [
    'dreamcore:document:owner:allowed:doc',
    'unrelated-preference',
  ]);
});
test('logout or confirmed session expiry clears document drafts without deleting other storage', () => {
  const value = storage();
  reconcileDocumentDrafts(null, value);
  assert.deepEqual(Object.keys(value), ['unrelated-preference']);
});

test('blocked browser storage does not break identity refresh or logout', () => {
  const denied = new Proxy({} as Storage, {
    ownKeys() {
      throw new Error('storage disabled');
    },
  });
  assert.doesNotThrow(() => reconcileDocumentDrafts(null, denied));
});
