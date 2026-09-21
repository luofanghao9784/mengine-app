import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
import { BriefingCardBody } from '../pages/Briefing';
import { Conversation } from '../pages/Conversation';
import { animateBriefingMorph, captureBriefingVisual } from './conversationMotion';
import { ConversationListCard } from './ConversationListCard';
import { DeckCard } from './DeckCard';
import { MaterialPreview } from './MaterialView';
import { NewConversation } from './NewConversation';
import { IconButton } from './ui';

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
  filePreferences: RefObject<Record<string, { extra: string[]; hidden: string[] }>>;
  newConversationRequest: number;
}) {
  const { state } = useDemo();
  const ui = useUI();
  const [page, id] = route.split('/');
  const chat = page === 'chat' ? state.chats.find((item) => item.id === id) : undefined;
  const context = chat?.briefingContext;
  const reference: BriefingReference | undefined =
    context && canReadCardData(state, context.snapshot)
      ? {
          cardId: context.cardId,
          asOf: context.asOf,
          snapshot: context.snapshot,
          config: context.display || {
            title: context.snapshot.title,
            size: context.snapshot.size,
            compact: false,
          },
        }
      : undefined;
  const [mobileCard, setMobileCard] = useState('conversation');
  const [focusFile, setFocusFile] = useState<{ id: string; nonce: number } | null>(null);
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [folds, setFolds] = useState<Record<string, { covered: boolean; folded: boolean }>>({});
  const cardPositions = useRef<Record<string, number>>({});
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [, redraw] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
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
    scroller.current.scrollTo({
      left: cardId === 'list' || cardId === 'conversation' ? 0 : cardPositions.current[cardId] || 0,
      behavior: duration() ? 'smooth' : 'instant',
    });
  };
  useEffect(() => {
    setMobileCard('conversation');
    scroller.current?.scrollTo({ left: 0, behavior: 'instant' });
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
    const cards = Array.from(element.querySelectorAll<HTMLElement>('[data-deck-id]'));
    const tail = element.querySelector<HTMLElement>('.deck-scroll-tail')!;
    const update = () => {
      const previousExtent = element.scrollWidth;
      const atEnd =
        element.scrollLeft > 0 && element.scrollLeft + element.clientWidth >= element.scrollWidth - 4;
      const mobile = matchMedia('(max-width: 1000px)').matches;
      const centerWidth = center.current?.offsetWidth || 560;
      const rightCount = cards.length - 2;
      const spine = Math.min(
        24,
        Math.max(16, (element.clientWidth - centerWidth - 24 - 16 - 326) / Math.max(1, rightCount - 1)),
      );
      let naturalLeft = 3;
      let lastAnchor = 3;
      cards.forEach((card, index) => {
        const anchor = index === 0 ? 3 : index === 1 ? 27 : 27 + centerWidth + 16 + (index - 2) * spine;
        card.style.setProperty('--stack-left', `${anchor}px`);
        card.style.setProperty('--stack-order', String(index + 1));
        card.style.setProperty('--spine-width', `${index === 0 ? 24 : spine}px`);
        cardPositions.current[card.dataset.deckId!] = Math.max(0, naturalLeft - anchor);
        naturalLeft += card.offsetWidth + 16;
        lastAnchor = anchor;
      });
      tail.style.width = mobile
        ? '0px'
        : `${Math.max(0, element.clientWidth - (cards.at(-1)?.offsetWidth || 0) - lastAnchor - 3)}px`;
      // A new anchor can release width that was constrained by the previous viewport.
      // If the user reached the end, follow the new end instead of leaving the last file clipped.
      if (atEnd && !mobile && Math.abs(element.scrollWidth - previousExtent) > 1)
        element.scrollTo({ left: element.scrollWidth, behavior: 'instant' });
      const nextFolds: Record<string, { covered: boolean; folded: boolean }> = {};
      cards.forEach((card, index) => {
        let fade = 0;
        if (index !== 1 && index !== cards.length - 1 && !mobile) {
          const current = card.getBoundingClientRect();
          const next = cards[index + 1].getBoundingClientRect();
          const visibleSpine = index === 0 ? 24 : spine;
          const overlap = Math.max(0, current.right - next.left);
          const coverage = Math.min(1, overlap / Math.max(1, current.width - visibleSpine));
          // Remain sharp through the first half, then dissolve with the actual
          // overlap. Updating CSS directly keeps rapid reversals tied to scroll.
          const progress = Math.max(0, (coverage - 0.5) * 2);
          fade = progress * progress * (3 - 2 * progress);
          nextFolds[card.dataset.deckId!] = {
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
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    cards.forEach((card) => observer.observe(card));
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [fileKey, reference?.cardId, route, phase]);
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
  // Horizontal gestures belong to the whole workspace, including its blank canvas
  // and toolbar. Vertical reading, pinch zoom and inner dialogs retain their input.
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      const deck = scroller.current;
      if (
        !deck ||
        closing ||
        event.defaultPrevented ||
        event.ctrlKey ||
        matchMedia('(max-width: 1000px)').matches ||
        document.querySelector('dialog[open]')
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="listbox"], [role="menu"], [data-anchored-popover]')) return;
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal || deck.scrollWidth <= deck.clientWidth) return;
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!delta) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? deck.clientWidth
            : 1;
      event.preventDefault();
      deck.scrollBy({ left: delta * unit, behavior: 'instant' });
    };
    document.addEventListener('wheel', wheel, { passive: false });
    return () => document.removeEventListener('wheel', wheel);
  }, [closing]);
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
      if (priorFocus?.isConnected && !priorFocus.closest('[inert]'))
        priorFocus.focus({ preventScroll: true });
    };
  }, []);
  // Capture actual typography and layout instead of rendering another card at the
  // destination size. No live message content is scaled or scrolled during travel.
  useLayoutEffect(() => {
    const element = center.current;
    if (!element) return;
    const ms = duration();
    const source = initialOrigin.current?.element;
    const targetRect = element.getBoundingClientRect();
    const sourceRect = source?.getBoundingClientRect();
    const draft = initialDraftOrigin.current;
    const animations =
      morph.current && draft
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
      phase === 'entering' && entranceAnimations.current.some((a) => a.playState === 'running');
    cancelEntrance.current(reversing);
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
  const closeFile = (fileId: string) => {
    prefs.hidden.push(fileId);
    setMobileCard('conversation');
    redraw((value) => value + 1);
  };
  const scrollBy = (direction: number) =>
    scroller.current?.scrollBy({ left: direction * 380, behavior: duration() ? 'smooth' : 'instant' });
  return (
    <div
      className={`conversation-overlay presentation-${presentation} phase-${phase}`}
      ref={root}
      data-phase={phase}
      data-presentation={presentation}
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
          <button onClick={() => showCard('conversation')} aria-pressed={mobileCard === 'conversation'}>
            对话
          </button>
          {reference && (
            <button onClick={() => showCard('source')} aria-pressed={mobileCard === 'source'}>
              画报卡片
            </button>
          )}
          {files.map((file) => (
            <button
              key={file.id}
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
        <DeckCard
          id="conversation"
          kind="conversation"
          label="当前会话"
          width={widths.current.conversation}
          onWidth={(width) => changeWidth('conversation', width)}
          active={mobileCard === 'conversation'}
          cardRef={center}
        >
          <header className="deck-card-header conversation-card-header">
            <div className="min-zero">
              <h1>{chat?.title || (page === 'chat' ? '会话暂不可用' : '新会话')}</h1>
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
            id="source"
            kind="source"
            label="画报卡片"
            width={widths.current.source}
            onWidth={(width) => changeWidth('source', width)}
            active={mobileCard === 'source'}
            {...folds.source}
            tabLabel="画报卡片"
            onExpand={() => showCard('source')}
          >
            <header className="deck-card-header">
              <strong>画报卡片</strong>
              <MessageSquare size={16} />
            </header>
            <div className="deck-source-scroll">
              <article
                className={`briefing-card template-${reference.snapshot.template}`}
                data-size={reference.config.size}
              >
                <div className="briefing-card-main">
                  <BriefingCardBody data={reference.snapshot} config={reference.config} at={reference.asOf} />
                </div>
              </article>
              <p className="deck-source-note">
                打开时的画报内容 · {new Date(reference.asOf).toLocaleDateString('zh-CN')}
              </p>
              {reference.snapshot.refs?.map((fileId) => {
                const file = state.materials.find(
                  (material) => material.id === fileId && canReadMaterial(state, material),
                );
                return (
                  file && (
                    <button className="source-chip" key={fileId} onClick={() => ui.preview(fileId)}>
                      {file.title}
                      <ArrowRight size={13} />
                    </button>
                  )
                );
              })}
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
        <div className="deck-scroll-tail" aria-hidden="true" />
      </div>
      {(initialOrigin.current || initialDraftOrigin.current) && (
        <div ref={morph} aria-hidden="true" inert className="conversation-morph" />
      )}
    </div>
  );
}
