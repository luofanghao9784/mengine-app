import { useLayoutEffect, type RefObject } from 'react';
import { deckSpacing } from '../conversationDeck';

// Keep elasticity in painted offsets: widths, sticky anchors, scroll range and
// folding semantics stay unchanged. The list is the fixed end of the spring.
export function useDeckElasticScroll(
  scroller: RefObject<HTMLDivElement | null>,
  layoutKey: string,
  enabled: boolean,
  bounds: (card: HTMLElement) => DOMRect,
) {
  useLayoutEffect(() => {
    const deck = scroller.current;
    if (!deck || !enabled) return;
    const root = deck.closest('.conversation-overlay')!;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let side = 0;
    let level = 0;
    let extent = 0;
    let frame = 0;
    let idle = 0;
    let offsets: { card: HTMLElement; distance: number }[] = [];
    let wheelGesture: {
      at: number;
      direction: number;
      last: number;
      peak: number;
      falling: number;
      momentum: boolean;
    } | null = null;
    let touch: {
      x: number;
      startX: number;
      startY: number;
      axis: string;
      manual: boolean;
    } | null = null;
    const reset = () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      frame = idle = side = level = 0;
      offsets.forEach(({ card }) => card.style.removeProperty('--deck-elastic-x'));
      offsets = [];
      delete deck.dataset.elasticEdge;
    };
    const paint = (value: number) => {
      level = value;
      offsets.forEach(({ card, distance }) => {
        card.style.setProperty('--deck-elastic-x', `${(-side * distance * value).toFixed(3)}px`);
      });
    };
    const release = () => {
      clearTimeout(idle);
      if (!side || frame) return;
      const from = level;
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        if (elapsed >= 500) {
          reset();
          return;
        }
        // A damped return with only a very small overshoot, not repeated bouncing.
        paint(from * Math.exp(-elapsed / 100) * Math.cos(elapsed / 110));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    const pull = (delta: number, max: number, releaseAfterPause: boolean) => {
      if (preference.matches) return;
      const nextSide = Math.sign(delta);
      if (nextSide !== side) {
        reset();
        side = nextSide;
        extent = max;
        const cards = Array.from(deck.querySelectorAll<HTMLElement>('[data-deck-id]'));
        const boxes = cards.map(bounds);
        let distance = 0;
        offsets = cards.map((card, index) => {
          if (index) {
            const prior = boxes[index - 1];
            const gap = boxes[index].left - prior.right;
            // Keep a visible hit area even at maximum elastic compression.
            distance +=
              side < 0
                ? 8
                : gap >= 0
                  ? Math.min(6, gap)
                  : Math.min(6, Math.max(0, boxes[index].left - prior.left - deckSpacing.minElasticSpine));
          }
          return { card, distance };
        });
        if (distance > 32) offsets.forEach((entry) => (entry.distance *= 32 / distance));
        deck.dataset.elasticEdge = side > 0 ? 'compressed' : 'expanded';
      }
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(idle);
      // Further travel has diminishing effect, and a resumed gesture continues
      // from the spring's current position instead of jumping to its old peak.
      paint(Math.min(0.97, 1 - (1 - Math.max(0, level)) * Math.exp(-Math.abs(delta) / 100)));
      if (releaseAfterPause) idle = window.setTimeout(release, 48);
    };
    const maxScroll = () => (side ? extent : Math.max(0, deck.scrollWidth - deck.clientWidth));
    const move = (delta: number, releaseAfterPause = true, allowPull = true) => {
      const max = maxScroll();
      const before = Math.max(0, Math.min(max, deck.scrollLeft));
      const after = Math.max(0, Math.min(max, before + delta));
      if (after !== before) deck.scrollTo({ left: after, behavior: 'instant' });
      const excess = delta - (after - before);
      if (allowPull && Math.abs(excess) > 0.5) pull(excess, max, releaseAfterPause);
      else release();
    };
    const isWheelMomentum = (event: WheelEvent, delta: number) => {
      // Prefer the platform's physical/inertial distinction when exposed.
      const native = (event as WheelEvent & { momentum?: boolean }).momentum;
      if (typeof native === 'boolean' || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        wheelGesture = null;
        return native === true;
      }
      // Older browsers only expose deltas. Several decaying samples indicate a
      // likely inertial tail; a pause, reversal or renewed push starts a gesture.
      const at = performance.now();
      const direction = Math.sign(delta);
      const size = Math.abs(delta);
      const previous = wheelGesture;
      if (
        !previous ||
        at - previous.at > 140 ||
        direction !== previous.direction ||
        (previous.momentum && size > previous.last * 1.5 && size - previous.last >= 3)
      ) {
        wheelGesture = { at, direction, last: size, peak: size, falling: 0, momentum: false };
        return false;
      }
      if (size < previous.last - 0.1) previous.falling++;
      else if (size > previous.last + 0.1) previous.falling = 0;
      previous.peak = Math.max(previous.peak, size);
      previous.momentum ||= previous.falling >= 3 && size <= previous.peak * 0.6;
      previous.at = at;
      previous.last = size;
      // This latch outlives the visual spring: residual events must not reopen it.
      return previous.momentum;
    };
    const blocked = (target: Element | null) =>
      matchMedia('(max-width: 1000px)').matches ||
      deck.hasAttribute('data-reordering') ||
      !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
      !!target?.closest('[role="listbox"], [role="menu"], [data-anchored-popover]');
    const nestedScroll = (target: Element | null, delta: number) => {
      for (let node = target; node && node !== deck && root.contains(node); node = node.parentElement) {
        if (
          node.scrollWidth <= node.clientWidth + 1 ||
          !/(auto|scroll)/.test(getComputedStyle(node).overflowX)
        )
          continue;
        if (delta < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
          return true;
      }
      return false;
    };
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.ctrlKey || blocked(target)) return;
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!delta || nestedScroll(target, delta)) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? deck.clientWidth
            : 1;
      event.preventDefault();
      // Inertia still scrolls inside the deck, but cannot hold/cancel its rebound.
      move(delta * unit, true, !isWheelMomentum(event, delta * unit));
    };
    const touchStart = (event: TouchEvent) => {
      touch = null;
      wheelGesture = null;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.touches.length !== 1 ||
        blocked(target) ||
        !target ||
        !root.contains(target) ||
        target.closest(
          '[data-deck-draggable], .deck-resizer, button, a, input, textarea, select, [contenteditable="true"]',
        )
      ) {
        release();
        return;
      }
      const point = event.touches[0];
      touch = {
        x: point.clientX,
        startX: point.clientX,
        startY: point.clientY,
        axis: '',
        manual: false,
      };
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      const dx = point.clientX - touch.startX;
      const dy = point.clientY - touch.startY;
      if (!touch.axis) {
        if (Math.hypot(dx, dy) < 6) return;
        touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (nestedScroll(event.target as Element, -dx)) touch.axis = 'nested';
      }
      const delta = touch.x - point.clientX;
      touch.x = point.clientX;
      if (touch.axis !== 'x' || !delta || blocked(event.target as Element)) return;
      const max = maxScroll();
      const atEdge = delta < 0 ? deck.scrollLeft <= 1 : deck.scrollLeft >= max - 1;
      if (touch.manual || (atEdge && event.cancelable)) {
        // Take over only after reaching an edge. Interior swipes retain native
        // touch scrolling and momentum, as does all vertical reading.
        if (event.cancelable) event.preventDefault();
        touch.manual = true;
        move(delta, false);
      } else if (atEdge) pull(delta, max, false);
      else release();
    };
    const touchEnd = () => {
      touch = null;
      release();
    };
    const interrupt = () => {
      touch = null;
      wheelGesture = null;
      reset();
    };
    const pointerDown = (event: PointerEvent) => {
      if (
        (event.target as Element)?.closest(
          '[data-deck-draggable], [data-needs-reveal], .deck-resizer, button, a, input, textarea, select',
        )
      )
        interrupt();
    };
    const keyDown = () => interrupt();
    const scroll = () => {
      if (side && (side > 0 ? deck.scrollLeft < extent - 1 : deck.scrollLeft > 1)) release();
    };
    // Clear stale measurements when card widths change, including the resizer.
    const observer = new ResizeObserver(interrupt);
    observer.observe(deck);
    deck.querySelectorAll('[data-deck-id]').forEach((card) => observer.observe(card));
    document.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('touchstart', touchStart, { passive: true });
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
    document.addEventListener('touchcancel', touchEnd);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('keydown', keyDown, true);
    deck.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', interrupt);
    window.addEventListener('blur', interrupt);
    preference.addEventListener('change', interrupt);
    return () => {
      interrupt();
      observer.disconnect();
      document.removeEventListener('wheel', wheel);
      document.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
      document.removeEventListener('touchcancel', touchEnd);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('keydown', keyDown, true);
      deck.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', interrupt);
      window.removeEventListener('blur', interrupt);
      preference.removeEventListener('change', interrupt);
    };
  }, [scroller, layoutKey, enabled, bounds]);
}
