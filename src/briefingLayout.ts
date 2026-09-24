import { cardConfig, localDate, type BriefingCard, type CardData, type CardSize } from './briefing.ts';
import { briefingPresentation } from './briefingPresentation.ts';
import { magazineType } from './briefingMagazine.ts';

export type BriefingEntry = { card: BriefingCard; data: CardData; at: string; conversationAt?: string };
export type BriefingView = '最新' | '关注' | '日期' | '会话' | '类型' | '空间';
// Compare local calendar dates as UTC day numbers, avoiding DST / elapsed-hour rounding.
export function relativeBriefingDay(day: string, today = localDate(new Date().toISOString())) {
  const days = (Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86_400_000;
  return ['', '昨天', '前天', '三天前', '四天前', '五天前'][days] || '';
}
export type BriefingGroup = { id: string; label: string; day?: string; entries: BriefingEntry[] };
export type Placement = {
  entry: BriefingEntry;
  size: CardSize;
  row: number;
  col: number;
  width: number;
  height: number;
};
export type BriefingLayoutAnchor = { id: string; row: number; col: number };
export type BriefingSavedLayout = {
  columns: number;
  order: string[];
  manual?: string[];
  positions: (BriefingLayoutAnchor & { size: CardSize; at?: string; conversationAt?: string })[];
};
export function saveBriefingLayout(
  placements: Placement[],
  columns: number,
  manual: string[] = [],
): BriefingSavedLayout {
  return {
    columns,
    order: placements.map((p) => p.entry.card.id),
    manual: [...new Set(manual)].filter((id) => placements.some((p) => p.entry.card.id === id)),
    positions: placements.map((p) => ({
      id: p.entry.card.id,
      row: p.row,
      col: p.col,
      size: p.size,
      at: p.entry.at,
      conversationAt: p.entry.conversationAt,
    })),
  };
}
const topic = (data: CardData) => {
  if (data.type === '活跃会话') return '活跃会话';
  if (['经营数据', '待办决策', '风险提醒'].includes(data.type)) return '经营与决策';
  if (['项目进展', '成果交付'].includes(data.type)) return '项目与成果';
  return '资讯与知识';
};

// A new reply belongs at the front of Latest, even if that day's layout was
// saved before. Shift the remaining arrangement as a block to retain its manual
// relationships. This projection does not overwrite the user's stored layout.
export function refreshConversationLayout(
  entries: BriefingEntry[],
  saved?: BriefingSavedLayout,
): BriefingSavedLayout | undefined {
  if (!saved) return saved;
  const fresh = entries
    .filter(
      (entry) =>
        entry.data.sourceKind === 'conversation' &&
        saved.positions.find((position) => position.id === entry.card.id)?.at !== entry.at,
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!fresh.length) return saved;
  const ids = new Set(fresh.map((entry) => entry.card.id));
  const head = saveBriefingLayout(layoutBriefingSpread(fresh, saved.columns), saved.columns);
  const rows = Math.max(...head.positions.map((position) => position.row + Number(position.size[2])));
  return {
    ...saved,
    order: [...head.order, ...saved.order.filter((id) => !ids.has(id))],
    positions: [
      ...head.positions,
      ...saved.positions
        .filter((position) => !ids.has(position.id))
        .map((position) => ({ ...position, row: position.row + rows })),
    ],
  };
}
const emphasis = (data: CardData) =>
  data.template === 'trend'
    ? 0
    : data.template === 'editorial'
      ? 1
      : data.type === '成果交付'
        ? 2
        : data.type === '项目进展'
          ? 3
          : 4;

// Groups retain date/topic boundaries and time priority. Packing can bring a later
// card into an earlier gap; the returned placements also define keyboard order.
export function groupBriefingEntries(
  entries: BriefingEntry[],
  view: BriefingView,
  closed = false,
  spaces: Record<string, string> = {},
) {
  if (view === '会话' && !closed) {
    const sorted = [...entries].sort((a, b) =>
      (b.conversationAt || '').localeCompare(a.conversationAt || ''),
    );
    return sorted.length ? [{ id: 'conversations', label: '最近回复', entries: sorted }] : [];
  }
  const chronological = closed || view === '最新' || view === '日期';
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
  const groups: BriefingGroup[] = [];
  for (const entry of sorted) {
    const id = chronological
      ? localDate(entry.at)
      : view === '类型'
        ? magazineType(entry.data)
        : view === '空间'
          ? entry.data.space
          : topic(entry.data);
    let group = groups.find((g) => g.id === id);
    if (!group) {
      group = {
        id,
        label: chronological ? id : view === '空间' ? spaces[id] || id : id,
        day: chronological ? id : undefined,
        entries: [],
      };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  if (!chronological)
    for (const group of groups)
      group.entries.sort((a, b) => emphasis(a.data) - emphasis(b.data) || b.at.localeCompare(a.at));
  return groups;
}

function preferredSize(entry: BriefingEntry, historical: boolean): CardSize {
  // Resizing changes the card's display preference, never the dated snapshot.
  if (historical) return entry.card.config?.size || entry.data.size;
  if (entry.card.config) return cardConfig(entry.card).size;
  const presentation = briefingPresentation(entry.data);
  if (presentation) return presentation.size || entry.data.size;
  // Presentation choices do not write data, timestamps or history.
  if (entry.data.type === '成果交付') return '2×1';
  if (entry.data.template === 'progress') return '1×1';
  return entry.data.size;
}

// Fill the first available cell with a matching card from this group. Prefer
// every card's chosen dimensions before adapting an automatic card to the gap.
export function layoutBriefingSpread(
  entries: BriefingEntry[],
  columns: number,
  historical = false,
  sizeOverrides: Record<string, CardSize> = {},
  anchor?: BriefingLayoutAnchor,
  saved?: BriefingSavedLayout,
  preserveOrder = false,
): Placement[] {
  const reflowing = !!saved && saved.columns !== columns;
  const retained = saved?.columns === columns ? saved.positions : [];
  const pending = entries.map((entry) => {
    const override = sizeOverrides[entry.card.id];
    const previous = retained.find((p) => p.id === entry.card.id);
    let preferred = override || (!entry.card.config && previous?.size) || preferredSize(entry, historical);
    // A narrow viewport changes only the rendered size, never the preference.
    if (columns === 1 && preferred.startsWith('2')) preferred = preferred === '2×2' ? '1×2' : '1×1';
    return { entry, preferred, fixed: !!override || historical || !!entry.card.config || !!previous };
  });
  if (saved) {
    const order = new Map(saved.order.map((id, index) => [id, index]));
    pending.sort(
      (a, b) => (order.get(a.entry.card.id) ?? Infinity) - (order.get(b.entry.card.id) ?? Infinity),
    );
  }
  const placements: Placement[] = [];
  const occupied = new Set<number>();
  const place = (entry: BriefingEntry, size: CardSize, row: number, col: number) => {
    const width = Number(size[0]),
      height = Number(size[2]);
    placements.push({ entry, size, row, col, width, height });
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) occupied.add((row + y) * columns + col + x);
  };
  const canPlace = (size: CardSize, row: number, col: number) => {
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      col + Number(size[0]) > columns
    )
      return false;
    for (let y = 0; y < Number(size[2]); y++)
      for (let x = 0; x < Number(size[0]); x++) if (occupied.has((row + y) * columns + col + x)) return false;
    return true;
  };
  // Reserve the resized card first. Only its neighbours take part in packing.
  // Anchors belong to one view and column count; ignore a stale / hidden anchor.
  const anchoredIndex = pending.findIndex(({ entry }) => entry.card.id === anchor?.id);
  if (anchor && anchoredIndex >= 0 && anchor.row >= 0 && anchor.col >= 0 && anchor.col < columns) {
    const [{ entry, preferred }] = pending.splice(anchoredIndex, 1);
    const size: CardSize =
      anchor.col + Number(preferred[0]) > columns ? `1×${preferred[2] as '1' | '2'}` : preferred;
    place(entry, size, anchor.row, anchor.col);
  }
  // Keep earlier manual work where it fits. Only cards displaced by the active
  // move/resize re-enter packing; hidden, removed and inaccessible IDs are ignored.
  for (const position of retained) {
    // While editing, reserve earlier deliberate placements; ordinary neighbours
    // may flow into nearby cells instead of sending a large displaced card to the end.
    if (anchor && !saved?.manual?.includes(position.id)) continue;
    const index = pending.findIndex((p) => p.entry.card.id === position.id);
    if (index < 0) continue;
    const item = pending[index];
    if (!canPlace(item.preferred, position.row, position.col)) continue;
    pending.splice(index, 1);
    place(item.entry, item.preferred, position.row, position.col);
  }
  let cursor = 0;
  const fits = (size: CardSize) => {
    const width = Number(size[0]),
      height = Number(size[2]);
    if ((cursor % columns) + width > columns) return false;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) if (occupied.has(cursor + y * columns + x)) return false;
    return true;
  };
  while (pending.length) {
    if (occupied.has(cursor)) {
      cursor++;
      continue;
    }
    // At another breakpoint, saved order is a fitting priority, not a reason
    // to leave holes. Repack within this group without overwriting its layout.
    const ordered = preserveOrder && !reflowing;
    let index = ordered
      ? fits(pending[0].preferred)
        ? 0
        : -1
      : pending.findIndex(({ preferred }) => fits(preferred));
    let size: CardSize | undefined = pending[index]?.preferred;
    if (index < 0 && !ordered) {
      // Only a display fallback: saved sizes, source facts and snapshots stay intact.
      index = pending.findIndex((item) => {
        if (item.fixed) return false;
        size = ([`1×${item.preferred[2]}`, `${item.preferred[0]}×1`, '1×1'] as CardSize[]).find(fits);
        return !!size;
      });
    }
    // Explicit sizes can make a cell impossible to fill; keep those choices.
    if (index < 0 || !size) {
      cursor++;
      continue;
    }
    const [{ entry }] = pending.splice(index, 1);
    place(entry, size, Math.floor(cursor / columns), cursor % columns);
    cursor++;
  }
  return placements.sort((a, b) => a.row - b.row || a.col - b.col);
}

// A small hysteresis band avoids oscillation when the pointer rests on a cell boundary.
export function resizeBriefingSize(
  initial: CardSize,
  previous: CardSize,
  dx: number,
  dy: number,
  pitch: number,
  columns: number,
): CardSize {
  const snap = (value: number, old: number) => (old === 1 ? (value >= 1.58 ? 2 : 1) : value <= 1.42 ? 1 : 2);
  const width = columns === 1 ? 1 : snap(Number(initial[0]) + dx / pitch, Number(previous[0]));
  const height = snap(Number(initial[2]) + dy / pitch, Number(previous[2]));
  return `${width}×${height}` as CardSize;
}

// Append one-cell piles after the visible cards, without filling earlier reading-order gaps.
export function hiddenPilePositions(placements: Placement[], columns: number, count: number) {
  const occupied = new Set<number>();
  for (const p of placements)
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) occupied.add((p.row + y) * columns + p.col + x);
  const last = placements.at(-1);
  let cursor = last ? last.row * columns + last.col + last.width : 0;
  return Array.from({ length: count }, () => {
    while (occupied.has(cursor)) cursor++;
    const position = { row: Math.floor(cursor / columns), col: cursor % columns };
    occupied.add(cursor++);
    return position;
  });
}

// Keep manual positioning until the set of conversations or a reply changes.
// Then reply order wins over saved coordinates, including on another breakpoint.
export function refreshConversationTabLayout(
  entries: BriefingEntry[],
  columns: number,
  saved?: BriefingSavedLayout,
): BriefingSavedLayout | undefined {
  if (!saved) return undefined;
  const current =
    saved.positions.length === entries.length &&
    entries.every((entry) =>
      saved.positions.some(
        (position) => position.id === entry.card.id && position.conversationAt === entry.conversationAt,
      ),
    );
  if (current) return saved;
  const ordered = [...entries].sort((a, b) => (b.conversationAt || '').localeCompare(a.conversationAt || ''));
  return saveBriefingLayout(
    layoutBriefingSpread(ordered, columns, false, {}, undefined, undefined, true),
    columns,
  );
}
