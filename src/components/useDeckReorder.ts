import { useEffect, useRef, useState, type RefObject } from 'react';

// Pointer capture is confined to card titles and their shortcut bubbles: reading, selecting and scrolling
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
    const controls = rail.parentElement!;
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
      bubbleOrigin: boolean;
      captureTarget: HTMLElement;
      bubbleAnchors?: Map<string, number>;
      next: string[];
      ghost?: HTMLElement;
      bubbleGhost?: HTMLElement;
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
      current.bubbleGhost?.remove();
      current.header.removeAttribute('data-bubble-dragging');
      card(current.id)?.removeAttribute('data-dragging');
      rail.removeAttribute('data-reordering');
      clearMarker();
      if (current.captureTarget.hasPointerCapture(current.pointerId))
        current.captureTarget.releasePointerCapture(current.pointerId);
      setPreviewOrder(null);
      // Capture retargets the click to the rail; never treat a title tap/drop as
      // a click on the empty overlay canvas, including after the effect restarts.
      if (!current.bubbleOrigin || current.active) {
        rail.dataset.suppressDeckClick = 'true';
        setTimeout(() => {
          rail.removeAttribute('data-suppress-deck-click');
        }, 0);
      }
      if (current.active) {
        if (commit) callback.current(current.next);
        setMessage(commit ? '卡片位置已保存' : '已取消移动');
        const focusTarget = current.header.isConnected
          ? current.header
          : card(current.id)?.querySelector<HTMLElement>('.deck-card-header, .reader-header');
        focusTarget?.focus({ preventScroll: true });
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
          return drag!.x < (drag!.bubbleAnchors?.get(id) ?? box.left + box.width / 2);
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
      const bubble = target.closest<HTMLElement>('[data-deck-reorder-id]');
      if (
        !bubble &&
        target.closest('button, a, input, textarea, select, [role="button"], [contenteditable="true"]')
      )
        return;
      const header = bubble || target.closest<HTMLElement>('[data-deck-draggable]');
      const id =
        bubble?.dataset.deckReorderId || header?.closest<HTMLElement>('[data-deck-id]')?.dataset.deckId;
      if (!header || !id || !order.includes(id)) return;
      // A bubble tap must still trigger its ordinary card-switch click.
      if (!bubble) event.preventDefault();
      const rect = card(id).getBoundingClientRect();
      // The rail stays mounted while React moves keyed cards during live preview.
      // Capturing on a moving header can lose the touch stream on DOM reordering.
      if (!bubble) rail.setPointerCapture(event.pointerId);
      drag = {
        id,
        pointerId: event.pointerId,
        header,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        left: bubble ? event.clientX - rect.width / 2 : rect.left,
        top: rect.top,
        active: false,
        bubbleOrigin: !!bubble,
        captureTarget: bubble ? controls : rail,
        // Keep targets stable while drag preview temporarily hides the bubbles.
        bubbleAnchors: bubble
          ? new Map(
              [...controls.querySelectorAll<HTMLElement>('[data-deck-reorder-id]')].map((entry) => {
                const box = entry.getBoundingClientRect();
                return [entry.dataset.deckReorderId!, box.left + box.width / 2];
              }),
            )
          : undefined,
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
        drag.captureTarget.setPointerCapture(event.pointerId);
        const original = card(drag.id);
        const rect = original.getBoundingClientRect();
        const ghost = original.cloneNode(true) as HTMLElement;
        ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        ghost.removeAttribute('id');
        ghost.removeAttribute('data-deck-id');
        // A folded source must become a readable floating card while moving.
        ghost.removeAttribute('data-folding');
        ghost.removeAttribute('data-folded');
        ghost.removeAttribute('data-needs-reveal');
        ghost.removeAttribute('data-stack-highlight');
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
        if (drag.bubbleOrigin) {
          const bubbleBox = drag.header.getBoundingClientRect();
          const bubbleGhost = drag.header.cloneNode(true) as HTMLElement;
          bubbleGhost.querySelector('.deck-fold-bubble-label')?.remove();
          bubbleGhost.removeAttribute('data-deck-reorder-id');
          bubbleGhost.removeAttribute('data-card-id');
          bubbleGhost.removeAttribute('id');
          bubbleGhost.setAttribute('aria-hidden', 'true');
          bubbleGhost.inert = true;
          bubbleGhost.classList.add('deck-bubble-drag-ghost');
          Object.assign(bubbleGhost.style, {
            left: `${bubbleBox.left}px`,
            top: `${bubbleBox.top}px`,
          });
          document.body.append(bubbleGhost);
          drag.bubbleGhost = bubbleGhost;
          drag.header.dataset.bubbleDragging = 'true';
        }
        original.dataset.dragging = 'true';
        rail.dataset.reordering = 'true';
        frame = requestAnimationFrame(tick);
      }
      drag.ghost!.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px) rotate(0.4deg)`;
      if (drag.bubbleGhost)
        drag.bubbleGhost.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px)`;
      updateTarget();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) finish(true);
    };
    const cancel = () => finish(false);
    const lostCapture = (event: PointerEvent) => {
      if (event.target === drag?.captureTarget) finish(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        finish(false);
        return;
      }
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const header = event.target as HTMLElement;
      if (!controls.contains(header) || !header.matches('[data-deck-draggable], [data-deck-reorder-id]'))
        return;
      const id =
        header.dataset.deckReorderId || header.closest<HTMLElement>('[data-deck-id]')!.dataset.deckId!;
      if (!order.includes(id)) return;
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
    controls.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    controls.addEventListener('lostpointercapture', lostCapture);
    controls.addEventListener('click', click, true);
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
      controls.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      controls.removeEventListener('lostpointercapture', lostCapture);
      controls.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [scroller, route, key, capture, bounds, enabled]);
  return { message, order: previewOrder || order };
}
