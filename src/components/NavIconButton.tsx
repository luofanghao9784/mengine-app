import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type RefObject,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';

/** Shared hover/focus behavior for the main navigation and card action rail. */
export function useNavHover(rail: RefObject<HTMLElement | null>, resetKey?: string) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const expand = (id: string) => {
    clearClose();
    setExpanded(id);
  };
  const dismiss = () => {
    clearClose();
    setExpanded(null);
  };
  useEffect(() => {
    dismiss();
  }, [resetKey]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      clearClose();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const interaction = (id: string): HTMLAttributes<HTMLDivElement> => ({
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') expand(id);
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'mouse') return;
      clearClose();
      closeTimer.current = setTimeout(() => setExpanded((current) => (current === id ? null : current)), 140);
    },
    onFocusCapture: (event) => {
      if (event.target.matches(':focus-visible')) expand(id);
    },
    onBlurCapture: (event) => {
      if (expanded === id && !event.currentTarget.contains(event.relatedTarget)) dismiss();
    },
  });
  return { expanded, dismiss, interaction };
}

/** Choose one direction for the whole rail, using its widest current label. */
export function useNavLabelSide(rail: RefObject<HTMLElement | null>) {
  const [side, setSide] = useState<'left' | 'right'>('left');
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el) return;
    const labels = Array.from(
      el.querySelectorAll<HTMLElement>(':scope > .nav-item > .nav-link > .nav-label'),
    );
    const measure = () => {
      const widest = Math.max(0, ...labels.map((label) => label.offsetWidth));
      setSide(el.getBoundingClientRect().right + widest + 20 <= innerWidth ? 'right' : 'left');
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    labels.forEach((label) => observer.observe(label));
    const dialog = el.closest('dialog');
    if (dialog) {
      observer.observe(dialog);
      dialog.addEventListener('animationend', measure);
    }
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      dialog?.removeEventListener('animationend', measure);
      window.removeEventListener('resize', measure);
    };
  }, [rail]);
  return side;
}

export function NavIconButton({
  label,
  Icon,
  active,
  expanded,
  interaction,
  className = '',
  wrapperClassName = '',
  feedback,
  accessory,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  wrapperClassName?: string;
  feedback?: string;
  accessory?: ReactNode;
  Icon: LucideIcon;
  active?: boolean;
  expanded?: boolean;
  interaction: HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div className={`nav-item ${expanded ? 'is-expanded' : ''} ${wrapperClassName}`} {...interaction}>
      <button {...props} className={`nav-link ${active ? 'active' : ''} ${className}`} aria-label={label}>
        <span className="nav-symbol">
          <Icon size={21} strokeWidth={1.65} />
        </span>
        <span
          className="nav-label"
          aria-hidden={feedback ? undefined : true}
          role={feedback ? 'status' : undefined}
        >
          {feedback || label}
        </span>
      </button>
      {accessory}
    </div>
  );
}
