import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Ellipsis, MessageSquare, X } from 'lucide-react';
import { canReadCardData, type BriefingReference } from '../briefing';
import { canReadMaterial } from '../libraryModel';
import {
  useDemo,
  useUI,
  type ConversationOrigin,
  type DraftConversationOrigin,
  type ConversationPresentation,
} from '../store';
import { BriefingArticle } from './BriefingArticle';
import { Conversation } from '../pages/Conversation';
import { animateBriefingMorph, animateDetailToSource, captureBriefingVisual } from './conversationMotion';
import { ConversationListCard } from './ConversationListCard';
import { DeckCard, OrderedDeckCards } from './DeckCard';
import { MaterialPreview } from './MaterialView';
import { NewConversation } from './NewConversation';
import { IconButton } from './ui';
import { conversationDefaultWidth, deckOrder, deckSpacing } from '../conversationDeck';
import { useDeckReorder } from './useDeckReorder';
import { useDeckReflow } from './useDeckReflow';
import { useDeckElasticScroll } from './useDeckElasticScroll';
import { useDeckReveal } from './useDeckReveal';
import { DeckStackHint } from './DeckStackHint';

const OPEN_DURATION = 420;
const CLOSE_DURATION = 280;
const duration = (closing = false) =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : closing ? CLOSE_DURATION : OPEN_DURATION;

export function ConversationOverlay({
  presentation,
  route,
  origin,
  draftOrigin,
  closing,
  onClose,
  onClosed,
  previewRequest,
  widths,
  orders,
  filePreferences,
  newConversationRequest,
}: {
  presentation: ConversationPresentation;
  route: string;
  origin: ConversationOrigin | null;
  draftOrigin: DraftConversationOrigin | null;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  previewRequest: { id: string; versionId?: string; nonce: number } | null;
  widths: RefObject<Record<string, number>>;
  orders: RefObject<Record<string, string[]>>;
  filePreferences: RefObject<Record<string, { extra: string[]; hidden: string[] }>>;
  newConversationRequest: number;
}) {
  const { state } = useDemo();
  const ui = useUI();
  const [page, id] = route.split('/');
  const chat = page === 'chat' ? state.chats.find((item) => item.id === id) : undefined;
  const context = chat?.briefingContext;
  const chatTitle = chat?.title || (page === 'chat' ? '会话暂不可用' : '新会话');
  const reference: BriefingReference | undefined =
    context && canReadCardData(state, context.snapshot)
      ? {
          cardId: context.cardId,
          asOf: context.asOf,
          snapshot: context.snapshot,
          article: context.article,
          config: context.display || {
            title: context.snapshot.title,
            size: context.snapshot.size,
            compact: false,
          },
        }
      : origin?.surface === 'detail' && canReadCardData(state, origin.reference.snapshot)
        ? origin.reference
        : undefined;
  const [mobileCard, setMobileCard] = useState('conversation');
  const [focusFile, setFocusFile] = useState<{ id: string; nonce: number } | null>(null);
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [folds, setFolds] = useState<Record<string, { covered: boolean; folded: boolean; clipped: boolean }>>(
    {},
  );
  const cardScrollRanges = useRef<Record<string, { from: number; to: number }>>({});
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [, redraw] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [deckSize, setDeckSize] = useState({ width: innerWidth - 112, list: 240 });
  const center = useRef<HTMLElement>(null);
  const morph = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const cancelEntrance = useRef<(preserve?: boolean) => void>(() => {});
  const entranceAnimations = useRef<Animation[]>([]);
  const initialOrigin = useRef(origin);
  const initialDraftOrigin = useRef(draftOrigin);
  const handledPreview = useRef(previewRequest?.nonce);
  const [fileVersions, setFileVersions] = useState<Record<string, { versionId?: string; nonce: number }>>({});
  const callbacks = useRef({ onClose, onClosed });
  callbacks.current = { onClose, onClosed };
  const prefs = (filePreferences.current[route] ||= { extra: [], hidden: [] });
  const generated = chat?.messages.flatMap((message) => (message.doc ? [message.doc] : [])) || [];
  const pinnedVersions = chat
    ? (Object.assign({}, ...chat.messages.map((message) => message.refVersions || {})) as Record<
        string,
        string
      >)
    : Object.fromEntries(
        Object.entries(ui.newDraft.refVersions || {}).filter(([fileId]) => ui.newDraft.refs.includes(fileId)),
      );
  generated.push(...Object.keys(pinnedVersions));
  if (reference?.snapshot.sourceKind === 'material') generated.push(reference.snapshot.sourceId);
  const files = [...new Set([...generated, ...prefs.extra])]
    .filter((fileId) => !prefs.hidden.includes(fileId))
    .map((fileId) =>
      state.materials.find((material) => material.id === fileId && canReadMaterial(state, material)),
    )
    .filter((material) => !!material);
  const fileKey = files.map((file) => file.id).join('|');
  const savedOrder = deckOrder(
    ['conversation', ...(reference ? ['source'] : []), ...files.map((file) => file.id)],
    orders.current[route],
  );
  const defaultConversationWidth = conversationDefaultWidth(deckSize.width, deckSize.list, [
    ...(reference ? [widths.current.source || 440] : []),
    ...files.map((file) => widths.current[`file:${file.id}`] || 400),
  ]);
  const reflow = useDeckReflow(scroller, route);
  const { message: moveMessage, order: movableOrder } = useDeckReorder(
    scroller,
    route,
    savedOrder,
    (next) => {
      orders.current[route] = next;
      redraw((value) => value + 1);
    },
    reflow,
  );
  const orderKey = movableOrder.join('|');
  useDeckElasticScroll(scroller, `${route}|${orderKey}`, phase === 'open' && !closing, reflow.bounds);
  const orderOf = (cardId: string) => movableOrder.indexOf(cardId) + 1;
  useEffect(() => {
    if (
      (mobileCard === 'source' && !reference) ||
      (!['source', 'list', 'conversation'].includes(mobileCard) &&
        !files.some((file) => file.id === mobileCard))
    )
      setMobileCard('conversation');
  }, [fileKey, mobileCard, !!reference]);
  const showCard = (cardId: string, focus = true) => {
    setMobileCard(cardId);
    if (matchMedia('(max-width: 1000px)').matches) return;
    const target = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-deck-id]') || []).find(
      (element) => element.dataset.deckId === cardId,
    );
    if (!target || !scroller.current) return;
    if (focus) target.focus({ preventScroll: true });
    const range = cardScrollRanges.current[cardId] || { from: 0, to: 0 };
    scroller.current.scrollTo({
      // Move only as far as needed to fit the whole card, while staying before
      // the point at which the following card would begin covering it.
      left: Math.max(range.from, Math.min(range.to, scroller.current.scrollLeft)),
      behavior: duration() ? 'smooth' : 'instant',
    });
  };
  useDeckReveal(scroller, `${route}|${orderKey}`, phase === 'open' && !closing, showCard);
  useEffect(() => {
    setMobileCard('conversation');
    scroller.current?.scrollTo({
      left: origin?.surface === 'detail' ? cardScrollRanges.current.source?.from || 0 : 0,
      behavior: 'instant',
    });
  }, [route, newConversationRequest]);
  useEffect(() => {
    if (!previewRequest || handledPreview.current === previewRequest.nonce) return;
    handledPreview.current = previewRequest.nonce;
    if (
      !state.materials.some(
        (material) => material.id === previewRequest.id && canReadMaterial(state, material),
      )
    )
      return;
    prefs.extra = [...new Set([...prefs.extra, previewRequest.id])];
    prefs.hidden = prefs.hidden.filter((fileId) => fileId !== previewRequest.id);
    setFileVersions((versions) => ({
      ...versions,
      [route + ':' + previewRequest.id]: { versionId: previewRequest.versionId, nonce: previewRequest.nonce },
    }));
    redraw((value) => value + 1);
    setFocusFile(previewRequest);
  }, [previewRequest]);
  // Each following card covers the previous one while leaving a clickable spine.
  // Keep natural scroll positions separate from sticky offsets, including after resizing.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const cards = Array.from(element.querySelectorAll<HTMLElement>('[data-deck-id]')).sort(
      (a, b) => Number(a.dataset.deckOrder) - Number(b.dataset.deckOrder),
    );
    const tail = element.querySelector<HTMLElement>('.deck-scroll-tail')!;
    const update = () => {
      const previousExtent = element.scrollWidth;
      const atEnd =
        element.scrollLeft > 0 && element.scrollLeft + element.clientWidth >= element.scrollWidth - 4;
      const mobile = matchMedia('(max-width: 1000px)').matches;
      const nextSize = { width: element.clientWidth, list: cards[0]?.offsetWidth || 240 };
      if (!mobile)
        setDeckSize((prior) =>
          prior.width === nextSize.width && prior.list === nextSize.list ? prior : nextSize,
        );
      const centerWidth = center.current?.offsetWidth || 560;
      const { gap, spine, padding } = deckSpacing;
      const conversationIndex = cards.findIndex((card) => card.dataset.deckId === 'conversation');
      const following = cards.length - conversationIndex - 1;
      element.style.setProperty(
        '--conversation-cap',
        `${Math.max(420, element.clientWidth - padding * 2 - spine - Math.max(0, conversationIndex - 1) * spine - (following ? 320 + gap + (following - 1) * spine : 0))}px`,
      );
      const total =
        cards.reduce((sum, card) => sum + card.offsetWidth, 0) + (cards.length - 1) * gap + padding * 2;
      // Center the whole deck so the list has the same gap as every other card.
      // A new chat still prioritizes centering the editor, with its list beside it.
      const cluster = page === 'home';
      const inset = mobile
        ? 0
        : cluster && cards.length === 2
          ? Math.max(0, (element.clientWidth - centerWidth) / 2 - cards[0].offsetWidth - gap - padding)
          : Math.max(0, (element.clientWidth - total) / 2);
      cards.forEach((card, index) => {
        card.style.marginLeft = index === 0 && !mobile ? `${inset}px` : '0px';
      });
      let naturalLeft = padding;
      let lastAnchor: number = padding;
      cards.forEach((card, index) => {
        const anchor =
          index === 0
            ? padding
            : index === 1
              ? padding + spine
              : lastAnchor +
                (cards[index - 1].dataset.deckId === 'conversation'
                  ? center.current!.offsetWidth + gap
                  : spine);
        // Sticky offsets start at the rail's padding edge. Do not count that
        // padding twice, which would push the list into the first card's gap.
        card.style.setProperty('--stack-left', `${anchor - padding}px`);
        card.style.setProperty('--stack-order', String(index + 1));
        card.style.setProperty('--spine-width', `${spine}px`);
        if (index === 0) naturalLeft += inset;
        cardScrollRanges.current[card.dataset.deckId!] = {
          from: Math.max(0, naturalLeft + card.offsetWidth + padding - element.clientWidth),
          to: Math.max(0, naturalLeft - anchor),
        };
        naturalLeft += card.offsetWidth + gap;
        lastAnchor = anchor;
      });
      tail.style.width =
        mobile || total <= element.clientWidth
          ? '0px'
          : `${Math.max(0, element.clientWidth - (cards.at(-1)?.offsetWidth || 0) - lastAnchor - padding)}px`;
      // A new anchor can release width that was constrained by the previous viewport.
      // If the user reached the end, follow the new end instead of leaving the last file clipped.
      if (atEnd && !mobile && Math.abs(element.scrollWidth - previousExtent) > 1)
        element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
      const nextFolds: Record<string, { covered: boolean; folded: boolean; clipped: boolean }> = {};
      const viewport = element.getBoundingClientRect();
      cards.forEach((card, index) => {
        let fade = 0;
        const current = reflow.bounds(card);
        nextFolds[card.dataset.deckId!] = {
          covered: false,
          folded: false,
          clipped:
            !mobile &&
            (current.left < viewport.left - 1 || current.right > viewport.left + element.clientWidth + 1),
        };
        if (index !== cards.length - 1 && !mobile) {
          const next = reflow.bounds(cards[index + 1]);
          const visibleSpine = spine;
          const overlap = Math.max(0, current.right - next.left);
          const coverage = Math.min(1, overlap / Math.max(1, current.width - visibleSpine));
          // Remain sharp through the first half, then dissolve with the actual
          // overlap. Updating CSS directly keeps rapid reversals tied to scroll.
          const progress = Math.max(0, (coverage - 0.5) * 2);
          fade = progress * progress * (3 - 2 * progress);
          nextFolds[card.dataset.deckId!] = {
            ...nextFolds[card.dataset.deckId!],
            covered: next.left < current.right - 1,
            folded: next.left - current.left <= visibleSpine + 1,
          };
        }
        // Also clear reused cards when the last file closes or the viewport
        // switches to one-card navigation.
        card.toggleAttribute('data-folding', fade > 0);
        card.style.setProperty('--fold-blur', `${(fade * 8).toFixed(3)}px`);
        card.style.setProperty('--fold-opacity', (1 - fade).toFixed(4));
      });
      setFolds((prior) => (JSON.stringify(prior) === JSON.stringify(nextFolds) ? prior : nextFolds));
      setCanScrollLeft(!mobile && element.scrollLeft > 1);
      setCanScrollRight(!mobile && element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
    };
    update();
    reflow.animate();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    cards.forEach((card) => observer.observe(card));
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [fileKey, reference?.cardId, route, phase, orderKey]);
  useLayoutEffect(() => {
    if (!focusFile || !files.some((file) => file.id === focusFile.id)) return;
    showCard(focusFile.id);
    setFocusFile(null);
  }, [focusFile, fileKey]);
  useLayoutEffect(() => {
    const source = initialOrigin.current?.element;
    source?.classList.add('conversation-origin-active');
    return () => source?.classList.remove('conversation-origin-active');
  }, []);
  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        callbacks.current.onClose();
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.sidebar button, .conversation-overlay button, .conversation-overlay textarea, .conversation-overlay input, .conversation-overlay select, .conversation-overlay [tabindex="0"]',
          ),
        ).filter(
          (element) =>
            !element.closest('[inert]') &&
            !element.matches(':disabled') &&
            element.getClientRects().length > 0,
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      const returnFocus = initialOrigin.current?.returnFocus || priorFocus;
      requestAnimationFrame(() => {
        if (returnFocus?.isConnected && !returnFocus.closest('[inert]'))
          returnFocus.focus({ preventScroll: true });
      });
    };
  }, []);
  // Capture actual typography and layout instead of rendering another card at the
  // destination size. No live message content is scaled or scrolled during travel.
  useLayoutEffect(() => {
    const element = center.current;
    if (!element) return;
    const ms = duration();
    const source = initialOrigin.current?.element;
    const sourcePane = root.current?.querySelector<HTMLElement>('.deck-source');
    const detailOrigin = initialOrigin.current?.surface === 'detail' ? initialOrigin.current : null;
    if (detailOrigin && sourcePane) {
      if (!matchMedia('(max-width: 1000px)').matches)
        scroller.current?.scrollTo({ left: cardScrollRanges.current.source?.from || 0, behavior: 'instant' });
      const sourceScroll = sourcePane.querySelector<HTMLElement>('.deck-source-scroll');
      if (sourceScroll) sourceScroll.scrollTop = detailOrigin.readingScroll || 0;
    }
    const targetRect = element.getBoundingClientRect();
    const sourceRect = source?.getBoundingClientRect();
    const draft = initialDraftOrigin.current;
    const animations =
      morph.current && detailOrigin?.visual && sourcePane
        ? animateDetailToSource(morph.current, sourcePane, detailOrigin.visual, ms)
        : morph.current && draft
          ? animateBriefingMorph(morph.current, element, draft.visual, targetRect, ms)
          : morph.current && sourceRect && source?.isConnected && sourceRect.width > 0
            ? animateBriefingMorph(
                morph.current,
                element,
                initialOrigin.current?.visual || captureBriefingVisual(source),
                targetRect,
                ms,
              )
            : [
                element.animate(
                  [
                    { opacity: 0, transform: 'translateY(12px) scale(.97)' },
                    { opacity: 1, transform: 'none' },
                  ],
                  { duration: ms, easing: 'ease-out', fill: 'both' },
                ),
              ];
    if (draft) {
      const input = element.querySelector<HTMLTextAreaElement>('.draft-composer textarea');
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(draft.selectionStart, draft.selectionEnd, draft.selectionDirection);
    }
    entranceAnimations.current = animations;
    let cancelled = false;
    Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (cancelled) return;
      // Hide the snapshot before removing its final opacity; waiting for React's
      // phase update here used to expose one fully opaque frame of the old content.
      if (morph.current) morph.current.style.display = 'none';
      animations.forEach((animation) => animation.cancel());
      setPhase('open');
      if (!root.current?.contains(document.activeElement) && !document.querySelector('dialog[open]'))
        closeButton.current?.focus({ preventScroll: true });
    });
    cancelEntrance.current = (preserve = false) => {
      cancelled = true;
      if (!preserve) animations.forEach((animation) => animation.cancel());
    };
    return () => cancelEntrance.current();
  }, []);
  useLayoutEffect(() => {
    // Keep fast typing visible while the inert entry snapshot is travelling.
    if (phase !== 'entering' || !initialDraftOrigin.current) return;
    const input = morph.current?.querySelector('textarea');
    if (input) input.value = ui.newDraft.text;
  }, [ui.newDraft.text, phase]);
  useLayoutEffect(() => {
    if (!closing || !center.current) return;
    const reversing =
      origin?.surface !== 'detail' &&
      phase === 'entering' &&
      entranceAnimations.current.some((a) => a.playState === 'running');
    cancelEntrance.current(reversing);
    if (origin?.surface === 'detail' && morph.current) morph.current.style.display = 'none';
    setPhase('closing');
    const element =
      center.current.getBoundingClientRect().width > 0
        ? center.current
        : root.current?.querySelector<HTMLElement>('.deck-card.mobile-active') || center.current;
    const source = origin?.element;
    const sourceRect = source?.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const ms = duration(true);
    const validSource =
      origin?.surface !== 'detail' &&
      source?.isConnected &&
      sourceRect &&
      sourceRect.bottom > 0 &&
      sourceRect.top < innerHeight &&
      sourceRect.width > 0 &&
      targetRect.width > 0 &&
      targetRect.height > 0;
    let animations: Animation[];
    if (reversing) {
      animations = entranceAnimations.current;
      animations.forEach((animation) => {
        animation.reverse();
        animation.updatePlaybackRate(-OPEN_DURATION / CLOSE_DURATION);
      });
    } else if (validSource && morph.current) {
      animations = animateBriefingMorph(
        morph.current,
        element,
        captureBriefingVisual(source),
        targetRect,
        ms,
        true,
      );
    } else {
      animations = [
        element.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(10px) scale(.97)' }], {
          duration: ms,
          easing: 'cubic-bezier(.4,0,.2,1)',
          fill: 'both',
        }),
      ];
    }
    // Continue from the painted entrance frame on quick closes. Keep every side
    // card in the DOM until its fade finishes, including partially folded files.
    const companions = root.current?.querySelectorAll<HTMLElement>(
      '.deck-list, .deck-source, .deck-file, .deck-toolbar',
    );
    companions?.forEach((card) => {
      // A phone can use its active source/file as the returning morph surface.
      // That element already has its own opacity animation above.
      if (card === element || !card.getClientRects().length) return;
      const style = getComputedStyle(card);
      animations.push(
        card.animate(
          [
            { opacity: style.opacity, translate: style.translate },
            { opacity: 0, translate: card.matches('.deck-toolbar') ? 'none' : '0 10px' },
          ],
          { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' },
        ),
      );
    });
    let cancelled = false;
    Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (!cancelled) callbacks.current.onClosed();
    });
    return () => {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
      setPhase('open');
    };
  }, [closing]);
  const changeWidth = (key: string, width: number) => {
    widths.current[key] = width;
    redraw((value) => value + 1);
  };
  const resetWidth = (key: string) => {
    delete widths.current[key];
    redraw((value) => value + 1);
  };
  const closeFile = (fileId: string) => {
    prefs.hidden.push(fileId);
    setMobileCard('conversation');
    redraw((value) => value + 1);
  };
  const scrollBy = (direction: number) =>
    scroller.current?.scrollBy({ left: direction * 380, behavior: duration() ? 'smooth' : 'instant' });
  return (
    <div
      className={`conversation-overlay presentation-${presentation} phase-${phase} ${initialOrigin.current?.surface === 'detail' ? 'from-briefing-detail' : ''}`}
      ref={root}
      data-phase={phase}
      data-presentation={presentation}
      style={{ '--deck-padding': `${deckSpacing.padding}px` } as CSSProperties}
      role={presentation === 'page' ? 'region' : 'dialog'}
      aria-label={presentation === 'page' ? '会话页面' : '会话工作区'}
      aria-modal={presentation === 'overlay' ? false : undefined}
    >
      {presentation === 'overlay' && (
        <div className="conversation-scrim" data-testid="conversation-backdrop" onClick={onClose} />
      )}
      <header className="topbar deck-toolbar">
        <div className="row min-zero topbar-heading">
          <h1 className="topbar-title">会话视窗</h1>
        </div>
        <div className="deck-mobile-tabs" aria-label="会话卡片切换">
          <button onClick={() => showCard('list')} aria-pressed={mobileCard === 'list'}>
            列表
          </button>
          <button
            style={{ order: orderOf('conversation') }}
            onClick={() => showCard('conversation')}
            aria-pressed={mobileCard === 'conversation'}
          >
            对话
          </button>
          {reference && (
            <button
              style={{ order: orderOf('source') }}
              onClick={() => showCard('source')}
              aria-pressed={mobileCard === 'source'}
            >
              画报卡片
            </button>
          )}
          {files.map((file) => (
            <button
              key={file.id}
              style={{ order: orderOf(file.id) }}
              onClick={() => showCard(file.id)}
              aria-pressed={mobileCard === file.id}
              title={file.title}
            >
              {file.title}
            </button>
          ))}
        </div>
        <div className="deck-controls">
          <IconButton
            icon={ArrowLeft}
            label="向左查看卡片"
            onClick={() => scrollBy(-1)}
            disabled={!canScrollLeft}
          />
          <IconButton
            icon={ArrowRight}
            label="向右查看卡片"
            onClick={() => scrollBy(1)}
            disabled={!canScrollRight}
          />
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="关闭会话"
            title="关闭会话"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div
        className="deck-scroller"
        ref={scroller}
        style={{ '--deck-gap': `${deckSpacing.gap}px` } as CSSProperties}
        onClick={(event) => {
          if (presentation === 'overlay' && event.target === event.currentTarget) onClose();
        }}
      >
        <ConversationListCard
          active={mobileCard === 'list'}
          {...folds.list}
          onExpand={() => showCard('list')}
          onSelect={() => setMobileCard('conversation')}
        />
        <OrderedDeckCards order={movableOrder}>
          <DeckCard
            key="conversation"
            id="conversation"
            kind="conversation"
            label="当前会话"
            stackTitle={chatTitle}
            width={widths.current.conversation}
            defaultWidth={defaultConversationWidth}
            order={orderOf('conversation')}
            onResetWidth={() => resetWidth('conversation')}
            onWidth={(width) => changeWidth('conversation', width)}
            active={mobileCard === 'conversation'}
            cardRef={center}
            {...folds.conversation}
            onExpand={() => showCard('conversation')}
          >
            <header className="deck-card-header conversation-card-header">
              <div className="min-zero">
                <h1 title={chatTitle}>{chatTitle}</h1>
              </div>
              {chat && (
                <IconButton
                  icon={Ellipsis}
                  label="会话选项"
                  aria-haspopup="dialog"
                  onClick={(event) =>
                    ui.open({ kind: 'chat-options', id: chat.id, anchor: event.currentTarget })
                  }
                />
              )}
            </header>
            <main className="chat-main" key={route}>
              {chat ? (
                <Conversation chatId={chat.id} />
              ) : page === 'home' ? (
                <NewConversation space={id} />
              ) : (
                <div className="quiet-empty">会话不存在或已不可用，请从列表选择其他会话。</div>
              )}
            </main>
          </DeckCard>
          {reference && (
            <DeckCard
              key="source"
              id="source"
              kind="source"
              label="画报卡片"
              width={widths.current.source}
              order={orderOf('source')}
              onResetWidth={() => resetWidth('source')}
              onWidth={(width) => changeWidth('source', width)}
              active={mobileCard === 'source'}
              {...folds.source}
              tabLabel="画报卡片"
              stackTitle={reference.config.title}
              onExpand={() => showCard('source')}
            >
              <header className="deck-card-header">
                <strong>画报卡片</strong>
                <MessageSquare size={16} />
              </header>
              <div className="deck-source-scroll">
                <BriefingArticle
                  reference={reference}
                  embedded
                  onSource={(id) => ui.preview(id, pinnedVersions[id])}
                />
              </div>
            </DeckCard>
          )}
          {files.map((file) => (
            <DeckCard
              key={file.id}
              id={file.id}
              kind="file"
              label={`文件 ${file.title}`}
              width={widths.current[`file:${file.id}`]}
              order={orderOf(file.id)}
              onResetWidth={() => resetWidth(`file:${file.id}`)}
              onWidth={(width) => changeWidth(`file:${file.id}`, width)}
              active={mobileCard === file.id}
              {...folds[file.id]}
              tabLabel={file.title}
              onExpand={() => showCard(file.id)}
            >
              <MaterialPreview
                id={file.id}
                initialVersionId={
                  Object.prototype.hasOwnProperty.call(fileVersions, route + ':' + file.id)
                    ? fileVersions[route + ':' + file.id].versionId
                    : pinnedVersions[file.id]
                }
                versionRequest={fileVersions[route + ':' + file.id]?.nonce}
                onClose={() => closeFile(file.id)}
              />
            </DeckCard>
          ))}
        </OrderedDeckCards>
        <div className="deck-scroll-tail" aria-hidden="true" />
      </div>
      <DeckStackHint
        scroller={scroller}
        layoutKey={`${route}|${orderKey}`}
        enabled={phase === 'open' && !closing}
      />
      <div className="deck-move-status" role="status" aria-live="polite">
        {moveMessage}
      </div>
      {(initialOrigin.current || initialDraftOrigin.current) && (
        <div ref={morph} aria-hidden="true" inert className="conversation-morph" />
      )}
    </div>
  );
}
