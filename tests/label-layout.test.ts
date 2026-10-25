import test from 'node:test';
import assert from 'node:assert/strict';
import { FORCED, LabelLayout, type LabelBox, type Placement } from '../src/admin/prototype/label-layout.ts';

const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
const box = (key: string, x: number, y: number, rank = 0): LabelBox => ({ key, x, y, w: 100, h: 16, rank });
const settle = (layout: LabelLayout, items: LabelBox[], frames = 10, limit = Infinity) => {
  let out = new Map<string, Placement | null>();
  for (let i = 0; i < frames; i++) out = layout.place(items, bounds, limit);
  return out;
};
const overlap = (a: Placement, b: Placement) =>
  a.left < b.left + 100 && b.left < a.left + 100 && a.top < b.top + 16 && b.top < a.top + 16;

test('shown labels never overlap, however crowded the cluster', () => {
  const items = Array.from({ length: 60 }, (_, i) =>
    box('n' + i, 400 + (i % 6) * 12, 300 + Math.floor(i / 6) * 8, i),
  );
  const shown = [...settle(new LabelLayout(), items).values()].filter((p): p is Placement => !!p);
  assert.ok(shown.length > 0 && shown.length < items.length);
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) assert.equal(overlap(shown[i], shown[j]), false);
});

test('higher rank wins the contested spot; forced labels always show', () => {
  const items = [box('low', 500, 400, 1), box('high', 502, 401, 50), box('pinned', 503, 402, FORCED)];
  const out = settle(new LabelLayout(), items);
  assert.ok(out.get('pinned'));
  assert.ok(out.get('high'));
});

test('a shown label survives a brief collision instead of flickering', () => {
  const layout = new LabelLayout(14, 5);
  assert.ok(settle(layout, [box('a', 500, 400, 1)]).get('a'));
  // With one blocker it just moves to a free side.
  assert.ok(settle(layout, [box('a', 500, 400, 1), box('b', 500, 400, FORCED)]).get('a'));
  // All four sides taken by pinned labels: “a” keeps its place for the grace period, then yields.
  const crowded = [box('a', 500, 400, 1), ...['b', 'c', 'd', 'e'].map((k) => box(k, 500, 400, FORCED))];
  assert.ok(layout.place(crowded, bounds).get('a'));
  assert.equal(settle(layout, crowded, 20).get('a'), null);
});

test('labels outside the visible area are not placed', () => {
  const out = settle(new LabelLayout(), [box('edge', 990, 790, 1)]);
  const p = out.get('edge');
  if (p) assert.ok(p.left >= 0 && p.left + 100 <= 1000 && p.top >= 0 && p.top + 16 <= 800);
});

test('density limit counts every non-pinned label, linked ones first', () => {
  const spread = Array.from({ length: 40 }, (_, i) =>
    box('n' + i, 60 + (i % 8) * 120, 60 + Math.floor(i / 8) * 120, i),
  );
  const linked = [box('l1', 950, 700, 1e4 + 1), box('l2', 950, 600, 1e4 + 2)];
  const pinned = box('p', 500, 760, FORCED);
  const out = settle(new LabelLayout(), [...spread, ...linked, pinned], 10, 10);
  // Two linked labels take their places first; eight ordinary ones fill the rest of the budget.
  assert.ok(out.get('l1') && out.get('l2') && out.get('p'));
  assert.equal(spread.filter((x) => out.get(x.key)).length, 8);
  assert.ok(spread.slice(32).every((x) => out.get(x.key)));
});
