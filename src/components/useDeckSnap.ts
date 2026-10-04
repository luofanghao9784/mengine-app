import { useEffect, type RefObject } from 'react';
import { hasNestedScroll } from '../shared/gesture-routing';
import { deckSnapTarget, type DeckSnapRange } from '../conversation/deck-snap';

/** User scrolling settles into one card's open, half-open or folded position.
 * Programmatic reveal, resizing and reordering do not arm snapping. */
export function useDeckSnap(
  scroller: RefObject<HTMLDivElement | null>,
  layoutKey: string,
  enabled: boolean,
  ranges: RefObject<DeckSnapRange[]>,
) {
  useEffect(() => {
    const deck = scroller.current;
    if (!deck || !enabled) return;
    const root = deck.parentElement!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let idle = 0,
      frame = 0,
      armed = false,
      held = false;
    let direction = 0,
      velocity = 0,
      travel = 0,
      lastInput = 0;
    let touch: { x: number; y: number; lastX: number } | undefined;
    const stopAnimation = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete deck.dataset.snapping;
    };
    const cancel = () => {
      clearTimeout(idle);
      armed = held = false;
      touch = undefined;
      stopAnimation();
    };
    const blocked = (target: Element | null) =>
      matchMedia('(max-width: 1000px)').matches ||
      deck.hasAttribute('data-reordering') ||
      !!root.querySelector('.live-reader-fullscreen') ||
      !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
      !!target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [data-anchored-popover]',
      ) ||
      (!!target && hasNestedScroll(target, deck, 'x'));
    const settle = () => {
      if (!armed || held || blocked(null)) return;
      if (deck.hasAttribute('data-elastic-edge')) {
        idle = window.setTimeout(settle, 80);
        return;
      }
      const from = deck.scrollLeft;
      const range = ranges.current.find(({ start, end }) => from > start + 1 && from < end - 1);
      armed = false;
      if (!range) return;
      const target = deckSnapTarget(range, from, direction, velocity >= 0.7 && travel >= 48);
      if (Math.abs(from - target) < 1) return;
      if (reduced.matches) {
        deck.scrollTo({ left: target, behavior: 'instant' });
        return;
      }
      const started = performance.now();
      deck.dataset.snapping = 'true';
      const animate = (now: number) => {
        const progress = Math.min(1, (now - started) / 220);
        deck.scrollTo({ left: from + (target - from) * (1 - (1 - progress) ** 3), behavior: 'instant' });
        if (progress < 1) frame = requestAnimationFrame(animate);
        else stopAnimation();
      };
      frame = requestAnimationFrame(animate);
    };
    const schedule = () => {
      clearTimeout(idle);
      if (armed && !held && !frame) idle = window.setTimeout(settle, 160);
    };
    const input = (delta: number) => {
      stopAnimation();
      const now = performance.now();
      if (!armed || now - lastInput > 180 || Math.sign(delta) !== direction) travel = 0;
      velocity = Math.abs(delta) / Math.max(16, lastInput && armed ? now - lastInput : 80);
      travel += Math.abs(delta);
      direction = Math.sign(delta);
      lastInput = now;
      armed = true;
      schedule();
    };
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (
        !target ||
        blocked(target) ||
        !delta ||
        (!event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY))
      )
        return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? deck.clientWidth : 1;
      input(delta * unit);
    };
    const touchStart = (event: TouchEvent) => {
      cancel();
      if (event.touches.length !== 1 || blocked(event.target instanceof Element ? event.target : null))
        return;
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, lastX: point.clientX };
      held = true;
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      if (Math.abs(point.clientX - touch.x) > Math.abs(point.clientY - touch.y)) {
        input(touch.lastX - point.clientX);
        touch.lastX = point.clientX;
      }
    };
    const touchEnd = () => {
      held = false;
      touch = undefined;
      schedule();
    };
    const mutation = new MutationObserver(() => {
      if (deck.hasAttribute('data-reordering')) cancel();
    });
    mutation.observe(deck, { attributes: true, attributeFilter: ['data-reordering'] });
    root.addEventListener('wheel', wheel, { passive: true, capture: true });
    root.addEventListener('touchstart', touchStart, { passive: true });
    root.addEventListener('touchmove', touchMove, { passive: true });
    root.addEventListener('touchend', touchEnd);
    root.addEventListener('touchcancel', cancel);
    root.addEventListener('pointerdown', cancel, true);
    root.addEventListener('keydown', cancel, true);
    root.addEventListener('click', cancel, true);
    deck.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      cancel();
      mutation.disconnect();
      root.removeEventListener('wheel', wheel, true);
      root.removeEventListener('touchstart', touchStart);
      root.removeEventListener('touchmove', touchMove);
      root.removeEventListener('touchend', touchEnd);
      root.removeEventListener('touchcancel', cancel);
      root.removeEventListener('pointerdown', cancel, true);
      root.removeEventListener('keydown', cancel, true);
      root.removeEventListener('click', cancel, true);
      deck.removeEventListener('scroll', schedule);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [scroller, layoutKey, enabled, ranges]);
}
