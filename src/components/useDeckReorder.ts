import { useEffect, useRef, useState, type RefObject } from 'react';

// Pointer capture is confined to card titles: reading, selecting and scrolling
// within card bodies keep their native behavior on both mouse and touch devices.
export function useDeckReorder(
  scroller: RefObject<HTMLDivElement | null>,
  route: string,
  order: string[],
  onOrder: (order: string[]) => void,
  motion: { capture: () => void; bounds: (card: HTMLElement) => DOMRect },
  enabled = true,
) {
  const callback = useRef(onOrder);
  callback.current = onOrder;
  const [message, setMessage] = useState('');
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const { capture, bounds } = motion;
  useEffect(() => {
    if (!message || message.includes('松手保存')) return;
    const timer = setTimeout(() => setMessage(''), 2400);
    return () => clearTimeout(timer);
  }, [message]);
  const key = order.join('|');
  useEffect(() => {
    const rail = scroller.current;
    if (!rail || !enabled) return;
    const card = (id: string) =>
      Array.from(rail.querySelectorAll<HTMLElement>('[data-deck-id]')).find(
        (node) => node.dataset.deckId === id,
      )!;
    const headers = order
      .map((id) => card(id)?.querySelector<HTMLElement>('.deck-card-header, .reader-header'))
      .filter((node) => !!node);
    headers.forEach((header) => {
      header.tabIndex = 0;
      header.dataset.deckDraggable = 'true';
      header.title = '拖动标题调整卡片顺序；也可按 Alt + 左右方向键';
    });
    let drag: {
      id: string;
      pointerId: number;
      header: HTMLElement;
      startX: number;
      startY: number;
      x: number;
      y: number;
      left: number;
      top: number;
      active: boolean;
      next: string[];
      ghost?: HTMLElement;
    } | null = null;
    let frame = 0;
    const clearMarker = () =>
      rail.querySelectorAll('[data-drop-side]').forEach((node) => node.removeAttribute('data-drop-side'));
    const finish = (commit: boolean) => {
      const current = drag;
      if (!current) return;
      if (!commit && current.active && current.next.some((id, index) => id !== order[index])) capture();
      drag = null;
      cancelAnimationFrame(frame);
      current.ghost?.remove();
      card(current.id)?.removeAttribute('data-dragging');
      rail.removeAttribute('data-reordering');
      clearMarker();
      if (rail.hasPointerCapture(current.pointerId)) rail.releasePointerCapture(current.pointerId);
      setPreviewOrder(null);
      // Capture retargets the click to the rail; never treat a title tap/drop as
      // a click on the empty overlay canvas, including after the effect restarts.
      rail.dataset.suppressDeckClick = 'true';
      setTimeout(() => {
        rail.removeAttribute('data-suppress-deck-click');
      }, 0);
      if (current.active) {
        if (commit) callback.current(current.next);
        setMessage(commit ? '卡片位置已保存' : '已取消移动');
        current.header.focus({ preventScroll: true });
      }
    };
    const updateTarget = () => {
      if (!drag?.active) return;
      const others = order.filter((id) => id !== drag!.id);
      let index: number;
      if (matchMedia('(max-width: 1000px)').matches) {
        const from = order.indexOf(drag.id);
        index = Math.max(
          0,
          Math.min(
            others.length,
            from + (Math.abs(drag.x - drag.startX) < 48 ? 0 : drag.x > drag.startX ? 1 : -1),
          ),
        );
      } else {
        index = others.findIndex((id) => {
          const box = bounds(card(id));
          return drag!.x < box.left + box.width / 2;
        });
        if (index < 0) index = others.length;
      }
      const next = [...others.slice(0, index), drag.id, ...others.slice(index)];
      if (next.some((id, index) => id !== drag!.next[index])) {
        capture();
        drag.next = next;
        setPreviewOrder(next);
      }
      clearMarker();
      const target = others[index] || others.at(-1);
      if (target) card(target).dataset.dropSide = index < others.length ? 'before' : 'after';
      const position = drag.next.indexOf(drag.id) + 1;
      setMessage(`第 ${position} 张工作卡片 · 松手保存 · Esc 取消`);
    };
    const tick = () => {
      if (!drag?.active) return;
      if (!matchMedia('(max-width: 1000px)').matches) {
        const bounds = rail.getBoundingClientRect();
        const direction = drag.x < bounds.left + 60 ? -1 : drag.x > bounds.right - 60 ? 1 : 0;
        if (direction) {
          rail.scrollLeft += direction * 12;
          updateTarget();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || drag || order.length < 2) return;
      const target = event.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]'))
        return;
      const header = target.closest<HTMLElement>('[data-deck-draggable]');
      const id = header?.closest<HTMLElement>('[data-deck-id]')?.dataset.deckId;
      if (!header || !id || !order.includes(id)) return;
      event.preventDefault();
      const rect = card(id).getBoundingClientRect();
      // The rail stays mounted while React moves keyed cards during live preview.
      // Capturing on a moving header can lose the touch stream on DOM reordering.
      rail.setPointerCapture(event.pointerId);
      drag = {
        id,
        pointerId: event.pointerId,
        header,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top,
        active: false,
        next: order,
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      event.preventDefault();
      if (!drag.active) {
        drag.active = true;
        const original = card(drag.id);
        const rect = original.getBoundingClientRect();
        const ghost = original.cloneNode(true) as HTMLElement;
        ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        ghost.removeAttribute('id');
        ghost.removeAttribute('data-deck-id');
        ghost.removeAttribute('aria-label');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        ghost.classList.add('deck-drag-ghost');
        Object.assign(ghost.style, {
          left: `${drag.left}px`,
          top: `${drag.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        document.body.append(ghost);
        drag.ghost = ghost;
        original.dataset.dragging = 'true';
        rail.dataset.reordering = 'true';
        frame = requestAnimationFrame(tick);
      }
      drag.ghost!.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px) rotate(0.4deg)`;
      updateTarget();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) finish(true);
    };
    const cancel = () => finish(false);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        finish(false);
        return;
      }
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const header = event.target as HTMLElement;
      if (!header.matches('[data-deck-draggable]')) return;
      const id = header.closest<HTMLElement>('[data-deck-id]')!.dataset.deckId!;
      const from = order.indexOf(id);
      const to =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? order.length - 1
            : Math.max(0, Math.min(order.length - 1, from + (event.key === 'ArrowLeft' ? -1 : 1)));
      event.preventDefault();
      const next = order.filter((item) => item !== id);
      next.splice(to, 0, id);
      if (from !== to) capture();
      callback.current(next);
      setMessage(`已移至第 ${to + 1} 张工作卡片`);
    };
    const click = (event: MouseEvent) => {
      if (rail.hasAttribute('data-suppress-deck-click')) {
        event.preventDefault();
        event.stopPropagation();
        rail.removeAttribute('data-suppress-deck-click');
      }
    };
    rail.addEventListener('pointerdown', down);
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerup', up);
    rail.addEventListener('pointercancel', cancel);
    rail.addEventListener('lostpointercapture', cancel);
    rail.addEventListener('click', click, true);
    document.addEventListener('keydown', keyboard, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      finish(false);
      headers.forEach((header) => {
        header.removeAttribute('tabindex');
        header.removeAttribute('data-deck-draggable');
        header.removeAttribute('title');
      });
      rail.removeEventListener('pointerdown', down);
      rail.removeEventListener('pointermove', move);
      rail.removeEventListener('pointerup', up);
      rail.removeEventListener('pointercancel', cancel);
      rail.removeEventListener('lostpointercapture', cancel);
      rail.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [scroller, route, key, capture, bounds, enabled]);
  return { message, order: previewOrder || order };
}
