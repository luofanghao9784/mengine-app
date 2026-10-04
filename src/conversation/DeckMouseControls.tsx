import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { FileText, List, MessageSquareText, LayoutPanelTop } from 'lucide-react';
import './deck-mouse-controls.css';
import { mutedDeckShadowIds } from './deck-shadows';

type Fold = { id: string; title: string; kind: string; left: number; top: number };
type Group = {
  left: number;
  top: number;
  titleWidth: number;
  cards: Fold[];
  right?: number;
  leftTitleWidth?: number;
  midpoint?: number;
};
const bubbleSize = 38.4;
const bubbleGap = 8;
const bubbleStep = bubbleSize + bubbleGap;
// A group ends at its last button, without a trailing gap.
const groupWidth = (count: number) => count * bubbleStep - bubbleGap;
type Bubble = {
  card: Fold;
  left: number;
  top: number;
  titleWidth: number;
  right?: number;
  leaving: boolean;
  titleOnLeft: boolean;
};

// Retain disappearing bubbles for their short exit animation. Card ids keep
// ongoing bubbles mounted when they move between a stack and the right edge.
function useBubblePresence(groups: Group[], enabled: boolean) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  useEffect(() => {
    const next = enabled
      ? groups.flatMap((group) =>
          group.cards.map((card, index) => {
            const titleOnLeft =
              group.right !== undefined ||
              group.left + index * bubbleStep + bubbleSize / 2 >= (group.midpoint ?? Infinity);
            return {
              card,
              left: group.left + index * bubbleStep,
              right:
                group.right === undefined
                  ? undefined
                  : group.right + (group.cards.length - index - 1) * bubbleStep,
              top: group.top,
              titleWidth: Math.max(
                0,
                Math.min(
                  320,
                  titleOnLeft
                    ? (group.leftTitleWidth ?? 0) + index * bubbleStep
                    : group.titleWidth - index * bubbleStep,
                ),
              ),
              titleOnLeft,
              leaving: false,
            };
          }),
        )
      : [];
    setBubbles((previous) => {
      const ids = new Set(next.map((bubble) => bubble.card.id));
      const retained = [
        ...next,
        ...previous
          .filter((bubble) => !ids.has(bubble.card.id))
          .map((bubble) => ({ ...bubble, leaving: true })),
      ];
      return JSON.stringify(previous) === JSON.stringify(retained) ? previous : retained;
    });
  }, [groups, enabled]);
  const leavingIds = bubbles
    .filter((bubble) => bubble.leaving)
    .map((bubble) => bubble.card.id)
    .join(',');
  useEffect(() => {
    if (!leavingIds) return;
    const ids = new Set(leavingIds.split(','));
    // Also clean up when the layout hides controls and no animation event fires.
    const timer = setTimeout(
      () =>
        setBubbles((previous) => previous.filter((bubble) => !bubble.leaving || !ids.has(bubble.card.id))),
      180,
    );
    return () => clearTimeout(timer);
  }, [leavingIds]);
  return bubbles;
}

/** Controls live outside the sticky cards, so collapsed readers cannot cover them. */
export function DeckMouseControls({
  scroller,
  layoutKey,
  enabled,
  onSelect,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  layoutKey: string;
  enabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [hoveredCard, setHoveredCard] = useState<string>();
  const bubbles = useBubblePresence(groups, enabled);
  const latest = useRef(onSelect);
  latest.current = onSelect;
  useEffect(() => {
    // This component can mount before a sibling's ref; passive effects see all refs.
    const deck = scroller.current;
    if (!deck || !enabled) return;
    const cards = [...deck.querySelectorAll<HTMLElement>('[data-deck-id]')];
    const update = () => {
      // Preserve the pressed bubble and its drop targets through live preview.
      if (deck.hasAttribute('data-reordering')) return;
      const mobile = matchMedia('(max-width: 1000px)').matches;
      // Cap each overlapping stack at its back and front shadow surfaces.
      const muted = mutedDeckShadowIds(
        mobile || deck.hasAttribute('data-reordering')
          ? []
          : cards
              .filter((card) => !card.classList.contains('live-reader-fullscreen'))
              .map((card) => {
                const box = card.getBoundingClientRect();
                return {
                  id: card.dataset.deckId!,
                  left: box.left,
                  right: box.right,
                  order: Number(card.dataset.deckOrder),
                };
              }),
      );
      cards.forEach((card) => card.toggleAttribute('data-shadow-muted', muted.has(card.dataset.deckId!)));
      const viewport = deck.getBoundingClientRect();
      const container = deck.parentElement!;
      const origin = container.getBoundingClientRect();
      const toolbar = container.querySelector<HTMLElement>(':scope > .live-deck-toolbar');
      const actions = toolbar?.querySelector<HTMLElement>('.live-deck-arrows');
      const toolbarBox = toolbar?.getBoundingClientRect();
      const rowTop = toolbarBox
        ? toolbarBox.top - origin.top + (toolbarBox.height - bubbleSize) / 2
        : undefined;
      const entries: Fold[] =
        mobile || deck.hasAttribute('data-reordering')
          ? []
          : cards
              .map((card) => {
                const box = card.getBoundingClientRect();
                return {
                  id: card.dataset.deckId!,
                  title: card.dataset.deckTitle || '',
                  kind: card.classList.contains('deck-list')
                    ? 'list'
                    : card.classList.contains('deck-conversation')
                      ? 'conversation'
                      : card.classList.contains('deck-source')
                        ? 'source'
                        : 'file',
                  left: box.left - origin.left,
                  top: box.top - origin.top - bubbleStep,
                };
              })
              .sort((a, b) => a.left - b.left);
      const viewportRight = viewport.left + deck.clientWidth - origin.left;
      // Keep the shortcut row clear of the existing back/forward/close actions.
      const right = Math.min(
        viewportRight - 12,
        actions ? actions.getBoundingClientRect().left - origin.left - bubbleGap : viewportRight - 12,
      );
      const outside = entries.filter((card) => card.left >= viewportRight - 1);
      const folded = entries.filter(
        (card) =>
          cards.find((node) => node.dataset.deckId === card.id)?.hasAttribute('data-needs-reveal') &&
          !outside.includes(card),
      );
      const groups: Group[] = [];
      for (const card of folded) {
        const group = groups.at(-1);
        if (group && card.left - group.cards.at(-1)!.left <= bubbleStep + bubbleGap) group.cards.push(card);
        else
          groups.push({
            left: Math.max(viewport.left - origin.left, card.left),
            top: rowTop ?? Math.max(4, card.top),
            titleWidth: 0,
            cards: [card],
          });
      }
      if (outside.length)
        groups.push({
          left: right - groupWidth(outside.length),
          top: rowTop ?? Math.max(4, outside[0].top),
          titleWidth: 0,
          cards: outside,
          right: origin.width - right,
        });
      // Pack from the right to keep separate stacks from overlapping the actions or each other.
      let availableRight = right;
      for (let index = groups.length - 1; index >= 0; index--) {
        const group = groups[index];
        group.left = Math.min(group.left, availableRight - groupWidth(group.cards.length));
        if (group.right !== undefined)
          group.right = origin.width - group.left - groupWidth(group.cards.length);
        availableRight = group.left - bubbleGap;
      }
      for (const group of groups) {
        group.midpoint = (viewport.left - origin.left + viewportRight) / 2;
        // Titles float above neighboring bubbles; reserve width to the page edge,
        // not just the empty gap between groups (which can be zero).
        group.leftTitleWidth = group.left - (viewport.left - origin.left) - bubbleGap;
        group.titleWidth = right - group.left - bubbleSize - bubbleGap;
      }
      setGroups((previous) => (JSON.stringify(previous) === JSON.stringify(groups) ? previous : groups));
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const size = new ResizeObserver(schedule);
    size.observe(deck);
    const toolbar = deck.parentElement?.querySelector(':scope > .live-deck-toolbar');
    if (toolbar) size.observe(toolbar);
    cards.forEach((card) => size.observe(card));
    const tail = deck.querySelector('.deck-scroll-tail');
    if (tail) size.observe(tail);
    const changes = new MutationObserver(schedule);
    changes.observe(deck, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-needs-reveal', 'data-deck-title', 'data-deck-order', 'data-reordering'],
    });
    const clearHover = () => setHoveredCard(undefined);
    const hoverCard = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card =
        event.pointerType === 'mouse' && !event.buttons && !deck.hasAttribute('data-reordering')
          ? target?.closest<HTMLElement>('[data-deck-id][data-needs-reveal]')
          : null;
      setHoveredCard(card?.dataset.deckId);
    };
    deck.addEventListener('pointermove', hoverCard);
    deck.addEventListener('pointerleave', clearHover);
    deck.addEventListener('pointerdown', clearHover, true);
    deck.addEventListener('scroll', clearHover, { passive: true });
    window.addEventListener('blur', clearHover);
    deck.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      changes.disconnect();
      deck.removeEventListener('pointermove', hoverCard);
      deck.removeEventListener('pointerleave', clearHover);
      deck.removeEventListener('pointerdown', clearHover, true);
      deck.removeEventListener('scroll', clearHover);
      window.removeEventListener('blur', clearHover);
      clearHover();
      deck.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cards.forEach((card) => {
        card.removeAttribute('data-stack-highlight');
        card.removeAttribute('data-shadow-muted');
      });
    };
  }, [scroller, layoutKey, enabled]);
  const highlight = (id: string, active: boolean) => {
    const card = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-deck-id]') || [])].find(
      (card) => card.dataset.deckId === id,
    );
    card?.toggleAttribute('data-stack-highlight', active);
  };
  if (!enabled) return null;
  return (
    <>
      {bubbles.map(({ card, left, right, top, titleWidth, leaving, titleOnLeft }) => {
        const Icon =
          card.kind === 'list'
            ? List
            : card.kind === 'conversation'
              ? MessageSquareText
              : card.kind === 'source'
                ? LayoutPanelTop
                : FileText;
        return (
          <div
            key={card.id}
            className={`deck-fold-bubbles ${right === undefined ? '' : 'deck-offscreen-bubbles'}`}
            aria-label={right === undefined ? '未完整显示卡片快捷切换' : '画面外卡片快捷切换'}
            aria-hidden={leaving || undefined}
            data-leaving={leaving || undefined}
            data-title-side={titleOnLeft ? 'left' : 'right'}
            style={
              {
                left: right === undefined ? left : undefined,
                right,
                top,
                '--fold-title-width': `${titleWidth}px`,
              } as CSSProperties
            }
          >
            <button
              type="button"
              className="deck-fold-bubble-entry"
              data-card-hover={(!leaving && hoveredCard === card.id) || undefined}
              data-card-id={card.id}
              data-deck-reorder-id={card.kind === 'list' || leaving ? undefined : card.id}
              aria-description={
                card.kind === 'list' ? undefined : '拖动调整卡片顺序；也可按 Alt + 左右方向键'
              }
              disabled={leaving}
              aria-label={`切换到${card.title}`}
              onPointerEnter={() => highlight(card.id, true)}
              onPointerLeave={() => highlight(card.id, false)}
              onFocus={(event) => highlight(card.id, event.currentTarget.matches(':focus-visible'))}
              onBlur={() => highlight(card.id, false)}
              onClick={() => {
                highlight(card.id, false);
                latest.current(card.id);
              }}
            >
              <span className="deck-fold-bubble">
                <svg className="deck-fold-bubble-surface" viewBox="0 0 40 48" aria-hidden="true">
                  <path d="M20 1 C30.5 1 39 9.5 39 20 C39 31 30 35 25 39 C23 40.6 21 44 20 46 C19 44 17 40.6 15 39 C10 35 1 31 1 20 C1 9.5 9.5 1 20 1Z" />
                </svg>
                <Icon size={19.2} aria-hidden="true" />
              </span>
              <span className="deck-fold-bubble-label" aria-hidden="true">
                <span className="deck-stack-hint">
                  <span>{card.title}</span>
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}
