import { useLayoutEffect, useRef, type RefObject } from 'react';

// A tap on an incomplete card reveals it before activating anything inside it.
// Track the pointer instead of relying on click.target: title dragging captures
// the pointer on the rail, and native touch scrolling cancels the pointer stream.
export function useDeckReveal(
  scroller: RefObject<HTMLDivElement | null>,
  layoutKey: string,
  enabled: boolean,
  onReveal: (id: string) => void,
) {
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  useLayoutEffect(() => {
    const rail = scroller.current;
    if (!rail || !enabled) return;
    let tap: { card: HTMLElement; pointer: number; x: number; y: number } | null = null;
    let suppressClick = false;
    const down = (event: PointerEvent) => {
      tap = null;
      suppressClick = false;
      if (!event.isPrimary || event.button !== 0 || matchMedia('(max-width: 1000px)').matches) return;
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>('[data-deck-id][data-needs-reveal]');
      if (!card || !rail.contains(card) || target?.closest('.deck-resizer')) return;
      tap = { card, pointer: event.pointerId, x: event.clientX, y: event.clientY };
      // Do not let a half-visible input/button steal focus (and scroll itself)
      // before the first tap has revealed the card.
      if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]'))
        event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (tap?.pointer === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= 6)
        tap = null;
    };
    const up = (event: PointerEvent) => {
      const current = tap;
      tap = null;
      if (
        !current ||
        current.pointer !== event.pointerId ||
        !rail.contains(current.card) ||
        rail.hasAttribute('data-reordering') ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 6
      )
        return;
      suppressClick = true;
      reveal.current(current.card.dataset.deckId!);
    };
    const cancel = () => {
      tap = null;
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      if (event.detail === 0) return; // Keyboard activation uses the expand button.
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    rail.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      rail.removeEventListener('click', click, true);
    };
  }, [scroller, layoutKey, enabled]);
}
