import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Maximize2, Minimize2, X } from 'lucide-react';
import { animateBriefingMorph } from '../components/conversationMotion';
import { takeViewportMotion } from './viewport-motion';
import { requestNavigationLocked } from '../shared/request-guard';
import { IconButton } from '../shared/ui';
import { DeckCard, OrderedDeckCards } from '../components/DeckCard';
import { DeckStackHint } from '../components/DeckStackHint';
import { useDeckReflow } from '../components/useDeckReflow';
import { useDeckReorder } from '../components/useDeckReorder';
import { useDeckReveal } from '../components/useDeckReveal';
import { useDeckElasticScroll } from '../components/useDeckElasticScroll';
import { useDeckLayout } from '../components/useDeckLayout';
import { conversationDefaultWidth, deckOrder, deckSpacing } from '../conversationDeck';
import './deck.css';

export type CompanionCard = {
  id: string;
  kind: 'source' | 'file';
  title: string;
  label: string;
  content: ReactNode;
  close: () => void;
};

/** Demo presentation primitives with live, independently authorized readers. */
export function LiveConversationDeck({
  tenant,
  navigation,
  children,
  title,
  cards,
  reveal,
  onClose,
  onRefresh,
}: {
  tenant: string;
  navigation: ReactNode;
  children: ReactNode;
  title: string;
  cards: CompanionCard[];
  reveal?: { id: string; sequence: number };
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [active, setActive] = useState('conversation');
  const root = useRef<HTMLDivElement>(null);
  const close = () => {
    if (requestNavigationLocked()) return;
    const element = root.current;
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    element.inert = true;
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      easing: 'ease-out',
      fill: 'forwards',
    });
    void animation.finished.then(onClose).catch(() => {});
  };
  useLayoutEffect(() => {
    const origin = takeViewportMotion(tenant);
    if (!origin) return;
    let surface: HTMLDivElement | undefined;
    let animations: Animation[] = [];
    let readingObserver: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(
        origin.target === 'composer' ? '[data-deck-id=conversation]' : '[data-deck-id=briefing]',
      );
      if (!target || !target.getClientRects().length) return;
      surface = document.createElement('div');
      surface.className = 'live-viewport-morph';
      surface.setAttribute('aria-hidden', 'true');
      surface.inert = true;
      document.body.append(surface);
      if (origin.target === 'briefing' && origin.scroll > 0) {
        const restoreReading = () => {
          const reader = target.querySelector<HTMLElement>('.live-source-reader');
          if (reader && reader.scrollHeight > reader.clientHeight) {
            reader.scrollTop = origin.scroll;
            readingObserver?.disconnect();
          }
        };
        readingObserver = new MutationObserver(restoreReading);
        readingObserver.observe(target, { childList: true, subtree: true });
        restoreReading();
      }
      animations = animateBriefingMorph(surface, target, origin.visual, target.getBoundingClientRect(), 340);
      void Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(() => {
        surface?.remove();
        animations.forEach((a) => a.cancel());
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      readingObserver?.disconnect();
      animations.forEach((a) => a.cancel());
      surface?.remove();
    };
  }, [tenant]);
  const [fullscreen, setFullscreen] = useState<string>();
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null),
    center = useRef<HTMLElement>(null);
  const fullscreenTrigger = useRef<HTMLElement | null>(null);
  const sourceTriggers = useRef<Record<string, HTMLElement>>({});
  const reflow = useDeckReflow(scroller, 'live');
  const available = ['conversation', ...cards.map((c) => c.id)];
  const { message, order: movableOrder } = useDeckReorder(
    scroller,
    'live',
    deckOrder(available, order),
    setOrder,
    reflow,
    !fullscreen,
  );
  const layoutKey = movableOrder.join('|') + ':' + (fullscreen || '');
  const { deckSize, folds, cardScrollRanges, canScrollLeft, canScrollRight } = useDeckLayout(
    scroller,
    center,
    layoutKey,
    cards.length === 0,
    reflow,
  );
  useDeckElasticScroll(scroller, layoutKey, !fullscreen, reflow.bounds);
  const show = (id: string, focus = true) => {
    setActive(id);
    const element = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-deck-id]') || []).find(
      (c) => c.dataset.deckId === id,
    );
    if (focus) element?.focus({ preventScroll: true });
    if (!scroller.current || matchMedia('(max-width: 1000px)').matches) return;
    const range = cardScrollRanges.current[id] || { from: 0, to: 0 };
    scroller.current.scrollTo({
      left: Math.max(range.from, Math.min(range.to, scroller.current.scrollLeft)),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  useDeckReveal(scroller, layoutKey, !fullscreen, show);
  useLayoutEffect(() => {
    if (!reveal) return;
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && center.current?.contains(trigger))
      sourceTriggers.current[reveal.id] = trigger;
    const frame = requestAnimationFrame(() => show(reveal.id));
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  useEffect(() => {
    if (!['list', ...available].includes(active)) setActive('conversation');
    if (fullscreen && !available.includes(fullscreen)) setFullscreen(undefined);
  }, [layoutKey]);
  const restore = (id: string) => {
    show('conversation', false);
    requestAnimationFrame(() => {
      const trigger = sourceTriggers.current[id];
      (trigger?.isConnected
        ? trigger
        : center.current?.querySelector<HTMLElement>('textarea, button')
      )?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!fullscreen) return;
    const dialog = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-deck-id]') || []).find(
      (c) => c.dataset.deckId === fullscreen,
    );
    if (!dialog) return;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('popover', 'manual');
    dialog.showPopover();
    // Keep the same reader node, its version and scroll position while full screen.
    const suspended: HTMLElement[] = [];
    let branch = dialog;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          suspended.push(sibling);
        }
      }
      if (parent === document.body) break;
      branch = parent;
    }
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((e) => e.getClientRects().length && !e.closest('[inert]'));
    const first = () => (controls()[0] || dialog).focus({ preventScroll: true });
    const contain = (e: FocusEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (!dialog.contains(e.target as Node)) first();
    };
    const keydown = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setFullscreen(undefined);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const list = controls(),
          current = list.indexOf(document.activeElement as HTMLElement);
        (list[(current + (e.shiftKey ? -1 : 1) + list.length) % list.length] || dialog).focus({
          preventScroll: true,
        });
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', contain, true);
    first();
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', contain, true);
      dialog.hidePopover();
      dialog.removeAttribute('popover');
      dialog.removeAttribute('role');
      dialog.removeAttribute('aria-modal');
      suspended.forEach((e) => {
        e.inert = false;
      });
      requestAnimationFrame(() => {
        if (fullscreenTrigger.current?.isConnected) fullscreenTrigger.current.focus({ preventScroll: true });
      });
    };
  }, [fullscreen]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        fullscreen ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      close();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [fullscreen, onClose]);
  const width = (id: string, value: number) => setWidths((all) => ({ ...all, [id]: value }));
  const reset = (id: string) =>
    setWidths((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  const common = (id: string) => ({
    id,
    width: widths[id],
    active: active === id,
    order: movableOrder.indexOf(id) + 1,
    onWidth: (value: number) => width(id, value),
    onResetWidth: () => reset(id),
    ...(!fullscreen ? folds[id] : {}),
    onExpand: () => show(id),
  });
  return (
    <div
      ref={root}
      role="region"
      aria-label="会话视窗"
      className={`live-conversations live-demo-deck ${fullscreen ? 'has-fullscreen-reader' : ''}`}
      style={{ '--deck-padding': `${deckSpacing.padding}px` } as CSSProperties}
    >
      <header className="live-deck-toolbar">
        <h1 className="live-deck-caption">会话视窗</h1>
        <div className="deck-mobile-tabs" aria-label="会话卡片切换">
          <button type="button" aria-pressed={active === 'list'} onClick={() => show('list')}>
            列表
          </button>
          {movableOrder.map((id) => (
            <button key={id} type="button" aria-pressed={active === id} onClick={() => show(id)}>
              {id === 'conversation' ? '对话' : cards.find((c) => c.id === id)?.label}
            </button>
          ))}
        </div>
        <div className="live-deck-arrows">
          <IconButton icon={RefreshCw} label="刷新会话" onClick={onRefresh} />
          <IconButton
            icon={ArrowLeft}
            label="向左查看卡片"
            disabled={!canScrollLeft}
            onClick={() => scroller.current?.scrollBy({ left: -380, behavior: 'smooth' })}
          />
          <IconButton
            icon={ArrowRight}
            label="向右查看卡片"
            disabled={!canScrollRight}
            onClick={() => scroller.current?.scrollBy({ left: 380, behavior: 'smooth' })}
          />
          <IconButton icon={X} label="关闭会话视窗" onClick={close} />
        </div>
      </header>
      <div
        className="deck-scroller live-deck-scroller"
        ref={scroller}
        style={{ '--deck-gap': `${deckSpacing.gap}px` } as CSSProperties}
      >
        <DeckCard {...common('list')} kind="list" label="会话列表卡片" tabLabel="会话列表">
          {navigation}
        </DeckCard>
        <OrderedDeckCards order={movableOrder}>
          <DeckCard
            {...common('conversation')}
            kind="conversation"
            label="当前会话"
            stackTitle={title}
            cardRef={center}
            defaultWidth={conversationDefaultWidth(
              deckSize.width,
              deckSize.list,
              cards.map((c) => widths[c.id] || (c.kind === 'source' ? 440 : 400)),
            )}
          >
            {children}
          </DeckCard>
          {cards.map((card) => (
            <DeckCard
              key={card.id}
              {...common(card.id)}
              kind={card.kind}
              label={card.label}
              stackTitle={card.title}
              className={fullscreen === card.id ? 'live-reader-fullscreen' : ''}
            >
              <header className="deck-card-header live-card-heading">
                <div>
                  <small>{card.kind === 'source' ? '画报卡片' : '资料卡片'}</small>
                  <h2 title={card.title}>{card.title}</h2>
                </div>
                <div className="live-card-actions">
                  <IconButton
                    icon={fullscreen === card.id ? Minimize2 : Maximize2}
                    label={fullscreen === card.id ? '退出来源全屏' : `全屏查看${card.label}`}
                    onClick={(e) => {
                      fullscreenTrigger.current = e.currentTarget;
                      setFullscreen(fullscreen === card.id ? undefined : card.id);
                    }}
                  />
                  <IconButton
                    icon={X}
                    label={`关闭${card.label}`}
                    onClick={() => {
                      setFullscreen(undefined);
                      card.close();
                      restore(card.id);
                    }}
                  />
                </div>
              </header>
              <div className="live-source-reader">{card.content}</div>
            </DeckCard>
          ))}
        </OrderedDeckCards>
        <div className="deck-scroll-tail" aria-hidden="true" />
      </div>
      <DeckStackHint scroller={scroller} layoutKey={layoutKey} enabled={!fullscreen} />
      <div className="deck-move-status" role="status">
        {message}
      </div>
    </div>
  );
}
