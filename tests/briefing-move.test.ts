import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { syncBriefing, type CardSize } from '../src/briefing.ts';
import { layoutBriefingSpread, saveBriefingLayout, type Placement } from '../src/briefingLayout.ts';

function fixture() {
  const state = syncBriefing(createKongguSeed());
  const sizes: CardSize[] = ['2×2', '2×1', '1×1', '1×2', '1×1', '2×1', '1×1', '2×2'];
  return sizes.map((size, i) => {
    const card = structuredClone(state.briefing!.cards[i]);
    card.id = `card-${i}`;
    card.data.size = size;
    card.config = { title: card.data.title, size, compact: false };
    return { card, data: card.data, at: card.updatedAt };
  });
}
function check(layout: Placement[], columns: number) {
  const cells = new Set<string>();
  let previous = -1;
  for (const p of layout) {
    assert.ok(p.col >= 0 && p.row >= 0 && p.col + p.width <= columns);
    assert.ok(p.row * columns + p.col > previous, 'DOM follows visual order');
    previous = p.row * columns + p.col;
    for (let y = p.row; y < p.row + p.height; y++)
      for (let x = p.col; x < p.col + p.width; x++) {
        const key = `${y}/${x}`;
        assert.ok(!cells.has(key), 'cards never overlap');
        cells.add(key);
      }
  }
}
test('拖移优先落点，保留不冲突邻卡，连续移动和刷新重放一致，内容不变', () => {
  const entries = fixture(),
    before = structuredClone(entries);
  let layout = layoutBriefingSpread(entries, 5);
  for (const [id, row, col] of [
    ['card-1', 2, 2],
    ['card-2', 0, 4],
    ['card-4', 3, 4],
  ] as const) {
    const baseline = saveBriefingLayout(layout, 5);
    const anchor = { id, row, col };
    const oldSizes = new Map(layout.map((p) => [p.entry.card.id, p.size]));
    layout = layoutBriefingSpread(entries, 5, false, {}, anchor, baseline);
    check(layout, 5);
    assert.deepEqual(
      layout.find((p) => p.entry.card.id === id) && [
        layout.find((p) => p.entry.card.id === id)!.row,
        layout.find((p) => p.entry.card.id === id)!.col,
      ],
      [row, col],
    );
    assert.ok(layout.every((p) => oldSizes.get(p.entry.card.id) === p.size));
    assert.deepEqual(
      layoutBriefingSpread(
        entries,
        5,
        false,
        {},
        undefined,
        JSON.parse(JSON.stringify(saveBriefingLayout(layout, 5))),
      ),
      layout,
    );
  }
  assert.deepEqual(entries, before);
});
test('改列数按保存的阅读顺序适配，返回原列数恢复坐标，不持久化窄屏折算', () => {
  const entries = fixture();
  const initial = layoutBriefingSpread(entries, 5);
  const moved = layoutBriefingSpread(
    entries,
    5,
    false,
    {},
    { id: 'card-0', row: 2, col: 1 },
    saveBriefingLayout(initial, 5),
  );
  const saved = saveBriefingLayout(moved, 5),
    before = structuredClone(saved);
  for (const columns of [1, 2, 3, 4]) {
    const layout = layoutBriefingSpread(entries, columns, false, {}, undefined, saved);
    check(layout, columns);
    assert.deepEqual(
      layout.map((p) => p.entry.card.id),
      saved.order,
    );
  }
  assert.deepEqual(saved, before);
  assert.deepEqual(layoutBriefingSpread(entries, 5, false, {}, undefined, saved), moved);
});
test('保存布局不恢复隐藏或失权卡片，新卡加入不冲掉既有位置，缩放保留当前起点', () => {
  const entries = fixture();
  const initial = layoutBriefingSpread(entries, 5);
  const saved = saveBriefingLayout(initial, 5);
  const visible = entries.slice(1);
  const restored = layoutBriefingSpread(visible, 5, false, {}, undefined, saved);
  assert.equal(restored.length, visible.length);
  assert.ok(restored.every((p) => p.entry.card.id !== entries[0].card.id));
  const extra = structuredClone(entries[0]);
  extra.card.id = 'new-card';
  const added = layoutBriefingSpread([...entries, extra], 5, false, {}, undefined, saved);
  for (const original of initial) {
    const p = added.find((p) => p.entry.card.id === original.entry.card.id)!;
    assert.deepEqual([p.row, p.col], [original.row, original.col]);
  }
  const target = initial.find((p) => p.width === 1)!;
  const resized = layoutBriefingSpread(
    entries,
    5,
    false,
    { [target.entry.card.id]: '1×2' },
    { id: target.entry.card.id, row: target.row, col: target.col },
    saved,
  );
  check(resized, 5);
  const p = resized.find((p) => p.entry.card.id === target.entry.card.id)!;
  assert.deepEqual([p.row, p.col, p.size], [target.row, target.col, '1×2']);
});
test('混合规格在一至五列连续移动始终无重叠、无丢卡、无越界，自动卡不被移动手势缩小', () => {
  const entries = fixture();
  entries.forEach((e) => {
    e.card.config = undefined;
  });
  const before = structuredClone(entries);
  for (let columns = 1; columns <= 5; columns++) {
    let layout = layoutBriefingSpread(entries, columns);
    for (let i = 0; i < entries.length; i++) {
      const active = layout.find((p) => p.entry.card.id === entries[i].card.id)!;
      const saved = saveBriefingLayout(layout, columns);
      layout = layoutBriefingSpread(
        entries,
        columns,
        false,
        {},
        { id: active.entry.card.id, row: i % 4, col: i % (columns - active.width + 1) },
        saved,
      );
      check(layout, columns);
      assert.equal(layout.length, entries.length);
      for (const p of layout)
        assert.equal(p.size, saved.positions.find((a) => a.id === p.entry.card.id)!.size);
    }
  }
  assert.deepEqual(entries, before);
});
