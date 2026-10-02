import { useLayoutEffect, useState, type RefObject } from 'react';
import type { CardSize } from '../briefing';
import type { BriefingFit } from '../briefingLayout';

// Measure the browser's actual wrapped text, including font fallback and zoom.
// These are display limits only; resizing never rewrites a card or user preference.
export function useBriefingCardFit(
  page: RefObject<HTMLDivElement | null>,
  key: string,
  columns: number,
  unit: number,
  selectors = { cards: '.briefing-grid .briefing-card', button: '.briefing-card-main' },
) {
  const [measured, setMeasured] = useState<{ key: string; limits: BriefingFit }>({ key, limits: {} });
  const limits = measured.key === key ? measured.limits : {};
  useLayoutEffect(() => {
    let active = true;
    const waiting = new WeakSet<Animation>();
    const cards = [...(page.current?.querySelectorAll<HTMLElement>(selectors.cards) || [])];
    const measure = () => {
      if (!active) return;
      const updates: BriefingFit = {};
      for (const card of cards) {
        if (card.classList.contains('is-resizing')) continue;
        const animations = card.getAnimations().filter((animation) => animation.playState === 'running');
        if (animations.length) {
          // Intermediate animated dimensions are not the capacity of either
          // selected size. Measuring them can leave a permanent false minimum.
          for (const animation of animations) {
            if (waiting.has(animation)) continue;
            waiting.add(animation);
            animation.finished.then(measure, () => {
              /* A later resize measures its own target. */
            });
          }
          continue;
        }
        const copy = card.querySelector<HTMLElement>('.magazine-copy');
        const magazine = card.querySelector<HTMLElement>('.briefing-magazine');
        const button = card.querySelector<HTMLElement>(selectors.button);
        if (!copy || !magazine || !button || !card.getBoundingClientRect().height) continue;
        const blocks = [...copy.children].filter((e) => getComputedStyle(e).display !== 'none');
        const copyHeight =
          blocks.reduce((sum, element) => {
            if (element.matches('.briefing-visual-chart')) {
              const period = element.querySelector('.briefing-chart-period');
              const svg = element.querySelector('svg');
              const chartHeight =
                svg && getComputedStyle(svg).display !== 'none'
                  ? Number(svg.getAttribute('data-min-height') || 60)
                  : 0;
              return sum + (period?.getBoundingClientRect().height || 0) + chartHeight + 5;
            }
            return sum + element.getBoundingClientRect().height;
          }, 0) +
          Math.max(0, blocks.length - 1) * parseFloat(getComputedStyle(copy).rowGap);
        const documents = card.querySelector('.magazine-documents');
        const mainHeight = Math.max(
          copyHeight,
          documents && getComputedStyle(documents).display !== 'none'
            ? documents.getBoundingClientRect().height
            : 0,
        );
        const padding = getComputedStyle(button);
        const inlinePhoto = magazine.matches('.magazine-reporting.magazine-with-photo') ? 100 : 0;
        const needed =
          mainHeight +
          inlinePhoto +
          parseFloat(padding.paddingTop) +
          parseFloat(padding.paddingBottom) +
          (card.querySelector('.magazine-eyebrow')?.getBoundingClientRect().height || 0) +
          (card.querySelector('.magazine-footer')?.getBoundingClientRect().height || 0) +
          (inlinePhoto ? 3 : 2) * parseFloat(getComputedStyle(magazine).rowGap) +
          2 +
          (card.querySelector<HTMLElement>('.live-briefing-controls')?.offsetHeight || 0);
        if (needed <= card.getBoundingClientRect().height + 1) continue;
        const id = card.dataset.cardId!;
        const size = card.dataset.size as CardSize;
        const width = Number(size[0]),
          height = Number(size[2]);
        // Try a wider short card first: extra vertical area should be earned by
        // media or a chart, not introduced just to fit another line of text.
        const wider = columns > 1 && width === 1;
        // Prefer the four standard sizes. Exceptionally long custom titles may
        // use extra whole grid rows after the largest standard size is exhausted.
        const next: CardSize = wider ? `2×${height as 1 | 2}` : `${width as 1 | 2}×2`;
        updates[id] = {
          size: next,
          ...(next === size ? { rows: Math.ceil((needed + 10) / (unit + 10)) } : {}),
        };
      }
      if (Object.keys(updates).length)
        setMeasured((previous) => {
          const before = previous.key === key ? previous.limits : {};
          const next = { ...before, ...updates };
          return JSON.stringify(before) === JSON.stringify(next) ? previous : { key, limits: next };
        });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const card of cards)
      for (const element of [
        card,
        ...card.querySelectorAll('.magazine-copy > *, .magazine-eyebrow, .magazine-footer'),
      ])
        observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  });
  return limits;
}
