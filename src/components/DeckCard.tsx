import { Children, isValidElement, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
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
  const drag = useRef<{ x: number; width: number } | null>(null);
  const value = (width || initial) + widthExtension;
  const resize = (next: number) => onWidth(Math.max(min, Math.min(max, next)) - widthExtension);
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
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            width: event.currentTarget.parentElement!.getBoundingClientRect().width,
          };
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + event.clientX - drag.current.x);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
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
