import { hasNestedScroll, wheelGestureAxis } from '../shared/gesture-routing';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';

type Options = {
  page: RefObject<HTMLElement | null>;
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
      if (document.startViewTransition && !current.page.current?.classList.contains('live-briefing')) {
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
      } else if (current.page.current?.classList.contains('live-briefing')) {
        // Live cards own their vertical, staggered entrance after data is ready.
        // Moving the whole page sideways would stack a second motion on top.
        update();
        requested.current = null;
      } else {
        update();
        const panel = current.page.current?.querySelector('.briefing-panel') || current.page.current;
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
    const root = options.page.current?.closest<HTMLElement>('.main-shell, .access-main');
    if (!root) return;
    const excluded =
      'input, textarea, select, [contenteditable="true"], .draft-composer, .workspace-composer, .live-briefing-filters, .live-briefing-rail, .briefing-generation button, .platform-pagination, .briefing-filters, .briefing-card-tools, .briefing-card-menu, .briefing-people, .briefing-resize-handle, [role="dialog"]';
    const allowed = (target: EventTarget | null) =>
      !latest.current.blocked &&
      !root.inert &&
      !root.closest('[inert]') &&
      !document.querySelector('dialog[open], [data-anchored-popover]') &&
      target instanceof Element &&
      root.contains(target) &&
      !target.closest(excluded) &&
      !hasNestedScroll(target, root, 'x');
    const wheelAxis = wheelGestureAxis();
    let wheelAt = 0;
    let wheelDistance = 0;
    let wheelUsed = false;
    let suppressClickUntil = 0;
    let pointer: {
      kind: 'pointer' | 'touch';
      id: number;
      x: number;
      y: number;
      axis: 'pending' | 'horizontal' | 'vertical';
    } | null = null;
    const endPointer = () => {
      const previous = pointer;
      pointer = null;
      root.classList.remove('briefing-is-swiping');
      if (previous?.kind === 'pointer' && root.hasPointerCapture(previous.id))
        root.releasePointerCapture(previous.id);
    };
    const wheel = (event: WheelEvent) => {
      const axis = wheelAxis(event);
      if (!allowed(event.target) || event.defaultPrevented || axis !== 'x') return;
      const x = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!x) return;
      event.preventDefault();
      const now = performance.now();
      if (now - wheelAt > 240) {
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
      if (event.pointerType === 'touch') return;
      if (!event.isPrimary) {
        endPointer();
        return;
      }
      if (event.button !== 0 || !allowed(event.target) || event.defaultPrevented) return;
      if (
        event.pointerType !== 'touch' &&
        (event.target as Element).closest('.briefing-card-main, .live-briefing-body')
      )
        return;
      const button = (event.target as Element).closest('button, a');
      if (button && !button.matches('.briefing-card-main, .live-briefing-body, [role="tab"]')) return;
      if (!window.getSelection()?.isCollapsed) return;
      suppressClickUntil = 0;
      pointer = { kind: 'pointer', id: event.pointerId, x: event.clientX, y: event.clientY, axis: 'pending' };
    };
    const movePoint = (clientX: number, clientY: number, event: Event) => {
      if (latest.current.blocked) {
        endPointer();
        return;
      }
      if (!pointer || pointer.axis === 'vertical') return;
      const x = clientX - pointer.x;
      const y = clientY - pointer.y;
      if (pointer.axis === 'pending') {
        if (Math.max(Math.abs(x), Math.abs(y)) < 10) return;
        if (Math.abs(y) >= Math.abs(x)) {
          pointer.axis = 'vertical';
          return;
        }
        if (Math.abs(x) < Math.abs(y) * 1.25) return;
        pointer.axis = 'horizontal';
        if (pointer.kind === 'pointer') root.setPointerCapture(pointer.id);
        root.classList.add('briefing-is-swiping');
        window.getSelection()?.removeAllRanges();
      }
      event.preventDefault();
      suppressClickUntil = performance.now() + 600;
    };
    const endPoint = (clientX: number) => {
      if (!pointer) return;
      const x = clientX - pointer.x;
      const committed =
        pointer.axis === 'horizontal' && Math.abs(x) >= Math.min(100, Math.max(56, root.clientWidth * 0.12));
      endPointer();
      if (committed) select(latest.current.index - Math.sign(x));
    };
    const move = (event: PointerEvent) => {
      if (pointer?.kind === 'pointer' && pointer.id === event.pointerId)
        movePoint(event.clientX, event.clientY, event);
    };
    const up = (event: PointerEvent) => {
      if (pointer?.kind === 'pointer' && pointer.id === event.pointerId) endPoint(event.clientX);
    };
    const touchStart = (event: TouchEvent) => {
      endPointer();
      if (event.touches.length !== 1 || !allowed(event.target)) return;
      const button = (event.target as Element).closest('button, a');
      if (button && !button.matches('.briefing-card-main, .live-briefing-body, [role="tab"]')) return;
      const point = event.touches[0];
      suppressClickUntil = 0;
      pointer = { kind: 'touch', id: point.identifier, x: point.clientX, y: point.clientY, axis: 'pending' };
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        endPointer();
        return;
      }
      const point = event.touches[0];
      if (pointer?.kind === 'touch' && pointer.id === point.identifier)
        movePoint(point.clientX, point.clientY, event);
    };
    const touchEnd = (event: TouchEvent) => {
      if (pointer?.kind !== 'touch') return;
      const point = [...event.changedTouches].find((point) => point.identifier === pointer?.id);
      if (point) endPoint(point.clientX);
    };
    const cancelPointer = (event: PointerEvent) => {
      // Touch begins with implicit capture on the card. Losing that capture is
      // expected when the horizontal gesture transfers capture to the page.
      if (event.type === 'lostpointercapture' && event.target !== root) return;
      if (pointer?.kind === 'pointer' && pointer.id === event.pointerId) endPointer();
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
    root.addEventListener('touchstart', touchStart, { passive: true });
    root.addEventListener('touchmove', touchMove, { passive: false });
    root.addEventListener('touchend', touchEnd);
    root.addEventListener('touchcancel', endPointer);
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
      root.removeEventListener('touchstart', touchStart);
      root.removeEventListener('touchmove', touchMove);
      root.removeEventListener('touchend', touchEnd);
      root.removeEventListener('touchcancel', endPointer);
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
