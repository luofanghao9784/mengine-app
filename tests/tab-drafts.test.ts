import test from 'node:test';
import assert from 'node:assert/strict';
import { readTabDraft, writeTabDraft, removeTabDraft } from '../src/shared/tab-drafts.ts';

function storage() {
  const values = new Map<string, string>();
  let blocked = false;
  return {
    values,
    block: () => {
      blocked = true;
    },
    target: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (blocked) throw new Error('quota');
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    } as Storage,
  };
}
test('quota failure removes only the stale draft and reports that latest content is not persisted', () => {
  const { target, block, values } = storage();
  writeTabDraft('draft', { body: 'old', pending: { requestId: 'same-key' } }, target);
  target.setItem('unrelated', 'preserve');
  block();
  assert.equal(writeTabDraft('draft', { body: 'new' }, target), false);
  assert.equal(values.has('draft'), false);
  assert.equal(values.get('unrelated'), 'preserve');
});
test('completely denied storage and malformed data are reported without crashing', () => {
  const denied = new Proxy({} as Storage, {
    get: () => {
      throw new Error('denied');
    },
  });
  assert.deepEqual(readTabDraft('draft', denied), { unreadable: true });
  assert.equal(writeTabDraft('draft', {}, denied), false);
  assert.equal(removeTabDraft('draft', denied), false);
  const { target } = storage();
  target.setItem('draft', '{bad json');
  assert.deepEqual(readTabDraft('draft', target), { unreadable: true });
});
test('successful persistence retains exact pending payload and deletion clears it', () => {
  const { target } = storage();
  const draft = { body: 'new', pending: { requestId: 'unchanged', expectedRevision: 3 } };
  assert.equal(writeTabDraft('draft', draft, target), true);
  assert.deepEqual(readTabDraft('draft', target), { value: draft, unreadable: false });
  assert.equal(removeTabDraft('draft', target), true);
  assert.deepEqual(readTabDraft('draft', target), { value: undefined, unreadable: false });
});
