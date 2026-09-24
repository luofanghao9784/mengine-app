import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'done';
type Options = {
  page: RefObject<HTMLDivElement | null>;
  ready: boolean;
  blocked: boolean;
  viewKey: string;
  onRefresh?: () => void;
};
const TRIGGER = 64;
const distanceFor = (raw: number) => 108 * (1 - Math.exp(-Math.max(0, raw) / 145));

// Entrance is independent of the transform used by layout reflow. It runs for
// the visible reading area; offscreen cards never wait behind a long queue.
function useBriefingArrival(page: RefObject<HTMLDivElement | null>, ready: boolean) {
  const [pending, setPending] = useState(true);
  const started = useRef(false);
  const animations = useRef<Animation[]>([]);
  const cancel = useCallback(() => {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    setPending(false);
  }, []);
  const play = useCallback(() => {
    cancel();
    const root = page.current;
    const scroller = root?.closest('main');
    if (!root || !scroller || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const viewport = scroller.getBoundingClientRect();
    const cards = [...root.querySelectorAll<HTMLElement>('.briefing-grid > .briefing-card')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    animations.current = cards.map(({ element }, index) => {
      const animation = element.animate(
        [
          { opacity: 0, translate: '0 12px', scale: '.988' },
          { opacity: 1, translate: '0 0', scale: '1' },
        ],
        {
          duration: 380,
          delay: Math.min(index * 46, 460),
          easing: 'cubic-bezier(.2,.65,.25,1)',
          fill: 'both',
        },
      );
      void animation.finished.then(() => animation.cancel()).catch(() => {});
      return animation;
    });
  }, [page, cancel]);
  useLayoutEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    play();
  }, [ready, play]);
  useEffect(() => {
    const root = page.current;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (preference.matches) cancel();
    };
    // Settle before a mouse reaches a small control, so canceling on press
    // cannot move that button out from under the subsequent pointerup.
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') cancel();
    };
    root?.addEventListener('pointerover', hover);
    root?.addEventListener('pointerdown', cancel, true);
    root?.addEventListener('focusin', cancel);
    preference.addEventListener('change', changed);
    return () => {
      root?.removeEventListener('pointerover', hover);
      root?.removeEventListener('pointerdown', cancel, true);
      root?.removeEventListener('focusin', cancel);
      preference.removeEventListener('change', changed);
      animations.current.forEach((animation) => animation.cancel());
    };
  }, [page, cancel]);
  return { pending, play, cancel };
}

export function useBriefingRefresh(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const arrival = useBriefingArrival(options.page, options.ready);
  const [state, setState] = useState<{ phase: Phase; distance: number }>({ phase: 'idle', distance: 0 });
  const stateRef = useRef(state);
  const [announcement, setAnnouncement] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const change = useCallback((phase: Phase, distance: number) => {
    stateRef.current = { phase, distance };
    setState(stateRef.current);
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    change('idle', 0);
    setAnnouncement('');
  }, [change]);
  const refresh = useCallback(() => {
    if (latest.current.blocked || ['refreshing', 'done'].includes(stateRef.current.phase)) return;
    arrival.cancel();
    const token = ++generation.current;
    change('refreshing', 54);
    setAnnouncement('正在演示刷新智能画报');
    const scroller = latest.current.page.current?.closest('main');
    scroller?.scrollTo({ top: 0, behavior: 'instant' });
    // This is explicitly a local interaction demo: no synthetic new business
    // records, timestamps or layout resets are written to the user's store.
    timers.current.push(
      setTimeout(() => {
        if (generation.current !== token) return;
        latest.current.onRefresh?.();
        change('done', 54);
        setAnnouncement('已刷新画报排列，内容与历史记录已保留');
        timers.current.push(
          setTimeout(() => {
            if (generation.current !== token) return;
            change('idle', 0);
            timers.current = [];
            arrival.play();
          }, 300),
        );
      }, 650),
    );
  }, [arrival.cancel, arrival.play, change]);
  const previousView = useRef(options.viewKey);
  useEffect(() => {
    if (options.blocked || previousView.current !== options.viewKey) {
      cancel();
      arrival.cancel();
      setAnnouncement('');
    }
    previousView.current = options.viewKey;
  }, [options.blocked, options.viewKey, cancel, arrival.cancel]);

  useEffect(() => {
    const root = options.page.current;
    const scroller = root?.closest('main');
    if (!root || !scroller) return;
    let gesture: { kind: 'mouse' | 'touch'; id: number; x: number; y: number; active: boolean } | null = null;
    let suppressClickUntil = 0;
    let wheelRaw = 0,
      wheelAt = 0,
      wheelEligible = false,
      wheelConsumed = false;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;
    const busy = () => latest.current.blocked || ['refreshing', 'done'].includes(stateRef.current.phase);
    const allowed = (target: EventTarget | null) =>
      !busy() &&
      scroller.scrollTop <= 0 &&
      !scroller.inert &&
      !scroller.closest('[inert]') &&
      !document.querySelector('dialog[open], [data-anchored-popover]') &&
      target instanceof Element &&
      !target.closest(
        'input, textarea, select, a, [contenteditable="true"], .briefing-card-tools, .briefing-card-menu, .briefing-resize-handle, .briefing-people, .briefing-filters, .briefing-hidden-pile, .draft-composer, [role="dialog"]',
      );
    const releaseCapture = () => {
      const old = gesture;
      gesture = null;
      if (old?.kind === 'mouse' && root.hasPointerCapture(old.id)) root.releasePointerCapture(old.id);
    };
    const reset = () => {
      releaseCapture();
      clearTimeout(wheelEnd);
      wheelRaw = 0;
      wheelEligible = false;
      cancel();
    };
    const release = () => {
      const active = gesture?.active;
      releaseCapture();
      if (!active) return;
      suppressClickUntil = performance.now() + 450;
      if (stateRef.current.distance >= TRIGGER) refresh();
      else change('idle', 0);
    };
    const drag = (x: number, y: number, event: Event) => {
      const g = gesture;
      if (!g) return;
      if (busy()) {
        releaseCapture();
        return;
      }
      const dx = x - g.x,
        dy = y - g.y;
      if (!g.active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (dy <= 0 || Math.abs(dx) >= dy * 0.8 || scroller.scrollTop > 0) {
          releaseCapture();
          return;
        }
        g.active = true;
        arrival.cancel();
        if (g.kind === 'mouse') root.setPointerCapture(g.id);
      }
      event.preventDefault();
      const distance = distanceFor(dy);
      change(distance >= TRIGGER ? 'ready' : 'pulling', distance);
      suppressClickUntil = performance.now() + 450;
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !e.isPrimary || !allowed(e.target)) return;
      if ((e.target as Element).closest('.briefing-card-main')) return;
      gesture = { kind: 'mouse', id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
    };
    const pointerMove = (e: PointerEvent) => {
      if (gesture?.kind === 'mouse' && gesture.id === e.pointerId) drag(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent) => {
      if (gesture?.kind === 'mouse' && gesture.id === e.pointerId) release();
    };
    const pointerCancel = (e: PointerEvent) => {
      if (gesture?.kind !== 'mouse' || gesture.id !== e.pointerId) return;
      if (e.type === 'lostpointercapture' && e.target !== root) return;
      reset();
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        if (gesture) reset();
        return;
      }
      if (!allowed(e.target)) return;
      const t = e.touches[0];
      gesture = { kind: 'touch', id: t.identifier, x: t.clientX, y: t.clientY, active: false };
    };
    const touchMove = (e: TouchEvent) => {
      if (gesture?.kind !== 'touch') return;
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const t = e.touches[0];
      if (t.identifier === gesture.id) drag(t.clientX, t.clientY, e);
    };
    const touchEnd = () => {
      if (gesture?.kind === 'touch') release();
    };
    const touchCancel = () => {
      if (gesture?.kind === 'touch') reset();
    };
    const wheel = (e: WheelEvent) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.shiftKey ||
        Math.abs(e.deltaX) >= Math.abs(e.deltaY) ||
        gesture
      )
        return;
      const now = performance.now();
      if (busy()) {
        wheelAt = now;
        wheelConsumed = true;
        wheelEligible = false;
        return;
      }
      if (now - wheelAt > 240) {
        wheelEligible = allowed(e.target);
        wheelRaw = 0;
        wheelConsumed = false;
      }
      wheelAt = now;
      // Momentum from a gesture begun below the top must not trigger a refresh.
      if (!wheelEligible || wheelConsumed || !allowed(e.target)) return;
      if (e.deltaY > 0 && wheelRaw === 0) {
        wheelEligible = false;
        return;
      }
      e.preventDefault();
      arrival.cancel();
      wheelRaw = Math.max(
        0,
        wheelRaw - e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1),
      );
      const distance = distanceFor(wheelRaw);
      change(distance >= TRIGGER ? 'ready' : 'pulling', distance);
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        wheelConsumed = true;
        if (stateRef.current.distance >= TRIGGER) refresh();
        else change('idle', 0);
      }, 180);
    };
    const click = (e: MouseEvent) => {
      if (e.detail && performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const dragStart = (e: DragEvent) => {
      if (gesture) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (gesture?.active || stateRef.current.phase !== 'idle')) {
        e.preventDefault();
        reset();
      }
    };
    const scroll = () => {
      if (scroller.scrollTop > 0 && ['pulling', 'ready'].includes(stateRef.current.phase)) reset();
    };
    root.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointermove', pointerMove, { passive: false });
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', pointerCancel);
    document.addEventListener('lostpointercapture', pointerCancel);
    root.addEventListener('touchstart', touchStart, { passive: true });
    root.addEventListener('touchmove', touchMove, { passive: false });
    root.addEventListener('touchend', touchEnd);
    root.addEventListener('touchcancel', touchCancel);
    scroller.addEventListener('wheel', wheel, { passive: false });
    scroller.addEventListener('scroll', scroll, { passive: true });
    root.addEventListener('click', click, true);
    root.addEventListener('dragstart', dragStart);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    return () => {
      releaseCapture();
      clearTimeout(wheelEnd);
      generation.current++;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      root.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerCancel);
      document.removeEventListener('lostpointercapture', pointerCancel);
      root.removeEventListener('touchstart', touchStart);
      root.removeEventListener('touchmove', touchMove);
      root.removeEventListener('touchend', touchEnd);
      root.removeEventListener('touchcancel', touchCancel);
      scroller.removeEventListener('wheel', wheel);
      scroller.removeEventListener('scroll', scroll);
      root.removeEventListener('click', click, true);
      root.removeEventListener('dragstart', dragStart);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
    };
  }, [options.page, options.viewKey, options.blocked, arrival.cancel, cancel, change, refresh]);
  return { ...state, announcement, refresh, arriving: arrival.pending, active: state.phase !== 'idle' };
}
