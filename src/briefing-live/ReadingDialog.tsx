import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, ThumbsUp, X } from 'lucide-react';
import { useBriefingDetailWidth } from '../components/useBriefingDetailWidth';
import type { FeedbackTarget } from '../../contracts/public-api/feedback';
import { FeedbackActions } from './FeedbackActions';
import { RequestPending } from '../shared/request-guard';
import { prepareViewportMotion } from '../conversation/viewport-motion';
import { briefingConversationHref } from '../conversation/briefing-context';
import { TaskReadingBody, type ReadingTask } from './TaskReadingBody';
import { RailButton, BriefingStatusMarks } from './Magazine';

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
  date: string;
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
  return createPortal(
    <dialog
      ref={ref}
      className="live-reading-dialog"
      style={{ width: sizing.width + sizing.gutter, paddingRight: sizing.gutter }}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="live-reading-card">
        <header className="live-reading-header">
          <span>
            {contentLabel || (task ? '会话' : '企业副本')} · {workspace}
          </span>
          <BriefingStatusMarks pinned={pinned} conversation={!!task} />
          <button
            type="button"
            className="live-reading-close"
            aria-label="关闭卡片详情"
            disabled={pending}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div className="live-reading-scroll">
          <article className="live-reading-article">
            <time dateTime={date}>{new Date(date).toLocaleString('zh-CN')}</time>
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
          <a
            className="live-conversation-cta"
            aria-disabled={pending}
            href={briefingConversationHref(tenant, task)}
            onClick={(e) => {
              if (pending) e.preventDefault();
              else {
                const card = ref.current?.querySelector<HTMLElement>('.live-reading-card');
                if (card)
                  prepareViewportMotion(
                    tenant,
                    card,
                    'briefing',
                    card.querySelector('.live-reading-scroll')?.scrollTop || 0,
                  );
                onClose();
              }
            }}
          >
            <MessageSquare size={20} strokeWidth={1.65} />
            <span>继续会话</span>
          </a>
        )}
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
