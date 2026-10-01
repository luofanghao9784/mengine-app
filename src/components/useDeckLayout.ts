import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { deckSpacing } from '../conversationDeck';

/** The fixed 9POP demo's sticky stack geometry, independent of data and permissions. */
export function useDeckLayout(
  scroller: RefObject<HTMLDivElement | null>,
  center: RefObject<HTMLElement | null>,
  layoutKey: string,
  cluster: boolean,
  reflow: { animate: () => void; bounds: (card: HTMLElement) => DOMRect },
) {
  const [deckSize, setDeckSize] = useState({ width: innerWidth - 112, list: 240 });
  const [folds, setFolds] = useState<Record<string, { covered: boolean; folded: boolean; clipped: boolean }>>(
    {},
  );
  const cardScrollRanges = useRef<Record<string, { from: number; to: number }>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Each following card covers the previous one while leaving a clickable spine.
  // Keep natural scroll positions separate from sticky offsets, including after resizing.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const cards = Array.from(element.querySelectorAll<HTMLElement>('[data-deck-id]')).sort(
      (a, b) => Number(a.dataset.deckOrder) - Number(b.dataset.deckOrder),
    );
    const tail = element.querySelector<HTMLElement>('.deck-scroll-tail')!;
    const update = () => {
      const previousExtent = element.scrollWidth;
      const atEnd =
        element.scrollLeft > 0 && element.scrollLeft + element.clientWidth >= element.scrollWidth - 4;
      const mobile = matchMedia('(max-width: 1000px)').matches;
      const nextSize = { width: element.clientWidth, list: cards[0]?.offsetWidth || 240 };
      if (!mobile)
        setDeckSize((prior) =>
          prior.width === nextSize.width && prior.list === nextSize.list ? prior : nextSize,
        );
      const centerWidth = center.current?.offsetWidth || 560;
      const { gap, spine, padding } = deckSpacing;
      const conversationIndex = cards.findIndex((card) => card.dataset.deckId === 'conversation');
      const following = cards.length - conversationIndex - 1;
      element.style.setProperty(
        '--conversation-cap',
        `${Math.max(420, element.clientWidth - padding * 2 - spine - Math.max(0, conversationIndex - 1) * spine - (following ? 320 + gap + (following - 1) * spine : 0))}px`,
      );
      const total =
        cards.reduce((sum, card) => sum + card.offsetWidth, 0) + (cards.length - 1) * gap + padding * 2;
      // Center the whole deck so the list has the same gap as every other card.
      // A new chat still prioritizes centering the editor, with its list beside it.

      const inset = mobile
        ? 0
        : cluster && cards.length === 2
          ? Math.max(0, (element.clientWidth - centerWidth) / 2 - cards[0].offsetWidth - gap - padding)
          : Math.max(0, (element.clientWidth - total) / 2);
      cards.forEach((card, index) => {
        card.style.marginLeft = index === 0 && !mobile ? `${inset}px` : '0px';
      });
      let naturalLeft = padding;
      let lastAnchor: number = padding;
      cards.forEach((card, index) => {
        let anchor =
          index === 0
            ? padding
            : index === 1
              ? padding + spine
              : lastAnchor +
                (cards[index - 1].dataset.deckId === 'conversation'
                  ? center.current!.offsetWidth + gap
                  : spine);
        // An expanded reader may cover the preceding card to keep its body and
        // properties inside the viewport; the preceding spine remains reachable.
        if (card.dataset.widthExtension) {
          const desiredWidth = parseFloat(card.style.getPropertyValue('--card-width'));
          anchor = Math.min(
            anchor,
            Math.max(padding + index * spine, element.clientWidth - desiredWidth - padding),
          );
        }
        // Sticky offsets start at the rail's padding edge. Do not count that
        // padding twice, which would push the list into the first card's gap.
        card.style.setProperty('--stack-left', `${anchor - padding}px`);
        card.style.setProperty('--stack-order', String(index + 1));
        card.style.setProperty('--spine-width', `${spine}px`);
        if (index === 0) naturalLeft += inset;
        cardScrollRanges.current[card.dataset.deckId!] = {
          from: Math.max(0, naturalLeft + card.offsetWidth + padding - element.clientWidth),
          to: Math.max(0, naturalLeft - anchor),
        };
        naturalLeft += card.offsetWidth + gap;
        lastAnchor = anchor;
      });
      tail.style.width =
        mobile || total <= element.clientWidth
          ? '0px'
          : `${Math.max(0, element.clientWidth - (cards.at(-1)?.offsetWidth || 0) - lastAnchor - padding)}px`;
      // A new anchor can release width that was constrained by the previous viewport.
      // If the user reached the end, follow the new end instead of leaving the last file clipped.
      if (atEnd && !mobile && Math.abs(element.scrollWidth - previousExtent) > 1)
        element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
      const nextFolds: Record<string, { covered: boolean; folded: boolean; clipped: boolean }> = {};
      const viewport = element.getBoundingClientRect();
      cards.forEach((card, index) => {
        let fade = 0;
        const current = reflow.bounds(card);
        nextFolds[card.dataset.deckId!] = {
          covered: false,
          folded: false,
          clipped:
            !mobile &&
            (current.left < viewport.left - 1 || current.right > viewport.left + element.clientWidth + 1),
        };
        if (index !== cards.length - 1 && !mobile) {
          const next = reflow.bounds(cards[index + 1]);
          const visibleSpine = spine;
          const overlap = Math.max(0, current.right - next.left);
          const coverage = Math.min(1, overlap / Math.max(1, current.width - visibleSpine));
          // Remain sharp through the first half, then dissolve with the actual
          // overlap. Updating CSS directly keeps rapid reversals tied to scroll.
          const progress = Math.max(0, (coverage - 0.5) * 2);
          fade = progress * progress * (3 - 2 * progress);
          nextFolds[card.dataset.deckId!] = {
            ...nextFolds[card.dataset.deckId!],
            covered: next.left < current.right - 1,
            folded: next.left - current.left <= visibleSpine + 1,
          };
        }
        // Also clear reused cards when the last file closes or the viewport
        // switches to one-card navigation.
        card.toggleAttribute('data-folding', fade > 0);
        card.style.setProperty('--fold-blur', `${(fade * 8).toFixed(3)}px`);
        card.style.setProperty('--fold-opacity', (1 - fade).toFixed(4));
      });
      setFolds((prior) => (JSON.stringify(prior) === JSON.stringify(nextFolds) ? prior : nextFolds));
      setCanScrollLeft(!mobile && element.scrollLeft > 1);
      setCanScrollRight(!mobile && element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
    };
    update();
    reflow.animate();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    cards.forEach((card) => observer.observe(card));
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [layoutKey, cluster, reflow.animate, reflow.bounds]);
  return { deckSize, folds, cardScrollRanges, canScrollLeft, canScrollRight };
}
