import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './ui';

export function AnchoredPopover({
  anchor,
  side = 'bottom',
  title,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  side?: 'top' | 'bottom';
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const restoreFocus = useRef(true);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const positioned = position !== null;
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const above = Math.max(0, rect.top - 20);
      const below = Math.max(0, innerHeight - rect.bottom - 20);
      const needed = Math.min(element.scrollHeight, 300);
      const topSide = side === 'top' ? above >= needed || above > below : below < needed && above > below;
      const maxHeight = Math.min(460, topSide ? above : below);
      const height = Math.min(element.offsetHeight, maxHeight);
      const width = element.offsetWidth;
      const left = Math.max(
        12,
        Math.min(side === 'top' ? rect.left : rect.right - width, innerWidth - width - 12),
      );
      const top = Math.max(
        12,
        Math.min(topSide ? rect.top - height - 8 : rect.bottom + 8, innerHeight - height - 12),
      );
      setPosition((current) =>
        current?.left === left && current.top === top && current.maxHeight === maxHeight
          ? current
          : { left, top, maxHeight },
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    observer.observe(anchor);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [anchor, side, title]);
  useLayoutEffect(() => {
    if (!positioned) return;
    const element = panel.current;
    (
      element?.querySelector<HTMLElement>(
        '.anchored-popover-content input, .anchored-popover-content button',
      ) || element
    )?.focus({ preventScroll: true });
  }, [title, positioned]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      restoreFocus.current = false;
      close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === 'Tab') {
        const controls = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]',
          ) || [],
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard, true);
      if (restoreFocus.current && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={panel}
      className="anchored-popover"
      data-anchored-popover
      role="dialog"
      aria-label={title}
      aria-modal="false"
      tabIndex={-1}
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
    >
      <header>
        <strong>{title}</strong>
        <IconButton icon={X} label="关闭操作面板" onClick={onClose} />
      </header>
      <div className="anchored-popover-content">{children}</div>
    </div>,
    document.body,
  );
}
