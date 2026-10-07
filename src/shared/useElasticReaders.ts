import { useEffect } from 'react';

const readers =
  '.conversation-messages, .live-source-reader, .live-reading-scroll, .live-conversation-links, .workspace-shell .access-content';

/** Paint an edge spring without moving headers, composers or the parent deck. */
export function useElasticReaders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let active: HTMLElement | null = null;
    let offset = 0,
      frame = 0,
      idle = 0;
    let touch: { reader: HTMLElement; x: number; y: number; axis: 'x' | 'y' | null } | null = null;
    const reset = () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      active?.style.removeProperty('--reader-elastic-y');
      active?.removeAttribute('data-reader-elastic');
      active = null;
      offset = frame = idle = 0;
    };
    const paint = (value: number) => {
      offset = value;
      active?.style.setProperty('--reader-elastic-y', `${value.toFixed(2)}px`);
    };
    const release = () => {
      clearTimeout(idle);
      if (!active || frame) return;
      const start = performance.now(),
        from = offset;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 360);
        paint(from * (1 - t) ** 3);
        if (t < 1) frame = requestAnimationFrame(tick);
        else reset();
      };
      frame = requestAnimationFrame(tick);
    };
    const find = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('textarea, input, select, [contenteditable=true]'))
        return null;
      // A nested scroll surface owns the gesture, even at its boundary.
      for (let node: Element | null = target; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (!/(auto|scroll)/.test(style.overflowY)) continue;
        if (!(node instanceof HTMLElement) || !node.matches(readers)) return null;
        // The magazine feed owns its pull-to-refresh gesture separately.
        if (node.matches('.access-content') && node.querySelector('.live-briefing')) return null;
        return node;
      }
      return null;
    };
    const atEdge = (node: HTMLElement, delta: number) =>
      delta < 0 ? node.scrollTop <= 1 : node.scrollTop >= node.scrollHeight - node.clientHeight - 1;
    const pull = (node: HTMLElement, delta: number, pause: boolean) => {
      if (active !== node) {
        reset();
        active = node;
      }
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(idle);
      active.setAttribute('data-reader-elastic', '');
      const direction = -Math.sign(delta);
      const current = Math.sign(offset) === direction ? Math.abs(offset) : 0;
      paint(direction * (44 - (44 - current) * Math.exp(-Math.abs(delta) / 160)));
      if (pause) idle = window.setTimeout(release, 70);
    };
    const wheel = (event: WheelEvent) => {
      if (
        reduced.matches ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      const node = find(event.target);
      if (!node) return;
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      if (!atEdge(node, delta)) {
        release();
        return;
      }
      if (event.cancelable) event.preventDefault();
      pull(node, delta, true);
    };
    const start = (event: TouchEvent) => {
      if (reduced.matches || event.touches.length !== 1) return;
      const reader = find(event.target),
        point = event.touches[0];
      if (reader) touch = { reader, x: point.clientX, y: point.clientY, axis: null };
    };
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) {
        touch = null;
        release();
        return;
      }
      const point = event.touches[0],
        dx = touch.x - point.clientX,
        dy = touch.y - point.clientY;
      if (!touch.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 6)
        touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (touch.axis !== 'y') return;
      touch.x = point.clientX;
      touch.y = point.clientY;
      if (atEdge(touch.reader, dy)) {
        if (event.cancelable) event.preventDefault();
        pull(touch.reader, dy, false);
      } else release();
    };
    const end = () => {
      touch = null;
      release();
    };
    document.addEventListener('wheel', wheel, { passive: false, capture: true });
    document.addEventListener('touchstart', start, { passive: true, capture: true });
    document.addEventListener('touchmove', move, { passive: false, capture: true });
    document.addEventListener('touchend', end, true);
    document.addEventListener('touchcancel', end, true);
    window.addEventListener('hashchange', reset);
    reduced.addEventListener('change', reset);
    return () => {
      reset();
      document.removeEventListener('wheel', wheel, true);
      document.removeEventListener('touchstart', start, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', end, true);
      window.removeEventListener('hashchange', reset);
      reduced.removeEventListener('change', reset);
    };
  }, [enabled]);
}
