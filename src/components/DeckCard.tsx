import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { deckLimits } from '../conversationDeck';

// Reorder the keyed elements themselves, so Tab and reading order match the
// visual layout without remounting readers or losing their selected versions.
export function OrderedDeckCards({ children, order }: { children: ReactNode; order: string[] }) {
  return Children.toArray(children).sort((a, b) => {
    const rank = (child: ReactNode) =>
      isValidElement<{ id: string }>(child) ? order.indexOf(child.props.id) : -1;
    return rank(a) - rank(b);
  });
}

export type DeckCardProps = {
  id: string;
  className?: string;
  label: string;
  kind: string;
  width?: number;
  defaultWidth?: number;
  widthExtension?: number;
  order?: number;
  onResetWidth?: () => void;
  onWidth: (width: number) => void;
  children: ReactNode;
  active: boolean;
  cardRef?: RefObject<HTMLElement | null>;
  folded?: boolean;
  covered?: boolean;
  clipped?: boolean;
  onExpand?: () => void;
  tabLabel?: string;
  stackTitle?: string;
};
export function DeckCard({
  id,
  className = '',
  label,
  kind,
  width,
  defaultWidth,
  widthExtension = 0,
  order = 0,
  onResetWidth,
  onWidth,
  children,
  active,
  cardRef,
  folded,
  covered,
  clipped,
  onExpand,
  tabLabel,
  stackTitle,
}: DeckCardProps) {
  const [baseMin, baseMax, fallback] = deckLimits[kind];
  const min = baseMin + widthExtension,
    max = baseMax + widthExtension;
  const initial = defaultWidth ?? fallback;
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const value = (width || initial) + widthExtension;
  const resize = (next: number) => onWidth(Math.max(min, Math.min(max, next)) - widthExtension);
  const latestResize = useRef(resize);
  latestResize.current = resize;
  const needsReveal = covered || clipped;
  return (
    <section
      ref={cardRef}
      id={id === 'list' ? 'conversation-list' : undefined}
      className={`deck-card deck-${kind} ${className} ${active ? 'mobile-active' : ''} ${folded ? 'is-folded' : ''}`}
      data-folded={folded || undefined}
      data-needs-reveal={needsReveal || undefined}
      data-clipped={clipped || undefined}
      data-deck-id={id}
      data-width-extension={widthExtension || undefined}
      data-deck-title={stackTitle || tabLabel || label}
      data-deck-order={order}
      aria-label={label}
      tabIndex={-1}
      style={{ '--card-width': `${value}px`, order } as CSSProperties}
    >
      <div className="deck-card-content" inert={covered || undefined}>
        {children}
      </div>
      {onExpand && (
        <button
          className="deck-fold-tab"
          aria-label={`展开${tabLabel || label}`}
          onClick={onExpand}
          tabIndex={needsReveal ? 0 : -1}
          aria-hidden={!needsReveal}
        />
      )}
      <div
        hidden={covered}
        role="separator"
        aria-label={`调整${label}宽度`}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        className="deck-resizer"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          stopDrag.current?.();
          const pointer = event.pointerId;
          const startX = event.clientX;
          const startWidth = event.currentTarget.parentElement!.getBoundingClientRect().width;
          // The handle may become covered/hidden as sticky cards overlap. Keep
          // document listeners alive until release even if capture is lost.
          const handle = event.currentTarget;
          handle.setPointerCapture(pointer);
          const move = (next: PointerEvent) => {
            if (next.pointerId === pointer) latestResize.current(startWidth + next.clientX - startX);
          };
          const finish = () => {
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', end, true);
            document.removeEventListener('pointercancel', end, true);
            window.removeEventListener('blur', finish);
            if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
            stopDrag.current = null;
          };
          const end = (next: PointerEvent) => {
            if (next.pointerId === pointer) finish();
          };
          stopDrag.current = finish;
          document.addEventListener('pointermove', move, true);
          document.addEventListener('pointerup', end, true);
          document.addEventListener('pointercancel', end, true);
          window.addEventListener('blur', finish);
        }}
        onDoubleClick={() => (onResetWidth ? onResetWidth() : onWidth(initial))}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          resize(
            event.key === 'Home'
              ? min
              : event.key === 'End'
                ? max
                : value + (event.key === 'ArrowRight' ? 24 : -24),
          );
        }}
      >
        <span />
      </div>
    </section>
  );
}
