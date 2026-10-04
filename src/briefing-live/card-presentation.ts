import type { CardSize } from '../briefing';

/** Display geometry only; it never grants access to the referenced contents. */
export type CardPresentation = { size: CardSize; unit: number };
export function validCardPresentation(
  size: string | null | undefined,
  unit: number,
): CardPresentation | undefined {
  if (!size || !/^[12]×[12]$/.test(size) || !Number.isFinite(unit) || unit < 100 || unit > 1600) return;
  return { size: size as CardSize, unit };
}
export function captureCardPresentation(button: HTMLElement): CardPresentation | undefined {
  const tile = button.closest<HTMLElement>('.live-briefing-tile');
  const grid = tile?.closest<HTMLElement>('.live-magazine-grid');
  return validCardPresentation(
    tile?.dataset.size,
    grid ? parseFloat(getComputedStyle(grid).getPropertyValue('--briefing-unit')) : NaN,
  );
}
