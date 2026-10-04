import test from 'node:test';
import assert from 'node:assert/strict';
import { packMagazineTiles } from '../src/briefingGrid.ts';

test('generation placeholders and the more entry fill earlier available cells', () => {
  const result = packMagazineTiles(
    [
      { id: 'chart', size: '2×2', fixed: true },
      { id: 'wide', size: '2×1', fixed: true },
      { id: 'batch', size: '1×1', fixed: true },
      { id: 'more', size: '1×1', fixed: true },
    ],
    3,
  );
  assert.deepEqual(
    result.map(({ id, row, col }) => [id, row, col]),
    [
      ['chart', 0, 0],
      ['batch', 0, 2],
      ['more', 1, 2],
      ['wide', 2, 0],
    ],
  );
});

test('automatic measured cards narrow into gaps without losing their content height', () => {
  for (const columns of [1, 2, 3, 4, 5]) {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      size: '2×2' as const,
      rows: (i % 3) + 2,
    }));
    const before = structuredClone(cards);
    const result = packMagazineTiles(cards, columns);
    const occupied = new Set<number>();
    for (const tile of result) {
      assert.ok(tile.height >= cards[Number(tile.id)].rows);
      for (let y = 0; y < tile.height; y++)
        for (let x = 0; x < tile.width; x++) {
          const cell = (tile.row + y) * columns + tile.col + x;
          assert.ok(!occupied.has(cell));
          occupied.add(cell);
        }
    }
    const lastStart = Math.max(...result.map((p) => p.row * columns + p.col));
    for (let cell = 0; cell <= lastStart; cell++) assert.ok(occupied.has(cell), `gap at ${columns}:${cell}`);
    assert.deepEqual(cards, before);
  }
});
