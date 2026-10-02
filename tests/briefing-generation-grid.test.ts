import test from 'node:test';
import assert from 'node:assert/strict';
import { packMagazineTiles } from '../src/briefingGrid.ts';

test('generation slots append after the existing magazine layout without filling earlier holes', () => {
  const base = [
    { id: 'chart', size: '2×2' as const, fixed: true },
    { id: 'wide', size: '2×1' as const, fixed: true },
  ];
  const before = packMagazineTiles(base, 3);
  const pending = packMagazineTiles(
    [
      ...base,
      { id: 'batch', size: '1×1', fixed: true, append: true },
      { id: 'more', size: '1×1', fixed: true, append: true },
    ],
    3,
  );
  assert.deepEqual(pending.slice(0, before.length), before);
  assert.deepEqual(
    pending.map((p) => p.id),
    ['chart', 'wide', 'batch', 'more'],
  );
  assert.ok(
    pending[2].row * 3 + pending[2].col >
      Math.max(...before.map((p) => (p.row + p.height - 1) * 3 + p.col + p.width - 1)),
  );
});

test('generated content may grow without moving earlier cards and the generation entry stays last', () => {
  const base = [{ id: 'old', size: '2×2' as const, fixed: true }];
  for (const columns of [1, 2, 3, 4, 5]) {
    const before = packMagazineTiles(base, columns);
    const result = packMagazineTiles(
      [
        ...base,
        { id: 'batch', size: '2×2', fixed: true, append: true },
        { id: 'more', size: '1×1', fixed: true, append: true },
      ],
      columns,
    );
    assert.deepEqual(result[0], before[0]);
    assert.equal(result.at(-1)?.id, 'more');
    assert.equal(result.at(-1)?.size, '1×1');
  }
});
