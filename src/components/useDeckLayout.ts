import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { deckSpacing } from '../conversationDeck';
import { deckFoldFade, type DeckSnapRange } from '../conversation/deck-snap';

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
  const cardSnapRanges = useRef<DeckSnapRange[]>([]);
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
      const listExpanded = element.parentElement?.hasAttribute('data-list-expanded');
      const previousExtent = element.scrollWidth;
      const atEnd =
        element.scrollLeft > 0 && element.scrollLeft + element.clientWidth >= element.scrollWidth - 4;
      const mobile = matchMedia('(max-width: 1000px)').matches;
      const nextSize = { width: element.clientWidth, list: cards[0]?.offsetWidth || 240 };
      if (!mobile)
        setDeckSize((prior) =>
          prior.width === nextSize.width && prior.list === nextSize.list ? prior : nextSize,
        );
      const { gap, spine, padding } = deckSpacing;
      const conversationIndex = cards.findIndex((card) => card.dataset.deckId === 'conversation');
      const following = cards.length - conversationIndex - 1;
      element.style.setProperty(
        '--conversation-cap',
        `${Math.max(420, element.clientWidth - padding * 2 - spine - Math.max(0, conversationIndex - 1) * spine - (following ? 320 + gap + (following - 1) * spine : 0))}px`,
      );
      const total =
        cards.reduce((sum, card) => sum + card.offsetWidth, 0) + (cards.length - 1) * gap + padding * 2;
      // Keep the list at the rail's padding edge for the two-card conversation view.
      // Extra reader cards retain the existing whole-deck centering behavior.
      const inset =
        mobile || (cluster && cards.length === 2) ? 0 : Math.max(0, (element.clientWidth - total) / 2);
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
      if (atEnd && !mobile && !listExpanded && Math.abs(element.scrollWidth - previousExtent) > 1)
        element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
      // Reserve room for the list by moving the entire reader stack equally.
      // Equal translation preserves every companion's existing overlap.
      const root = element.parentElement!;
      const previousShift = parseFloat(root.style.getPropertyValue('--list-open-shift')) || 0;
      const list = cards.find((card) => card.dataset.deckId === 'list');
      const firstReader = cards.find((card) => card.dataset.deckId !== 'list');
      const shift =
        !mobile && listExpanded && list && firstReader
          ? Math.max(0, reflow.bounds(list).right + gap - reflow.bounds(firstReader).left + previousShift)
          : 0;
      root.style.setProperty('--list-open-shift', `${shift.toFixed(3)}px`);
      const nextFolds: Record<string, { covered: boolean; folded: boolean; clipped: boolean }> = {};
      const viewport = element.getBoundingClientRect();
      cardSnapRanges.current = [];
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
        const independentList =
          card.dataset.deckId === 'list' && element.parentElement?.hasAttribute('data-list-expanded');
        if (index !== cards.length - 1 && !mobile && !independentList) {
          const next = reflow.bounds(cards[index + 1]);
          const visibleSpine = spine;
          const overlap = Math.max(0, current.right - next.left);
          const coverage = Math.min(1, overlap / Math.max(1, current.width - visibleSpine));
          // Begin dissolving only above 60% coverage, tied directly to actual overlap.
          fade = deckFoldFade(coverage);
          const anchor = parseFloat(card.style.getPropertyValue('--stack-left')) || 0;
          const nextAnchor = parseFloat(cards[index + 1].style.getPropertyValue('--stack-left')) || 0;
          const remaining = Math.max(spine, nextAnchor - anchor);
          // Open at the natural gap; overlap begins one gap later.
          const start = cardScrollRanges.current[card.dataset.deckId!].to;
          const end = Math.min(
            element.scrollWidth - element.clientWidth,
            start + gap + current.width - remaining,
          );
          if (end > start + 12) cardSnapRanges.current.push({ id: card.dataset.deckId!, start, end });
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
      // Keep natural widths for scrolling/reopening, but a folded stack paints
      // only as far as its foreground card. Wider hidden readers must not leave
      // an empty base sticking out on the right.
      cards.forEach((card, index) => {
        let front = index;
        while (front < cards.length - 1 && nextFolds[cards[front].dataset.deckId!]?.folded) front++;
        const hiddenRight =
          !mobile && front > index
            ? Math.max(0, reflow.bounds(card).right - reflow.bounds(cards[front]).right + 1)
            : 0;
        card.style.setProperty('--fold-hidden-right', `${hiddenRight.toFixed(3)}px`);
        if (hiddenRight > 0) {
          const right = card.offsetWidth - hiddenRight;
          const height = card.offsetHeight;
          const radius = Math.min(
            parseFloat(getComputedStyle(card).borderTopRightRadius) || 24,
            right / 2,
            height / 2,
          );
          // Curve the visible right edge at the card's actual top/bottom, while
          // leaving room for the exposed spine's left, upper and lower shadows.
          const path = `M -40 -40 H ${right - radius} V 0 Q ${right} 0 ${right} ${radius} V ${height - radius} Q ${right} ${height} ${right - radius} ${height} V ${height + 40} H -40 Z`;
          card.style.setProperty('--fold-edge-clip', `path('${path}')`);
        } else card.style.removeProperty('--fold-edge-clip');
        card.toggleAttribute('data-fold-width-clipped', hiddenRight > 0);
      });
      setFolds((prior) => (JSON.stringify(prior) === JSON.stringify(nextFolds) ? prior : nextFolds));
      setCanScrollLeft(!mobile && element.scrollLeft > 1);
      setCanScrollRight(!mobile && element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
    };
    update();
    reflow.animate();
    element.addEventListener('scroll', update, { passive: true });
    // Changing the expanded card's sticky anchor can release its width cap.
    // Measure the resulting size on the next frame, outside observer delivery.
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(update);
    });
    observer.observe(element);
    cards.forEach((card) => observer.observe(card));
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
    };
  }, [layoutKey, cluster, reflow.animate, reflow.bounds]);
  return { deckSize, folds, cardScrollRanges, cardSnapRanges, canScrollLeft, canScrollRight };
}
