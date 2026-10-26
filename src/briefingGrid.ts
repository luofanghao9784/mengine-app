import type { CardSize } from './briefing';

export const magazineGap = 10;
/** Narrowest unit the card designs are laid out for (two columns at 478px). */
export const magazineDesignUnit = 234;
export function magazineGridMetrics(width: number, minimumColumns = 1) {
  const columns = Math.max(
    minimumColumns,
    width >= 1210 ? 5 : width >= 966 ? 4 : width >= 722 ? 3 : width >= 478 ? 2 : 1,
  );
  return { columns, unit: (width - (columns - 1) * magazineGap) / columns };
}
/** 手机上的画报保持两列网格：格子比设计尺寸小时，卡片内容按比例缩小，而不是把卡片拉长。 */
export const magazineZoom = (unit: number) => Math.min(1, unit / magazineDesignUnit);
export type MagazineTile = { id: string; size: CardSize; fixed?: boolean; alternativeSize?: CardSize; rows?: number; atEnd?: boolean };
export type MagazinePlacement = MagazineTile & { row: number; col: number; width: number; height: number };

/** Same first-free-cell packing as the Demo: later cards may fill a gap, never mutate preferences. */
export function packMagazineTiles(tiles: MagazineTile[], columns: number, compact = false): MagazinePlacement[] {
  const pending = tiles.filter((tile) => !tile.atEnd).map((tile) => ({
    ...tile,
    size: (columns === 1 ? `1×${tile.size[2]}` : tile.size) as CardSize,
  }));
  // Place tall blocks first so small cards can fill their adjacent cells. Sizes stay unchanged.
  if (compact) pending.sort((a, b) => Number(b.size[2]) - Number(a.size[2]) || Number(b.size[0]) - Number(a.size[0]));
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
    if (index < 0 && compact)
      index = pending.findIndex((tile) => {
        if (!tile.alternativeSize || !fits(tile, tile.alternativeSize)) return false;
        size = tile.alternativeSize;
        return true;
      });
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
  // Append after the rightmost occupied cell of the final row, never in earlier gaps.
  cursor = placed.reduce((end, tile) => Math.max(end, (tile.row + tile.height - 1) * columns + tile.col + tile.width), 0);
  for (const tile of tiles.filter((tile) => tile.atEnd)) {
    const width = Math.min(columns, Number(tile.size[0]));
    const size = `${width}×${tile.size[2]}` as CardSize;
    const height = Math.max(Number(tile.size[2]), tile.rows || 0);
    while (!fits(tile, size)) cursor++;
    placed.push({ ...tile, size, row: Math.floor(cursor / columns), col: cursor % columns, width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) occupied.add(cursor + y * columns + x);
    cursor += (height - 1) * columns + width;
  }
  return placed;
}

export type MagazineFiller = { id: string; row: number; col: number; width: number; height: number };

/**
 * 网格中间不留空格：先把相邻的普通卡片撑大填进去（仍是四种标准尺寸之一），
 * 实在没有可撑大的卡片时，才放一张占位卡片。末尾最后一行之后的空位不算中间空档。
 */
export function fillMagazineGaps(
  placed: MagazinePlacement[],
  columns: number,
  locked: (tile: MagazinePlacement) => boolean = () => false,
): { placements: MagazinePlacement[]; fillers: MagazineFiller[] } {
  const tiles = placed.map((tile) => ({ ...tile }));
  const fillers: MagazineFiller[] = [];
  const growable = (tile: MagazinePlacement) => !tile.atEnd && !locked(tile);
  const resize = (tile: MagazinePlacement, width: number, height: number) => {
    tile.width = width;
    tile.height = height;
    tile.size = `${width}×${height}` as CardSize;
  };
  for (let guard = 0; guard < 200; guard++) {
    const owner = new Map<number, MagazinePlacement | MagazineFiller>();
    for (const tile of [...tiles, ...fillers])
      for (let y = 0; y < tile.height; y++)
        for (let x = 0; x < tile.width; x++) owner.set((tile.row + y) * columns + tile.col + x, tile);
    const last = Math.max(-1, ...owner.keys());
    let hole = -1;
    for (let index = 0; index < last; index++)
      if (!owner.has(index)) {
        hole = index;
        break;
      }
    if (hole < 0) break;
    const row = Math.floor(hole / columns),
      col = hole % columns;
    const at = (r: number, c: number) =>
      r >= 0 && c >= 0 && c < columns ? (owner.get(r * columns + c) as MagazinePlacement | undefined) : undefined;
    const free = (r: number, c: number) => c >= 0 && c < columns && r * columns + c <= last && !owner.has(r * columns + c);
    const isTile = (t: unknown): t is MagazinePlacement => !!t && tiles.includes(t as MagazinePlacement);
    const above = at(row - 1, col),
      left = at(row, col - 1),
      right = at(row, col + 1),
      below = at(row + 1, col);
    if (isTile(above) && growable(above) && above.col === col && above.width === 1 && above.height === 1 && above.row + 1 === row) {
      resize(above, 1, 2);
      continue;
    }
    const side = [left, right].find(
      (t): t is MagazinePlacement =>
        isTile(t) && growable(t) && t.row === row && t.width === 1 && (t.height === 1 || (t.height === 2 && free(row + 1, col))),
    );
    if (side) {
      if (side.col > col) side.col = col;
      resize(side, 2, side.height);
      continue;
    }
    if (isTile(below) && growable(below) && below.col === col && below.row === row + 1 && below.width === 1 && below.height === 1) {
      below.row = row;
      resize(below, 1, 2);
      continue;
    }
    const width = free(row, col + 1) ? 2 : 1;
    const height = free(row + 1, col) && (width === 1 || free(row + 1, col + 1)) ? 2 : 1;
    fillers.push({ id: `filler:${row}:${col}`, row, col, width, height });
  }
  return { placements: tiles, fillers };
}
