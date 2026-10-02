import test from 'node:test';
import assert from 'node:assert/strict';
import { magazineGridMetrics, packMagazineTiles, type MagazineTile } from '../src/briefingGrid.ts';

test('Demo breakpoints preserve square units and a ten-pixel gutter', () => {
  for (const [width, columns] of [
    [375, 1],
    [477, 1],
    [478, 2],
    [721, 2],
    [722, 3],
    [965, 3],
    [966, 4],
    [1209, 4],
    [1210, 5],
    [1600, 5],
  ]) {
    const metrics = magazineGridMetrics(width);
    assert.equal(metrics.columns, columns);
    assert.equal(metrics.unit * columns + (columns - 1) * 10, width);
  }
});

test('later cards fill gaps before the next row; keyboard order follows visual order', () => {
  const result = packMagazineTiles(
    [
      { id: 'chart-a', size: '2×2' },
      { id: 'chart-b', size: '2×2' },
      { id: 'text-a', size: '1×1' },
      { id: 'text-b', size: '1×1' },
    ],
    3,
  );
  assert.deepEqual(
    result.map(({ id, row, col }) => [id, row, col]),
    [
      ['chart-a', 0, 0],
      ['text-a', 0, 2],
      ['text-b', 1, 2],
      ['chart-b', 2, 0],
    ],
  );
});

test('repeated narrow and wide reflows never overlap, lose cards, or rewrite preferences', () => {
  const cards: MagazineTile[] = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    size: (['2×2', '1×1', '2×1', '1×2'] as const)[i % 4],
  }));
  const before = structuredClone(cards);
  for (const columns of [5, 4, 3, 2, 1, 3, 5]) {
    const occupied = new Set<string>();
    const result = packMagazineTiles(cards, columns);
    assert.equal(new Set(result.map((c) => c.id)).size, cards.length);
    for (const card of result) {
      assert.ok(card.col + card.width <= columns);
      for (let y = card.row; y < card.row + card.height; y++)
        for (let x = card.col; x < card.col + card.width; x++) {
          assert.ok(!occupied.has(`${x}:${y}`), `overlap at ${x}:${y}`);
          occupied.add(`${x}:${y}`);
        }
    }
    // Free cells preceding a card must be incapable of holding that card.
    for (const card of result)
      for (let cell = 0; cell < card.row * columns + card.col; cell++) {
        const x = cell % columns,
          y = Math.floor(cell / columns);
        if (x + card.width > columns) continue;
        assert.ok(
          Array.from({ length: card.height }, (_, dy) =>
            Array.from({ length: card.width }, (_, dx) => occupied.has(`${x + dx}:${y + dy}`)),
          )
            .flat()
            .some(Boolean),
        );
      }
  }
  assert.deepEqual(cards, before);
});

test('one-column display adapts saved wide cards and keeps measured full-title capacity', () => {
  const tiles: MagazineTile[] = [
    { id: 'wide', size: '2×1', fixed: true },
    { id: 'long-title', size: '2×2', fixed: true, rows: 3 },
  ];
  const result = packMagazineTiles(tiles, 1);
  assert.deepEqual(
    result.map((c) => [c.width, c.height, c.row]),
    [
      [1, 1, 0],
      [1, 3, 1],
    ],
  );
  assert.equal(tiles[0].size, '2×1');
});
