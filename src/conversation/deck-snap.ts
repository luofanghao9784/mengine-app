export type DeckSnapRange = { id: string; start: number; end: number };

/** Coverage is the fraction covered by the next card, excluding its exposed spine. */
export function deckFoldFade(coverage: number): number {
  const progress = Math.max(0, Math.min(1, (coverage - 0.6) / 0.4));
  return progress * progress * (3 - 2 * progress);
}

export function deckSnapTarget(range: DeckSnapRange, position: number, direction = 0, fast = false): number {
  if (range.end <= range.start) return range.start;
  const folded = Math.max(0, Math.min(1, (position - range.start) / (range.end - range.start)));
  if (fast && direction) {
    return direction > 0
      ? folded < 0.5
        ? (range.start + range.end) / 2
        : range.end
      : folded > 0.5
        ? (range.start + range.end) / 2
        : range.start;
  }
  if (folded <= 1 / 3) return range.start;
  if (folded >= 0.8) return range.end;
  return (range.start + range.end) / 2;
}

/** Mild resistance only in the last fifth near an open/folded endpoint. */
export function deckMagneticDelta(ranges: DeckSnapRange[], position: number, delta: number): number {
  let resisted = 0;
  for (const { start, end } of ranges) {
    const span = end - start;
    if (span <= 0) continue;
    const overlap =
      delta > 0
        ? Math.min(position + delta, end) - Math.max(position, start + span * 0.8)
        : Math.min(position, start + span * 0.2) - Math.max(position + delta, start);
    resisted += Math.max(0, overlap) * 0.25;
  }
  return delta - Math.sign(delta) * Math.min(Math.abs(delta) * 0.25, resisted);
}
