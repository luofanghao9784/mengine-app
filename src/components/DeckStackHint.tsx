import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Render outside the scrolling/stacking context so the next card cannot cover
// the title. Highlight the original surface without raising its stacking order.
export function DeckStackHint({
  scroller,
  layoutKey,
  enabled,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  layoutKey: string;
  enabled: boolean;
}) {
  const [hint, setHint] = useState<{ title: string; left: number; top: number } | null>(null);
  const label = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const rail = scroller.current;
    if (!rail || !enabled) return;
    let current: HTMLElement | null = null;
    const clear = () => {
      current?.removeAttribute('data-stack-highlight');
      current = null;
      setHint(null);
    };
    const show = (card: HTMLElement | null) => {
      if (matchMedia('(max-width: 1000px)').matches || rail.hasAttribute('data-reordering')) card = null;
      if (card === current) return;
      clear();
      if (!card) return;
      const box = card.getBoundingClientRect();
      current = card;
      card.setAttribute('data-stack-highlight', '');
      setHint({
        title: card.dataset.deckTitle || '',
        left: Math.max(rail.getBoundingClientRect().left, box.left) + 8,
        top: box.top - 8,
      });
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      const target = event.target instanceof Element ? event.target : null;
      show(target?.closest<HTMLElement>('[data-deck-id][data-needs-reveal]') || null);
    };
    const focus = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      show(
        target?.matches('.deck-fold-tab:focus-visible')
          ? target.closest<HTMLElement>('[data-deck-id][data-needs-reveal]')
          : null,
      );
    };
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerleave', clear);
    rail.addEventListener('pointerdown', clear, true);
    rail.addEventListener('focusin', focus);
    rail.addEventListener('focusout', clear);
    rail.addEventListener('scroll', clear, { passive: true });
    window.addEventListener('resize', clear);
    window.addEventListener('blur', clear);
    return () => {
      clear();
      rail.removeEventListener('pointermove', move);
      rail.removeEventListener('pointerleave', clear);
      rail.removeEventListener('pointerdown', clear, true);
      rail.removeEventListener('focusin', focus);
      rail.removeEventListener('focusout', clear);
      rail.removeEventListener('scroll', clear);
      window.removeEventListener('resize', clear);
      window.removeEventListener('blur', clear);
    };
  }, [scroller, layoutKey, enabled]);
  useLayoutEffect(() => {
    if (!hint || !label.current) return;
    const { width, height } = label.current.getBoundingClientRect();
    label.current.style.left = `${Math.max(16, Math.min(hint.left, innerWidth - width - 16))}px`;
    label.current.style.top = `${Math.max(8, hint.top - height)}px`;
  }, [hint]);
  return hint && enabled ? (
    <div ref={label} className="deck-stack-hint" role="tooltip" style={{ left: hint.left, top: hint.top }}>
      <span>{hint.title}</span>
    </div>
  ) : null;
}
