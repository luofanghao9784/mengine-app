import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationTabTarget } from '../src/admin/navigation-focus.ts';

const targets = ['close', 'overview', 'settings', 'logout'];

test('mobile navigation contains forward and backward keyboard focus', () => {
  assert.equal(navigationTabTarget(targets, 'logout', false), 'close');
  assert.equal(navigationTabTarget(targets, 'close', true), 'logout');
  assert.equal(navigationTabTarget(targets, 'overview', false), null);
  assert.equal(navigationTabTarget(targets, 'settings', true), null);
});

test('focus outside the navigation returns to its correct keyboard boundary', () => {
  assert.equal(navigationTabTarget(targets, 'page-action', false), 'close');
  assert.equal(navigationTabTarget(targets, null, true), 'logout');
});

test('a single available control stays focused and an empty navigation has no target', () => {
  assert.equal(navigationTabTarget(['close'], 'close', false), 'close');
  assert.equal(navigationTabTarget(['close'], 'close', true), 'close');
  assert.equal(navigationTabTarget([], null, false), null);
});
