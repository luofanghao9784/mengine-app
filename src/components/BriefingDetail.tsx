import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ThumbsUp, ThumbsDown, Star, Share2, MessageSquare, X } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { canReadCardData, openBriefingChat, type BriefingReference } from '../briefing';
import {
  currentFeedback,
  briefingContentVersion,
  feedbackReasonLabel,
  markBriefingRead,
  openFeedbackConversation,
  setBriefingFeedback,
  type FeedbackReason,
} from '../briefingFeedback';
import { magazineType } from '../briefingMagazine';
import { withBriefingArticle } from '../briefingArticle';
import { BriefingArticle } from './BriefingArticle';
import { spaceName } from '../model';
import { captureDetailVisual } from './conversationMotion';
import { NavIconButton, useNavHover, useNavLabelSide } from './NavIconButton';
import { BriefingReasonPopover } from './BriefingReasonPopover';
import { BriefingShareDialog } from './BriefingShareDialog';
import { useBriefingDetailWidth } from './useBriefingDetailWidth';

export function BriefingDetail({
  reference: suppliedReference,
  onClose,
  onEnterConversation,
  returnFocus,
}: {
  reference: BriefingReference;
  onClose: () => void;
  onEnterConversation: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const { state, change } = useDemo();
  const reference = withBriefingArticle(suppliedReference);
  const ui = useUI();
  const dialog = useRef<HTMLDialogElement>(null);
  const readingCard = useRef<HTMLDivElement>(null);
  const actionRail = useRef<HTMLDivElement>(null);
  const labelSide = useNavLabelSide(actionRail);
  const shareTrigger = useRef<HTMLButtonElement | null>(null);
  const { expanded, interaction } = useNavHover(actionRail, reference.cardId);
  const [panel, setPanel] = useState<'reasons' | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notice, setNotice] = useState<{ action: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const sizing = useBriefingDetailWidth();
  const notify = (action: string, text: string) => setNotice({ action, text });
  const closeReasons = (restoreFocus = false) => {
    setPanel(null);
    if (restoreFocus)
      actionRail.current
        ?.querySelector<HTMLButtonElement>('.briefing-useless-action button')
        ?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  const data = reference.snapshot;
  const card = state.briefing?.cards.find((c) => c.id === reference.cardId);
  const readable = !!card && canReadCardData(state, data);
  const feedback = currentFeedback(state, data);
  const hasShared =
    state.briefing?.shares?.some(
      (share) =>
        share.from === state.profile.name &&
        share.reference.cardId === reference.cardId &&
        briefingContentVersion(share.reference.snapshot) === briefingContentVersion(data),
    ) ?? false;
  useEffect(() => {
    const el = dialog.current;
    if (!readable) {
      onClose();
      ui.toast('这张卡片的来源已不可访问');
      return;
    }
    if (ui.conversationOpen) el?.close();
    else if (readable) {
      if (!el?.open) el?.showModal();
      change((s) => markBriefingRead(s, data));
    }
    return () => el?.close();
  }, [reference.cardId, reference.asOf, ui.conversationOpen, readable]);
  const act = (fn: () => void) => {
    try {
      setError('');
      fn();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const submitReason = (reason: FeedbackReason) =>
    act(() => {
      change((s) => setBriefingFeedback(s, data, 'useless', reason));
      closeReasons(true);
      notify('useless', '已收到反馈');
    });
  const openChat = (adjust = false) =>
    act(() => {
      const id = change((s) =>
        adjust
          ? openFeedbackConversation(s, reference)
          : openBriefingChat(
              s,
              reference.cardId,
              'content',
              { at: reference.asOf, data, article: reference.article },
              reference.config,
            ),
      );
      const element = readingCard.current!;
      const visual = captureDetailVisual(element);
      const readingScroll = element.querySelector<HTMLElement>('.briefing-detail-scroll')?.scrollTop || 0;
      dialog.current?.close();
      ui.go(`chat/${id}`, {
        element,
        reference,
        visual,
        surface: 'detail',
        readingScroll,
        returnFocus: returnFocus || undefined,
      });
      onEnterConversation();
    });
  if (!readable) return null;
  return createPortal(
    <>
      <dialog
        ref={dialog}
        className={`briefing-detail ${sizing.resizing ? 'is-resizing' : ''}`}
        style={{ width: sizing.width + sizing.gutter }}
        aria-labelledby="briefing-detail-title"
        onCancel={(e) => {
          e.preventDefault();
          if (panel) closeReasons(true);
          else onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="briefing-detail-card" ref={readingCard}>
          <header className="briefing-detail-top">
            <span>
              {magazineType(data)} <span aria-hidden="true">·</span> {spaceName(state, data.space)}
            </span>
            <button className="icon-button" aria-label="关闭卡片详情" onClick={onClose}>
              <X size={20} />
            </button>
          </header>
          <div className="briefing-detail-status">
            {feedback?.value === 'useless' && (
              <div className="briefing-feedback-receipt">
                <span>
                  没用 · {feedback.reason === 'custom' ? feedback.text : feedbackReasonLabel(feedback.reason)}
                </span>
                <button onClick={() => setPanel('reasons')}>修改</button>
                <button
                  onClick={() => {
                    change((s) => setBriefingFeedback(s, data, null));
                    notify('useless', '已撤销反馈');
                  }}
                >
                  撤销
                </button>
              </div>
            )}
            {error && (
              <p className="briefing-detail-notice" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="briefing-detail-reading">
            <div className="briefing-detail-scroll">
              <BriefingArticle
                reference={reference}
                titleId="briefing-detail-title"
                onSource={(id) => {
                  const doc = state.materials.find((d) => d.id === id);
                  if (doc) {
                    dialog.current?.close();
                    ui.go(`library/${doc.space}/${id}`);
                  }
                }}
              />
            </div>
            <button className="briefing-conversation-cta" onClick={() => openChat()}>
              <MessageSquare size={20} strokeWidth={1.65} aria-hidden="true" />
              <span>发起会话</span>
            </button>
          </div>
        </div>
        <div className="briefing-detail-resizer is-left" {...sizing.handle('left')} />
        <div className="briefing-detail-resizer is-right" {...sizing.handle('right')} />
        <div
          className="briefing-feedback-actions"
          aria-label="卡片快捷操作"
          ref={actionRail}
          data-label-side={labelSide}
        >
          <NavIconButton
            label="有用"
            Icon={ThumbsUp}
            active={feedback?.value === 'useful'}
            expanded={expanded === 'useful' || notice?.action === 'useful'}
            feedback={notice?.action === 'useful' ? notice.text : undefined}
            interaction={interaction('useful')}
            aria-pressed={feedback?.value === 'useful'}
            onClick={() =>
              act(() => {
                change((s) => setBriefingFeedback(s, data, feedback?.value === 'useful' ? null : 'useful'));
                setPanel(null);
                notify('useful', feedback?.value === 'useful' ? '已撤销有用' : '已记下，对你有帮助');
              })
            }
          />
          <NavIconButton
            label="没用"
            Icon={ThumbsDown}
            active={feedback?.value === 'useless' || panel === 'reasons'}
            expanded={panel !== 'reasons' && (expanded === 'useless' || notice?.action === 'useless')}
            wrapperClassName={`briefing-useless-action ${panel === 'reasons' ? 'is-popover-open' : ''}`}
            feedback={notice?.action === 'useless' ? notice.text : undefined}
            aria-controls="briefing-reason-options"
            aria-haspopup="dialog"
            accessory={
              <BriefingReasonPopover
                open={panel === 'reasons'}
                feedback={feedback}
                onClose={closeReasons}
                onSelect={submitReason}
                onCustom={() => openChat(true)}
              />
            }
            interaction={interaction('useless')}
            aria-pressed={feedback?.value === 'useless'}
            aria-expanded={panel === 'reasons'}
            onClick={() => {
              setNotice(null);
              setPanel(panel === 'reasons' ? null : 'reasons');
            }}
          />
          <NavIconButton
            label="关注"
            Icon={Star}
            wrapperClassName="briefing-follow-action"
            active={card!.pinned}
            expanded={expanded === 'follow' || notice?.action === 'follow'}
            feedback={notice?.action === 'follow' ? notice.text : undefined}
            interaction={interaction('follow')}
            aria-pressed={card!.pinned}
            onClick={() => {
              change((s) => {
                const c = s.briefing!.cards.find((c) => c.id === card!.id)!;
                c.pinned = !c.pinned;
              });
              notify('follow', card!.pinned ? '已取消关注' : '已加入关注');
            }}
          />
          <NavIconButton
            label="转发"
            Icon={Share2}
            active={shareOpen || hasShared}
            aria-description={hasShared ? '已转发，可再次转发' : undefined}
            expanded={expanded === 'share'}
            interaction={interaction('share')}
            aria-expanded={shareOpen}
            aria-haspopup="dialog"
            onClick={(event) => {
              shareTrigger.current = event.currentTarget;
              setNotice(null);
              setPanel(null);
              setShareOpen(true);
            }}
          />
        </div>
      </dialog>
      {shareOpen && (
        <BriefingShareDialog
          reference={reference}
          returnFocus={shareTrigger.current}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>,
    document.body,
  );
}
