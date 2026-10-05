import type { CardSize } from './briefing';

export const magazineGap = 10;
export function magazineGridMetrics(width: number) {
  const columns = width >= 1210 ? 5 : width >= 966 ? 4 : width >= 722 ? 3 : width >= 478 ? 2 : 1;
  return { columns, unit: (width - (columns - 1) * magazineGap) / columns };
}
export type MagazineTile = { id: string; size: CardSize; fixed?: boolean; rows?: number; atEnd?: boolean };
export type MagazinePlacement = MagazineTile & { row: number; col: number; width: number; height: number };

/** Same first-free-cell packing as the Demo: later cards may fill a gap, never mutate preferences. */
export function packMagazineTiles(tiles: MagazineTile[], columns: number): MagazinePlacement[] {
  const pending = tiles.filter((tile) => !tile.atEnd).map((tile) => ({
    ...tile,
    size: (columns === 1 ? `1×${tile.size[2]}` : tile.size) as CardSize,
  }));
  const occupied = new Set<number>(),
    placed: MagazinePlacement[] = [];
  let cursor = 0;
  const fits = (tile: MagazineTile, size: CardSize) => {
    const w = Number(size[0]),
      h = Math.max(Number(size[2]), tile.rows || 0);
    return (
      (cursor % columns) + w <= columns &&
      Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => !occupied.has(cursor + y * columns + x)),
      )
        .flat()
        .every(Boolean)
    );
  };
  while (pending.length) {
    if (occupied.has(cursor)) {
      cursor++;
      continue;
    }
    let index = pending.findIndex((tile) => fits(tile, tile.size));
    let size: CardSize | undefined = pending[index]?.size;
    if (index < 0)
      index = pending.findIndex((tile) => {
        if (tile.fixed) return false;
        size = ([`1×${tile.size[2]}`, `${tile.size[0]}×1`, '1×1'] as CardSize[]).find((s) => fits(tile, s));
        return !!size;
      });
    if (index < 0 || !size) {
      cursor++;
      continue;
    }
    const [tile] = pending.splice(index, 1);
    const width = Number(size[0]),
      height = Math.max(Number(size[2]), tile.rows || 0);
    placed.push({ ...tile, size, row: Math.floor(cursor / columns), col: cursor % columns, width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) occupied.add(cursor + y * columns + x);
    cursor++;
  }
  // Controls at the end never fill earlier gaps, even below tall content cards.
  let endRow = Math.max(0, ...placed.map((tile) => tile.row + tile.height));
  for (const tile of tiles.filter((tile) => tile.atEnd)) {
    const width = Math.min(columns, Number(tile.size[0]));
    const height = Math.max(Number(tile.size[2]), tile.rows || 0);
    placed.push({ ...tile, size: `${width}×${tile.size[2]}` as CardSize, row: endRow, col: 0, width, height });
    endRow += height;
  }
  return placed;
}
