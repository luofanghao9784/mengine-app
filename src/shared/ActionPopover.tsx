import './actions.css';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Keep the panel in its React context, but above card clipping and native readers. */
export function ActionPopover({
  anchor,
  label,
  children,
  onClose,
  align = 'end',
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  onClose: () => void;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = ref.current!;
    panel.showPopover();
    const place = () => {
      const target = anchor.current?.getBoundingClientRect();
      if (!target) return;
      const width = panel.offsetWidth,
        height = panel.offsetHeight;
      panel.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, align === 'start' ? target.left : target.right - width))}px`;
      panel.style.top = `${Math.max(
        12,
        Math.min(
          innerHeight - height - 12,
          target.bottom + height + 12 <= innerHeight ? target.bottom + 8 : target.top - height - 8,
        ),
      )}px`;
    };
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    place();
    panel
      .querySelector<HTMLElement>('button:not(:disabled), a[href], select:not(:disabled), textarea, input')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.current?.contains(event.target as Node))
        close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
      anchor.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      panel.hidePopover();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);
  return (
    <div ref={ref} popover="manual" className="workspace-action-popover" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
