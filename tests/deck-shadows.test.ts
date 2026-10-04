import assert from 'node:assert/strict';
import test from 'node:test';
import { mutedDeckShadowIds } from '../src/conversation/deck-shadows.ts';

const card = (id: string, left: number, right: number, order: number) => ({ id, left, right, order });
test('four folded cards retain only the back and front shadows', () => {
  assert.deepEqual(
    [
      ...mutedDeckShadowIds([
        card('a', 0, 400, 0),
        card('b', 12, 412, 1),
        card('c', 24, 424, 2),
        card('d', 36, 436, 3),
      ]),
    ],
    ['b', 'c'],
  );
});
test('separate stacks have independent two-layer limits; standalone cards keep shadows', () => {
  assert.deepEqual(
    [
      ...mutedDeckShadowIds([
        card('a', 0, 100, 0),
        card('b', 12, 112, 1),
        card('c', 24, 124, 2),
        card('solo', 150, 250, 3),
        card('d', 300, 400, 4),
        card('e', 312, 412, 5),
        card('f', 324, 424, 6),
      ]),
    ],
    ['b', 'e'],
  );
});
test('scrolling cards apart restores all individual shadows', () => {
  assert.equal(
    mutedDeckShadowIds([card('a', 0, 100, 0), card('b', 108, 208, 1), card('c', 216, 316, 2)]).size,
    0,
  );
});
test('nested bounds and reordered cards use layer order, not input order', () => {
  assert.deepEqual(
    [...mutedDeckShadowIds([card('front', 12, 112, 9), card('middle', 24, 100, 4), card('back', 0, 400, 2)])],
    ['middle'],
  );
});
test('hidden cards and edge contact do not create overlap groups', () => {
  assert.equal(
    mutedDeckShadowIds([
      card('hidden', 0, 0, 0),
      card('a', 0, 100, 1),
      card('b', 100, 200, 2),
      card('c', 200, 300, 3),
    ]).size,
    0,
  );
});
