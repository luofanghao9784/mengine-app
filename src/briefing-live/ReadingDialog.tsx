import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, ThumbsUp, X } from 'lucide-react';
import { RequestPending } from '../shared/request-guard';
import { DocumentText, Button } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { conversationClient } from '../conversation/client';
import { conversationHref } from '../conversation/Conversations';
import { RailButton, BriefingStatusMarks } from './Magazine';
import { readableTask } from './reading-state';

export type ReadingTask = {
  conversationId: string;
  taskId: string;
  taskRevision: number;
  attempt: number;
  workspaceId: string;
};
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
  actions,
  pinned = false,
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
  actions?: ReactNode;
  pinned?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    feedbackRef = useRef<HTMLDivElement>(null);
  const pending = useContext(RequestPending),
    titleId = useId();
  const [showFeedback, setShowFeedback] = useState(false);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const close = () => {
    if (!pending) onClose();
  };
  return createPortal(
    <dialog
      ref={ref}
      className="live-reading-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="live-reading-card">
        <header className="live-reading-header">
          <span>
            {task ? '会话' : '企业副本'} · {workspace}
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
            href={conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)}
            onClick={(e) => {
              if (pending) e.preventDefault();
            }}
          >
            <MessageSquare size={20} strokeWidth={1.65} />
            <span>继续会话</span>
          </a>
        )}
      </div>
      <aside className="live-reading-rail" aria-label="卡片快捷操作">
        {feedback && (
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
        )}
        {actions}
      </aside>
    </dialog>,
    document.body,
  );
}

function TaskReadingBody({
  tenant,
  task,
  onRead,
}: {
  tenant: string;
  task: ReadingTask;
  onRead?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => conversationClient.taskDetail(tenant, task.conversationId, task.taskId, signal),
    [tenant, task.conversationId, task.taskId, task.taskRevision, task.attempt, attempt],
  );
  const result = data.value?.tasks[0];
  const state = readableTask(data.value, task);
  const notified = useRef(false),
    read = useRef(onRead);
  read.current = onRead;
  useEffect(() => {
    if (state === 'ready' && !notified.current) {
      notified.current = true;
      read.current?.();
    }
  }, [state]);
  if (data.error) return <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  if (state !== 'ready' || !result)
    return (
      <div className="live-reading-unavailable" role="status">
        <p>
          {state === 'restricted'
            ? '这份成果的资料权限已变化，当前不能显示原文。'
            : '这份成果已更新，当前卡片对应的版本暂时无法读取。请刷新画报后重新打开。'}
        </p>
        <Button onClick={() => setAttempt((n) => n + 1)}>重新核对</Button>
      </div>
    );
  return (
    <>
      {result.executionClass === 'verification' && (
        <p className="live-verification-label">联调验证内容 · 未调用真实模型</p>
      )}
      <DocumentText text={result.reply || ''} />
      {(result.sources.length > 0 ||
        result.webSources.length > 0 ||
        result.originals.length > 0 ||
        result.artifacts.length > 0) && (
        <details className="live-reading-sources">
          <summary>
            资料来源与附件（
            {result.sources.length +
              result.webSources.length +
              result.originals.length +
              result.artifacts.length}
            ）
          </summary>
          {result.sources.map((s) => (
            <p key={s.id}>
              {s.filename} · v{s.version} · {s.locator}
            </p>
          ))}
          {result.webSources.map((s) => (
            <p key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            </p>
          ))}
          {result.originals.map((s) => (
            <p key={s.versionId}>
              {s.filename} · v{s.version}
              {s.read ? ' · 已读取' : ''}
            </p>
          ))}
          {result.artifacts.map((s) => (
            <p key={s.id}>{s.filename}</p>
          ))}
          <a
            href={conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)}
          >
            在原会话查看引用和下载附件
          </a>
        </details>
      )}
    </>
  );
}
