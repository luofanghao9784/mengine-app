import { useLayoutEffect, type RefObject } from 'react';

/** Every card uses one column, so filling the earliest free row preserves priority order. */
export function usePackedRecommendations(ref: RefObject<HTMLDivElement | null>, identity: string) {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || !('ResizeObserver' in window)) return;
    const cards = Array.from(grid.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const pack = () => {
      const gap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
      for (const card of cards) {
        const span = Math.max(1, Math.ceil((card.getBoundingClientRect().height + gap) / (8 + gap)));
        const value = `span ${span}`;
        if (card.style.gridRowEnd !== value) card.style.gridRowEnd = value;
      }
      grid.dataset.packed = 'true';
    };
    const observer = new ResizeObserver(pack);
    for (const card of cards) observer.observe(card);
    pack();
    return () => {
      observer.disconnect();
      delete grid.dataset.packed;
      for (const card of cards) card.style.gridRowEnd = '';
    };
  }, [ref, identity]);
}
