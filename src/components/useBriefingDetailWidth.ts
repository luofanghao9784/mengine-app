import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

const storageKey = 'briefing-detail-width-v1';
const initialWidth = 800;
export function useBriefingDetailWidth() {
  const [preferred, setPreferred] = useState(() => {
    try {
      const value = Number(localStorage.getItem(storageKey));
      return value >= 320 && value <= 1120 ? value : initialWidth;
    } catch {
      return initialWidth;
    }
  });
  const [viewport, setViewport] = useState(innerWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number; preferred: number } | null>(null);
  const latest = useRef(preferred);
  const gutter = viewport <= 600 ? 64 : 76;
  const max = Math.max(160, Math.min(1120, viewport - (viewport <= 600 ? 16 : 48) - gutter));
  const min = Math.min(320, max);
  const width = Math.max(min, Math.min(max, preferred));
  useEffect(() => {
    const resize = () => setViewport(innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const save = (value: number) => {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      /* Optional local preference. */
    }
  };
  const resize = (next: number, persist = false) => {
    latest.current = Math.max(min, Math.min(max, next));
    setPreferred(latest.current);
    if (persist) save(latest.current);
  };
  const cancel = () => {
    if (drag.current) {
      setPreferred(drag.current.preferred);
      latest.current = drag.current.preferred;
    }
    drag.current = null;
    setResizing(false);
  };
  const handle = (side: 'left' | 'right'): HTMLAttributes<HTMLDivElement> => ({
    role: 'separator',
    tabIndex: 0,
    'aria-label': `调整画报详情宽度（${side === 'left' ? '左侧' : '右侧'}）`,
    'aria-orientation': 'vertical',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': Math.round(width),
    'aria-description': '拖动边缘调整宽度，双击恢复默认',
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width, preferred };
      setResizing(true);
    },
    onPointerMove: (event) => {
      // Keep the dialog centered while the grabbed edge follows the pointer.
      if (drag.current)
        resize(drag.current.width + (event.clientX - drag.current.x) * 2 * (side === 'left' ? -1 : 1));
    },
    onPointerUp: (event) => {
      if (!drag.current) return;
      save(latest.current);
      drag.current = null;
      setResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onDoubleClick: () => {
      setPreferred(initialWidth);
      latest.current = initialWidth;
      save(initialWidth);
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      resize(
        event.key === 'Home'
          ? min
          : event.key === 'End'
            ? max
            : width + (event.key === 'ArrowRight' ? 24 : -24),
        true,
      );
    },
  });
  return { width, gutter, resizing, handle };
}
