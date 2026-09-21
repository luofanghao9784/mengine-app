import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

const limits: Record<string, [number, number, number]> = {
  list: [208, 340, 240],
  conversation: [420, 760, 560],
  source: [300, 580, 360],
  file: [320, 680, 400],
};

export type DeckCardProps = {
  id: string;
  className?: string;
  label: string;
  kind: string;
  width?: number;
  onWidth: (width: number) => void;
  children: ReactNode;
  active: boolean;
  cardRef?: RefObject<HTMLElement | null>;
  folded?: boolean;
  covered?: boolean;
  onExpand?: () => void;
  tabLabel?: string;
};
export function DeckCard({
  id,
  className = '',
  label,
  kind,
  width,
  onWidth,
  children,
  active,
  cardRef,
  folded,
  covered,
  onExpand,
  tabLabel,
}: DeckCardProps) {
  const [min, max, initial] = limits[kind];
  const drag = useRef<{ x: number; width: number } | null>(null);
  const value = width || initial;
  const resize = (next: number) => onWidth(Math.max(min, Math.min(max, next)));
  return (
    <section
      ref={cardRef}
      id={id === 'list' ? 'conversation-list' : undefined}
      className={`deck-card deck-${kind} ${className} ${active ? 'mobile-active' : ''} ${folded ? 'is-folded' : ''}`}
      data-folded={folded || undefined}
      data-deck-id={id}
      aria-label={label}
      tabIndex={-1}
      style={{ '--card-width': `${value}px` } as CSSProperties}
    >
      <div className="deck-card-content" inert={covered || undefined}>
        {children}
      </div>
      {onExpand && (
        <button
          className="deck-fold-tab"
          aria-label={`展开${tabLabel || label}`}
          onClick={onExpand}
          tabIndex={folded ? 0 : -1}
          aria-hidden={!folded}
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
          drag.current = { x: event.clientX, width: value };
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
        onDoubleClick={() => onWidth(initial)}
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
