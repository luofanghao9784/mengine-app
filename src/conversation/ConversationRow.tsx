import { useContext, useEffect, useRef, useState } from 'react';
import { LayoutPanelTop, LoaderCircle, Trash2 } from 'lucide-react';
import type { Conversation } from '../../contracts/public-api/conversation';
import { Button, IconButton, Modal } from '../shared/ui';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { SubmitError, useSubmission } from '../shared/admin';
import { conversationClient } from './client';
import './conversation-management.css';

export function ConversationRow({
  tenant,
  item,
  href,
  selected,
  changed,
}: {
  tenant: string;
  item: Conversation;
  href: string;
  selected: boolean;
  changed: () => void;
}) {
  const pending = useContext(RequestPending);
  const row = useRef<HTMLDivElement>(null);
  const press = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
    touch: boolean;
    suppressClick: boolean;
  }>({ x: 0, y: 0, touch: false, suppressClick: false });
  const [touchDelete, setTouchDelete] = useState(false),
    [confirm, setConfirm] = useState(false);
  const cancelPress = () => {
    clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };
  useEffect(() => {
    if (pending) {
      cancelPress();
      setTouchDelete(false);
    }
    return cancelPress;
  }, [pending]);
  useEffect(() => {
    if (!touchDelete) return;
    const outside = (event: PointerEvent) => {
      if (!row.current?.contains(event.target as Node)) setTouchDelete(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTouchDelete(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [touchDelete]);
  return (
    <div ref={row} className={`live-conversation-row${touchDelete ? ' is-delete-revealed' : ''}`}>
      <a
        className={selected ? 'selected' : ''}
        href={href}
        aria-current={selected ? 'page' : undefined}
        onPointerDown={(event) => {
          cancelPress();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            touch: event.pointerType === 'touch',
            suppressClick: false,
          };
          if (pending || event.pointerType !== 'touch' || !event.isPrimary) return;
          press.current.timer = setTimeout(() => {
            press.current.suppressClick = true;
            setTouchDelete(true);
          }, 500);
        }}
        onPointerMove={(event) => {
          if (
            press.current.touch &&
            event.pointerType === 'touch' &&
            Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10
          ) {
            cancelPress();
            setTouchDelete(false);
          }
        }}
        onPointerUp={cancelPress}
        onPointerCancel={() => {
          cancelPress();
          setTouchDelete(false);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'touch') cancelPress();
        }}
        onContextMenu={(event) => {
          if (press.current.touch) event.preventDefault();
        }}
        onClick={(e) => {
          if (pending || press.current.suppressClick) e.preventDefault();
        }}
      >
        {item.briefingDiscussion && (
          <span className="conversation-briefing-tag" role="img" aria-label="画报会话" title="画报会话">
            <LayoutPanelTop size={14} aria-hidden="true" />
          </span>
        )}
        <span className="conversation-list-title" title={item.title}>
          {item.title}
        </span>
        {(item.running || item.unread) && (
          <span className="conversation-list-indicators">
            {item.running && (
              <LoaderCircle className="conversation-running-icon" size={14} aria-label="进行中" role="img" />
            )}
            {item.unread && <span className="conversation-unread-dot" role="img" aria-label="未读回复" />}
          </span>
        )}
      </a>
      <div className="conversation-row-delete">
        <IconButton
          icon={Trash2}
          label={`删除会话：${item.title}`}
          disabled={pending}
          onClick={() => {
            cancelPress();
            setTouchDelete(false);
            setConfirm(true);
          }}
        />
      </div>
      {confirm && (
        <DeleteConversation
          tenant={tenant}
          item={item}
          close={() => setConfirm(false)}
          done={() => {
            setConfirm(false);
            changed();
          }}
        />
      )}
    </div>
  );
}
function DeleteConversation({
  tenant,
  item,
  close,
  done,
}: {
  tenant: string;
  item: Conversation;
  close: () => void;
  done: () => void;
}) {
  const submission = useSubmission<{ expectedRevision: number; action: 'TRASH'; stopRunning: boolean }>();
  useRequestLock(submission.busy || submission.uncertain);
  return (
    <Modal
      title={item.running ? '停止并删除会话' : '删除会话'}
      className="conversation-delete-dialog"
      onClose={() => {
        if (!submission.busy && !submission.uncertain) close();
      }}
    >
      <p>
        {item.running ? '将停止此会话的执行，并移入回收站。' : '将此会话移入回收站，可在个人设置中恢复。'}
      </p>
      <strong className="conversation-delete-title">{item.title}</strong>
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      <div className="modal-actions">
        <Button disabled={submission.busy || submission.uncertain} onClick={close}>
          取消
        </Button>
        <Button
          variant="danger"
          disabled={submission.busy}
          onClick={() =>
            void submission.submit(
              {
                expectedRevision: item.managementRevision || 0,
                action: 'TRASH',
                stopRunning: item.running === true,
              },
              async (body, requestId) => {
                await conversationClient.manage(tenant, item.id, { ...body, requestId });
                done();
                window.dispatchEvent(new Event('conversation-list-changed'));
              },
            )
          }
        >
          {submission.busy
            ? '正在删除…'
            : submission.uncertain
              ? '重试本次删除'
              : item.running
                ? '停止并删除'
                : '删除会话'}
        </Button>
      </div>
    </Modal>
  );
}
