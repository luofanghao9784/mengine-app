import { briefingTime } from '../briefingTypography';
import '../briefingFeedback.css';
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, MessageSquare, ThumbsUp, X } from 'lucide-react';
import { useBriefingDetailWidth } from '../components/useBriefingDetailWidth';
import type { FeedbackTarget } from '../../contracts/public-api/feedback';
import { FeedbackActions } from './FeedbackActions';
import { RequestPending } from '../shared/request-guard';
import { prepareViewportMotion } from '../conversation/viewport-motion';
import { conversationClient } from '../conversation/client';
import { useSubmission, SubmitError } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { briefingConversationHref } from '../conversation/briefing-context';
import { TaskReadingBody, type ReadingTask } from './TaskReadingBody';
import { RailButton, BriefingStatusMarks } from './Magazine';
import { usePhoneLayout } from '../identity/drawer-slot';

export function ReadingDialog({
  title,
  workspace,
  date,
  task,
  tenant,
  onClose,
  onRead,
  children,
  preface,
  feedback,
  feedbackTarget,
  actions,
  pinned = false,
  contentLabel,
}: {
  title: string;
  workspace: string;
  date?: string;
  tenant: string;
  task?: ReadingTask;
  onClose: () => void;
  onRead?: () => void;
  children?: ReactNode;
  preface?: ReactNode;
  feedback?: ReactNode;
  feedbackTarget?: FeedbackTarget;
  actions?: ReactNode;
  pinned?: boolean;
  contentLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    feedbackRef = useRef<HTMLDivElement>(null);
  const pending = useContext(RequestPending),
    titleId = useId();
  const sizing = useBriefingDetailWidth();
  // 手机上卡片详情铺满整屏，宽度不再由拖动调整。
  const phone = usePhoneLayout();
  const discussion = useSubmission<Record<string, never>>();
  useRequestLock(discussion.busy || discussion.uncertain);
  const [destination, setDestination] = useState<string>();
  useEffect(() => {
    if (!destination || discussion.busy || pending) return;
    window.location.hash = destination;
    onClose();
  }, [destination, discussion.busy, pending, onClose]);
  const [showFeedback, setShowFeedback] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    if (!pending) onClose();
  };
  const edge = useRef<{ x: number; y: number } | null>(null);
  return createPortal(
    <dialog
      ref={ref}
      className="live-reading-dialog"
      style={phone ? undefined : { width: sizing.width + sizing.gutter, paddingRight: sizing.gutter }}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        edge.current =
          phone && e.touches.length === 1 && touch.clientX <= 24
            ? { x: touch.clientX, y: touch.clientY }
            : null;
      }}
      onTouchMove={(e) => {
        if (!edge.current) return;
        const dx = e.touches[0].clientX - edge.current.x,
          dy = e.touches[0].clientY - edge.current.y;
        if (Math.abs(dy) > 24 && Math.abs(dy) > dx) edge.current = null;
        else if (dx > 60 && dx > Math.abs(dy) * 1.5) {
          edge.current = null;
          close();
        }
      }}
    >
      <div className="live-reading-card">
        <header className="live-reading-header">
          {/* 手机全屏时按“返回”理解：返回按钮在左侧，也可从左边缘右滑返回。 */}
          {phone && (
            <button
              type="button"
              className="live-reading-close is-back"
              aria-label="关闭卡片详情"
              disabled={pending}
              onClick={close}
            >
              <ChevronLeft size={22} />
            </button>
          )}
          <span title={`${contentLabel || (task ? '会话' : '企业副本')} · ${workspace}`}>
            {contentLabel || (task ? '会话' : '企业副本')} · {workspace}
          </span>
          <BriefingStatusMarks pinned={pinned} discussion={task ? { tenant, source: task } : undefined} />
          {!phone && (
            <button
              type="button"
              className="live-reading-close"
              aria-label="关闭卡片详情"
              disabled={pending}
              onClick={close}
            >
              <X size={20} />
            </button>
          )}
        </header>
        <div className="live-reading-scroll">
          <article className="live-reading-article">
            {date && <time dateTime={date}>{briefingTime(date, true)}</time>}
            <h2 id={titleId}>{title}</h2>
            {preface}
            {task && <TaskReadingBody tenant={tenant} task={task} onRead={onRead} />}
            {children}
          </article>
          {showFeedback && (
            <div className="live-reading-feedback" ref={feedbackRef}>
              {feedback}
            </div>
          )}
        </div>
        {task && (
          <button
            type="button"
            className="briefing-conversation-cta live-conversation-cta"
            disabled={discussion.busy || (pending && !discussion.uncertain)}
            onClick={() => {
              if (!task) return;
              void discussion.submit({}, async () => {
                const result = await conversationClient.discussion(tenant, task);
                const card = ref.current?.querySelector<HTMLElement>('.live-reading-card');
                if (card)
                  prepareViewportMotion(
                    tenant,
                    card,
                    'briefing',
                    card.querySelector('.live-reading-scroll')?.scrollTop || 0,
                  );
                setDestination(briefingConversationHref(tenant, task, result.conversationId || undefined));
              });
            }}
          >
            <MessageSquare size={20} strokeWidth={1.65} />
            <span>
              {discussion.busy ? '正在准备会话…' : discussion.uncertain ? '重试打开会话' : '发起会话'}
            </span>
          </button>
        )}
        <SubmitError error={discussion.error} uncertain={discussion.uncertain} />
      </div>
      <div className="live-reading-resizer is-left" {...sizing.handle('left')} />
      <div
        className="live-reading-resizer is-right"
        style={{ right: sizing.gutter - 6 }}
        {...sizing.handle('right')}
      />
      <aside className="live-reading-rail" aria-label="卡片快捷操作">
        {feedbackTarget ? (
          <FeedbackActions tenant={tenant} target={feedbackTarget}>
            {actions}
          </FeedbackActions>
        ) : (
          feedback && (
            <RailButton
              label="评价 / 建议"
              icon={ThumbsUp}
              active={showFeedback}
              aria-expanded={showFeedback}
              disabled={pending}
              onClick={() => {
                setShowFeedback((v) => !v);
                requestAnimationFrame(() =>
                  feedbackRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
                );
              }}
            />
          )
        )}
        {!feedbackTarget && actions}
      </aside>
    </dialog>,
    document.body,
  );
}
