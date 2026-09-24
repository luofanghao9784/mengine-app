import { useCallback, useEffect, useRef, type RefObject } from 'react';

type Position = { x: number; y: number };

// Like the briefing grid, capture the painted position before reordering and
// animate back from that position after layout. Only this hook's animations are
// cancelled, leaving conversation entrance/exit animations alone.
export function useDeckReflow(rail: RefObject<HTMLDivElement | null>, route: string) {
  const animations = useRef(new Map<HTMLElement, Animation>());
  const pending = useRef<{ route: string; positions: Map<HTMLElement, Position> } | null>(null);
  const clear = useCallback(() => {
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
  }, []);
  const capture = useCallback(() => {
    const element = rail.current;
    if (!element) return;
    pending.current = {
      route,
      positions: new Map(
        Array.from(element.querySelectorAll<HTMLElement>('[data-deck-id]')).map((card) => {
          const box = card.getBoundingClientRect();
          return [card, { x: box.left + element.scrollLeft, y: box.top }];
        }),
      ),
    };
  }, [rail, route]);
  const bounds = useCallback((card: HTMLElement) => {
    const box = card.getBoundingClientRect();
    const elasticX = parseFloat(card.style.getPropertyValue('--deck-elastic-x')) || 0;
    if (!animations.current.has(card))
      return elasticX ? new DOMRect(box.x - elasticX, box.y, box.width, box.height) : box;
    // Hit testing and fold/scroll geometry must use the final layout, not an
    // intermediate painted position, or moving neighbours can trigger jitter.
    const transform = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return new DOMRect(box.x - transform.m41 - elasticX, box.y - transform.m42, box.width, box.height);
  }, []);
  const animate = useCallback(() => {
    const before = pending.current;
    if (!before) return;
    pending.current = null;
    clear();
    const element = rail.current;
    if (!element || before.route !== route || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [card, old] of before.positions) {
      if (!element.contains(card) || card.hasAttribute('data-dragging')) continue;
      const next = card.getBoundingClientRect();
      if (!next.width || !next.height) continue;
      const dx = old.x - (next.left + element.scrollLeft);
      const dy = old.y - next.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      const animation = card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        id: 'deck-reflow',
        duration: 240,
        easing: 'cubic-bezier(.22,.68,0,1)',
        fill: 'both',
      });
      animations.current.set(card, animation);
      animation.finished
        .then(() => {
          if (animations.current.get(card) === animation) {
            animations.current.delete(card);
            animation.cancel();
          }
        })
        .catch(() => {
          /* Retargeted from the current painted position. */
        });
    }
  }, [clear, rail, route]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => {
      pending.current = null;
      clear();
    };
    const reduce = () => {
      if (preference.matches) stop();
    };
    preference.addEventListener('change', reduce);
    window.addEventListener('resize', stop);
    return () => {
      stop();
      preference.removeEventListener('change', reduce);
      window.removeEventListener('resize', stop);
    };
  }, [clear, route]);
  return { capture, animate, bounds };
}
