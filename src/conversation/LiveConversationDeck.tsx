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
import './conversation.css';
import { useViewState, useViewScroll, textState } from '../shared/useViewState';

export type CompanionCard = {
  id: string;
  kind: 'source' | 'file' | 'properties';
  parentId?: string;
  actions?: ReactNode;
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
  reader = false,
  mainActions,
  persistenceKey = 'conversation',
}: {
  tenant: string;
  navigation?: ReactNode;
  reader?: boolean;
  mainActions?: ReactNode;
  persistenceKey?: string;
  children: ReactNode;
  title: string;
  cards: CompanionCard[];
  reveal?: { id: string; sequence: number };
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [active, setActive] = useViewState(tenant, persistenceKey + ':active', 'conversation', textState);
  const root = useRef<HTMLDivElement>(null);
  useViewScroll(root, tenant, persistenceKey);
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
    if (reader) return;
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
  const [widths, setWidths] = useViewState<Record<string, number>>(
    tenant,
    persistenceKey + ':widths',
    {},
    (v): v is Record<string, number> =>
      !!v &&
      typeof v === 'object' &&
      Object.values(v).every((n) => typeof n === 'number' && n >= 208 && n <= 1040),
  );
  const [order, setOrder] = useViewState<string[]>(
    tenant,
    persistenceKey + ':order',
    [],
    (v): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(textState),
  );
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
    // Layout measures the restored cards before returning to the active reader.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => show(active, false));
    });
    return () => cancelAnimationFrame(frame);
  }, [persistenceKey]);
  useLayoutEffect(() => {
    if (!reveal) return;
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && root.current?.contains(trigger))
      sourceTriggers.current[reveal.id] = trigger;
    const frame = requestAnimationFrame(() => show(reveal.id));
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  useEffect(() => {
    if (!['list', ...available].includes(active)) setActive('conversation');
    if (fullscreen && !available.includes(fullscreen)) setFullscreen(undefined);
  }, [layoutKey]);
  const restore = (id: string, parentId = 'conversation') => {
    show(parentId, false);
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
      if (Array.from(document.querySelectorAll('dialog[open]')).some((modal) => !modal.contains(dialog)))
        return;
      if (!dialog.contains(e.target as Node)) first();
    };
    const keydown = (e: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll('dialog[open]')).some((modal) => !modal.contains(dialog)))
        return;
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
        Array.from(document.querySelectorAll('dialog[open]')).some((modal) => !modal.contains(root.current))
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
      aria-label={reader ? '资料阅读视窗' : '会话视窗'}
      className={`live-conversations live-demo-deck ${fullscreen ? 'has-fullscreen-reader' : ''} ${reader ? 'live-reading-deck' : ''}`}
      style={{ '--deck-padding': `${deckSpacing.padding}px` } as CSSProperties}
    >
      <header className="live-deck-toolbar">
        <h1 className="live-deck-caption">{reader ? '资料阅读' : '会话视窗'}</h1>
        <div className="deck-mobile-tabs" aria-label="会话卡片切换">
          {navigation && (
            <button type="button" aria-pressed={active === 'list'} onClick={() => show('list')}>
              列表
            </button>
          )}
          {movableOrder.map((id) => (
            <button key={id} type="button" aria-pressed={active === id} onClick={() => show(id)}>
              {id === 'conversation' ? (reader ? '正文' : '对话') : cards.find((c) => c.id === id)?.label}
            </button>
          ))}
        </div>
        <div className="live-deck-arrows">
          <IconButton icon={RefreshCw} label={reader ? '刷新资料' : '刷新会话'} onClick={onRefresh} />
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
          <IconButton icon={X} label={reader ? '关闭资料阅读' : '关闭会话视窗'} onClick={close} />
        </div>
      </header>
      <div
        className="deck-scroller live-deck-scroller"
        ref={scroller}
        style={{ '--deck-gap': `${deckSpacing.gap}px` } as CSSProperties}
      >
        {navigation && (
          <DeckCard {...common('list')} kind="list" label="会话列表卡片" tabLabel="会话列表">
            {navigation}
          </DeckCard>
        )}
        <OrderedDeckCards order={movableOrder}>
          <DeckCard
            {...common('conversation')}
            kind="conversation"
            label={reader ? '资料正文 ' + title : '当前会话'}
            className={fullscreen === 'conversation' ? 'live-reader-fullscreen' : ''}
            stackTitle={title}
            cardRef={center}
            defaultWidth={conversationDefaultWidth(
              deckSize.width,
              navigation ? deckSize.list : 0,
              cards.map((c) => widths[c.id] || (c.kind === 'source' ? 440 : 400)),
            )}
          >
            {reader ? (
              <>
                <header className="deck-card-header live-card-heading">
                  <div>
                    <small>资料卡片</small>
                    <h2>{title}</h2>
                  </div>
                  <div className="live-card-actions">
                    {mainActions}
                    <IconButton
                      icon={fullscreen === 'conversation' ? Minimize2 : Maximize2}
                      label={fullscreen === 'conversation' ? '退出正文全屏' : '全屏查看资料正文'}
                      onClick={(e) => {
                        fullscreenTrigger.current = e.currentTarget;
                        setFullscreen(fullscreen === 'conversation' ? undefined : 'conversation');
                      }}
                    />
                  </div>
                </header>
                <div className="live-source-reader" data-scroll-key="reader">
                  {children}
                </div>
              </>
            ) : (
              children
            )}
          </DeckCard>
          {cards.map((card) => (
            <DeckCard
              key={card.id}
              {...common(card.id)}
              kind={card.kind === 'properties' ? 'file' : card.kind}
              label={card.label}
              stackTitle={card.title}
              className={fullscreen === card.id ? 'live-reader-fullscreen' : ''}
            >
              <header className="deck-card-header live-card-heading">
                <div>
                  <small>
                    {card.kind === 'source'
                      ? '画报卡片'
                      : card.kind === 'properties'
                        ? '属性卡片'
                        : '资料卡片'}
                  </small>
                  <h2 title={card.title}>{card.title}</h2>
                </div>
                <div className="live-card-actions">
                  {card.actions}
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
                      if (requestNavigationLocked()) return;
                      setFullscreen(undefined);
                      card.close();
                      restore(card.id, card.parentId);
                    }}
                  />
                </div>
              </header>
              <div className="live-source-reader" data-scroll-key={card.id}>
                {card.content}
              </div>
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
