import assert from 'node:assert/strict';
import test from 'node:test';
import { deckFoldFade, deckSnapTarget, deckMagneticDelta } from '../src/conversation/deck-snap.ts';
const range = { id: 'card', start: 100, end: 400 };
test('more than two thirds open settles fully open; the middle remains half open', () => {
  assert.equal(deckSnapTarget(range, 199), 100);
  assert.equal(deckSnapTarget(range, 201), 250);
  assert.equal(deckSnapTarget(range, 337), 250);
});
test('last fifth of closing snaps fully folded', () => {
  assert.equal(deckSnapTarget(range, 339), 250);
  assert.equal(deckSnapTarget(range, 340), 400);
  assert.equal(deckSnapTarget(range, 399), 400);
});
test('fast movement advances one adjacent detent in its direction', () => {
  assert.equal(deckSnapTarget(range, 145, 1, true), 250);
  assert.equal(deckSnapTarget(range, 265, 1, true), 400);
  assert.equal(deckSnapTarget(range, 355, -1, true), 250);
  assert.equal(deckSnapTarget(range, 235, -1, true), 100);
});
test('invalid and out-of-range bounds remain finite and bounded', () => {
  assert.equal(deckSnapTarget(range, -100), 100);
  assert.equal(deckSnapTarget(range, 900), 400);
  assert.equal(deckSnapTarget({ id: 'zero', start: 100, end: 100 }, 150), 100);
});
test('blur starts after 60 percent coverage and grows continuously to complete folding', () => {
  assert.equal(deckFoldFade(0.35), 0);
  assert.equal(deckFoldFade(0.5), 0);
  assert.equal(deckFoldFade(0.6), 0);
  assert.ok(deckFoldFade(0.61) > 0);
  assert.ok(deckFoldFade(0.7) > deckFoldFade(0.61));
  assert.ok(deckFoldFade(0.99) < 1);
  assert.equal(deckFoldFade(1), 1);
  assert.equal(deckFoldFade(-1), 0);
  assert.equal(deckFoldFade(2), 1);
});

test('endpoint resistance is mild, directional and does not affect middle travel', () => {
  assert.equal(deckMagneticDelta([range], 200, 30), 30);
  assert.equal(deckMagneticDelta([range], 350, 20), 15);
  assert.equal(deckMagneticDelta([range], 140, -20), -15);
  assert.equal(deckMagneticDelta([range], 350, -20), -20);
  assert.equal(deckMagneticDelta([], 200, 30), 30);
});
