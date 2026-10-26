import test from 'node:test';
import assert from 'node:assert/strict';
import { fillMagazineGaps, magazineGridMetrics, magazineZoom, packMagazineTiles, type MagazinePlacement, type MagazineTile } from '../src/briefingGrid.ts';

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

test('phone briefing keeps two square columns and scales content instead of stretching cards', () => {
  for (const width of [320, 347, 477]) {
    const metrics = magazineGridMetrics(width, 2);
    assert.equal(metrics.columns, 2);
    assert.equal(metrics.unit * 2 + 10, width);
    assert.ok(magazineZoom(metrics.unit) < 1);
  }
  assert.equal(magazineGridMetrics(1440, 2).columns, 5);
  assert.equal(magazineZoom(magazineGridMetrics(478, 2).unit), 1);
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

test('generation control appends after the final row as cards append and columns change', () => {
  const control: MagazineTile = { id: 'generation:more', size: '1×1', fixed: true, atEnd: true };
  const content: MagazineTile[] = [
    { id: 'tall', size: '1×2', fixed: true, rows: 3 },
    { id: 'wide', size: '2×1', fixed: true },
    { id: 'chart', size: '2×2', fixed: true },
  ];
  for (const columns of [1,2,3,4,5]) for (const appended of [false,true]) {
    const tiles = [content[0], control, ...content.slice(1), ...(appended ? [{id:'new',size:'2×1' as const}] : [])];
    const placed = packMagazineTiles(tiles,columns);
    const tail = placed.find(tile=>tile.id===control.id)!;
    assert.equal(placed.at(-1)?.id, control.id);
    const end = Math.max(...placed.filter(tile=>tile.id!==control.id).map(tile=>(tile.row+tile.height-1)*columns+tile.col+tile.width));
    assert.equal(tail.row * columns + tail.col, end);
  }
  assert.equal(packMagazineTiles([control],3)[0].row,0);
});

test('generation control shares the last row and wraps only when its remaining width is insufficient', () => {
 const more: MagazineTile = {id:'more',size:'1×1',fixed:true,atEnd:true};
 assert.deepEqual(packMagazineTiles([{id:'wide',size:'2×1',fixed:true},more],3).map(p=>[p.row,p.col]),[[0,0],[0,2]]);
 assert.deepEqual(packMagazineTiles([{id:'wide',size:'2×1',fixed:true},{id:'small',size:'1×1'},more],3).at(-1)?.row,1);
 const tall=packMagazineTiles([{id:'tall',size:'1×2',fixed:true},more],3).at(-1)!;
 assert.deepEqual([tall.row,tall.col],[1,1]);
});

test('compact layout packs fixed large cards first and fills their sides without shrinking', () => {
  const cards: MagazineTile[] = [
    ...Array.from({length:7}, (_,i)=>({id:`small-${i}`,size:'1×1' as const,fixed:true})),
    {id:'chart',size:'2×2',fixed:true}, {id:'steps',size:'2×2',fixed:true},
  ];
  const result=packMagazineTiles(cards,4,true);
  const cells=new Set(result.flatMap(p=>Array.from({length:p.height},(_,y)=>Array.from({length:p.width},(_,x)=>(p.row+y)*4+p.col+x)).flat()));
  assert.equal(cells.size,15);
  assert.deepEqual([...cells].sort((a,b)=>a-b),Array.from({length:15},(_,i)=>i));
  for(const p of result) assert.equal(p.size,cards.find(c=>c.id===p.id)!.size);
});


test('compact odd-column packing uses an allowed portrait alternative without shrinking content area', () => {
  const cards: MagazineTile[] = [
    { id: 'chart-a', size: '2×2', fixed: true },
    { id: 'chart-b', size: '2×2', fixed: true },
    { id: 'portrait', size: '1×2', fixed: true },
    ...Array.from({length: 4}, (_, i): MagazineTile => ({id: `text-${i}`, size: '2×1', fixed: true, alternativeSize: '1×2'})),
  ];
  const before = structuredClone(cards);
  const result = packMagazineTiles(cards, 5, true);
  const occupied = new Set(result.flatMap(p => Array.from({length: p.height}, (_, y) =>
    Array.from({length: p.width}, (_, x) => (p.row + y) * 5 + p.col + x)).flat()));
  const lastStart = Math.max(...result.map(p => p.row * 5 + p.col));
  for (let i = 0; i <= lastStart; i++) assert.ok(occupied.has(i), `gap at ${i}`);
  assert.equal(occupied.size, 18);
  assert.equal(result.length, cards.length);
  assert.ok(result.some(p => p.id.startsWith('text') && p.size === '1×2'));
  for (const p of result) {
    const original = cards.find(c => c.id === p.id)!;
    assert.equal(p.width * p.height, Number(original.size[0]) * Number(original.size[2]));
    if (!original.alternativeSize) assert.equal(p.size, original.size);
  }
  assert.deepEqual(cards, before);
  assert.ok(packMagazineTiles(cards, 5, false).filter(p => p.id.startsWith('text')).every(p => p.size === '2×1'));
});

const holesIn = (placed: { row: number; col: number; width: number; height: number }[], columns: number) => {
  const cells = new Set<number>();
  for (const t of placed) for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) cells.add((t.row + y) * columns + t.col + x);
  const last = Math.max(...cells);
  return Array.from({ length: last }, (_, i) => i).filter((i) => !cells.has(i));
};

test('gaps in the middle are filled by growing a neighbour to a standard size first', () => {
  const at = (id: string, row: number, col: number, size: '1×1' | '1×2' | '2×1' | '2×2'): MagazinePlacement => ({
    id, size, row, col, width: Number(size[0]), height: Number(size[2]),
  });
  // 两列：左上 1×1，右侧 1×2，下一行开头是一张 2 宽卡片 → 左侧第二行空着。
  const placed = [at('a', 0, 0, '1×1'), at('b', 0, 1, '1×2'), at('c', 2, 0, '2×1')];
  const { placements, fillers } = fillMagazineGaps(placed, 2);
  assert.equal(fillers.length, 0);
  assert.deepEqual(holesIn(placements, 2), []);
  assert.equal(placements.find((t) => t.id === 'a')!.size, '1×2');
  for (const t of placements) assert.match(t.size, /^[12]×[12]$/);
});

test('when no neighbour may grow, a single placeholder fills the gap and nothing is duplicated', () => {
  const at = (id: string, row: number, col: number, size: '1×1' | '1×2' | '2×1' | '2×2'): MagazinePlacement => ({
    id, size, row, col, width: Number(size[0]), height: Number(size[2]),
  });
  const placed = [at('a', 0, 0, '1×1'), at('b', 0, 1, '1×1'), at('c', 1, 1, '1×1'), at('d', 2, 0, '2×2')];
  const { placements, fillers } = fillMagazineGaps(placed, 2, () => true);
  assert.equal(fillers.length, 1);
  assert.deepEqual(holesIn([...placements, ...fillers], 2), []);
  assert.equal(new Set(placements.map((t) => t.id)).size, placements.length);
  assert.deepEqual(placements.map((t) => t.size), placed.map((t) => t.size));
});

test('a trailing gap after the last card is not treated as a middle gap', () => {
  const placed = packMagazineTiles([{ id: 'a', size: '1×1' }], 3);
  const { placements, fillers } = fillMagazineGaps(placed, 3);
  assert.equal(fillers.length, 0);
  assert.deepEqual(placements, placed);
});
