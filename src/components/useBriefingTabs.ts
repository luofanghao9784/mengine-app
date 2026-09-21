import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';

type Options = {
  page: RefObject<HTMLDivElement | null>;
  index: number;
  count: number;
  blocked: boolean;
  onSelect: (index: number) => void;
};

// A wheel burst changes one tab; a pointer gesture must first commit to the
// horizontal axis. Vertical reading and the controls inside cards keep priority.
export function useBriefingTabs(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const motion = useRef<ViewTransition | null>(null);
  const fallback = useRef<Animation | null>(null);
  const generation = useRef(0);
  const requested = useRef<number | null>(null);
  const cancelMotion = useCallback(() => {
    generation.current++;
    motion.current?.skipTransition();
    motion.current = null;
    fallback.current?.cancel();
    fallback.current = null;
    requested.current = null;
    delete document.documentElement.dataset.briefingSlide;
  }, []);
  const select = useCallback(
    (index: number) => {
      const current = latest.current;
      if (
        current.blocked ||
        index < 0 ||
        index >= current.count ||
        index === (requested.current ?? current.index)
      )
        return;
      const direction = index > (requested.current ?? current.index) ? 'next' : 'previous';
      cancelMotion();
      const token = generation.current;
      requested.current = index;
      const update = () => {
        if (token !== generation.current || latest.current.blocked) return;
        flushSync(() => latest.current.onSelect(index));
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        update();
        requested.current = null;
        return;
      }
      if (document.startViewTransition) {
        // Snapshot the scroll viewport, not the long document: the departing view
        // retains its reading position while the new filters enter at the top.
        document.documentElement.dataset.briefingSlide = direction;
        const transition = document.startViewTransition(update);
        motion.current = transition;
        void transition.ready.catch(() => {});
        void transition.finished
          .finally(() => {
            if (motion.current !== transition) return;
            motion.current = null;
            requested.current = null;
            delete document.documentElement.dataset.briefingSlide;
          })
          .catch(() => {});
      } else {
        update();
        const panel = current.page.current?.querySelector('.briefing-panel');
        fallback.current =
          panel?.animate(
            [
              { transform: `translateX(${direction === 'next' ? 48 : -48}px)`, opacity: 0 },
              { transform: 'translateX(0)', opacity: 1 },
            ],
            { duration: 260, easing: 'cubic-bezier(.22,.68,0,1)' },
          ) || null;
        requested.current = null;
      }
    },
    [cancelMotion],
  );

  useEffect(() => {
    if (options.blocked) cancelMotion();
  }, [options.blocked, cancelMotion]);
  useEffect(() => {
    const root = options.page.current?.closest<HTMLElement>('.main-shell');
    if (!root) return;
    const excluded =
      'input, textarea, select, [contenteditable="true"], .draft-composer, .briefing-filters, .briefing-card-tools, .briefing-card-menu, .briefing-people, .briefing-resize-handle, [role="dialog"]';
    const allowed = (target: EventTarget | null) =>
      !latest.current.blocked &&
      !root.inert &&
      !document.querySelector('dialog[open], [data-anchored-popover]') &&
      target instanceof Element &&
      !target.closest(excluded);
    let wheelAt = 0;
    let wheelDistance = 0;
    let wheelUsed = false;
    let suppressClickUntil = 0;
    let pointer: { id: number; x: number; y: number; axis: 'pending' | 'horizontal' | 'vertical' } | null =
      null;
    const endPointer = () => {
      const previous = pointer;
      pointer = null;
      root.classList.remove('briefing-is-swiping');
      if (previous && root.hasPointerCapture(previous.id)) root.releasePointerCapture(previous.id);
    };
    const wheel = (event: WheelEvent) => {
      if (!allowed(event.target) || event.defaultPrevented || event.ctrlKey) return;
      const x = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!x || (!event.shiftKey && Math.abs(x) <= Math.abs(event.deltaY) * 1.25)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - wheelAt > 220) {
        wheelDistance = 0;
        wheelUsed = false;
      }
      wheelAt = now;
      if (wheelUsed) return;
      if (Math.sign(wheelDistance) !== Math.sign(x)) wheelDistance = 0;
      wheelDistance += x * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth : 1);
      if (Math.abs(wheelDistance) < 64) return;
      wheelUsed = true;
      select(latest.current.index + Math.sign(wheelDistance));
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) {
        endPointer();
        return;
      }
      if (event.button !== 0 || !allowed(event.target) || event.defaultPrevented) return;
      if (event.pointerType !== 'touch' && (event.target as Element).closest('.briefing-card-main')) return;
      const button = (event.target as Element).closest('button, a');
      if (button && !button.matches('.briefing-card-main, [role="tab"]')) return;
      if (!window.getSelection()?.isCollapsed) return;
      suppressClickUntil = 0;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: 'pending' };
    };
    const move = (event: PointerEvent) => {
      if (latest.current.blocked) {
        endPointer();
        return;
      }
      if (!pointer || pointer.id !== event.pointerId || pointer.axis === 'vertical') return;
      const x = event.clientX - pointer.x;
      const y = event.clientY - pointer.y;
      if (pointer.axis === 'pending') {
        if (Math.max(Math.abs(x), Math.abs(y)) < 10) return;
        if (Math.abs(y) >= Math.abs(x)) {
          pointer.axis = 'vertical';
          return;
        }
        if (Math.abs(x) < Math.abs(y) * 1.25) return;
        pointer.axis = 'horizontal';
        root.setPointerCapture(event.pointerId);
        root.classList.add('briefing-is-swiping');
        window.getSelection()?.removeAllRanges();
      }
      event.preventDefault();
      suppressClickUntil = performance.now() + 600;
    };
    const up = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const x = event.clientX - pointer.x;
      const committed =
        pointer.axis === 'horizontal' && Math.abs(x) >= Math.min(100, Math.max(56, root.clientWidth * 0.12));
      endPointer();
      if (committed) select(latest.current.index - Math.sign(x));
    };
    const cancelPointer = (event: PointerEvent) => {
      // Touch begins with implicit capture on the card. Losing that capture is
      // expected when the horizontal gesture transfers capture to the page.
      if (event.type === 'lostpointercapture' && event.target !== root) return;
      if (pointer?.id === event.pointerId) endPointer();
    };
    const click = (event: MouseEvent) => {
      if (event.detail && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const drag = (event: DragEvent) => {
      if (pointer) event.preventDefault();
    };
    const reset = () => {
      endPointer();
      cancelMotion();
    };
    root.addEventListener('wheel', wheel, { passive: false });
    root.addEventListener('pointerdown', down);
    root.addEventListener('click', click, true);
    root.addEventListener('dragstart', drag);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('lostpointercapture', cancelPointer);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    return () => {
      reset();
      root.removeEventListener('wheel', wheel);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('click', click, true);
      root.removeEventListener('dragstart', drag);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('lostpointercapture', cancelPointer);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
    };
  }, [options.page, select, cancelMotion]);
  return select;
}
