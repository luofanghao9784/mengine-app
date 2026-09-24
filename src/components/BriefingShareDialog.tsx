import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import type { BriefingReference } from '../briefing';
import { briefingRecipients, simulateBriefingShare } from '../briefingFeedback';
import { useDemo } from '../store';

export function BriefingShareDialog({
  reference,
  onClose,
  returnFocus,
}: {
  reference: BriefingReference;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const { state, change } = useDemo();
  const dialog = useRef<HTMLDialogElement>(null);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState('');
  const recipients = briefingRecipients(state, reference.snapshot);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => {
      el.close();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="briefing-share-dialog briefing-feedback-panel"
      aria-labelledby="briefing-share-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="briefing-panel-heading">
        <h2 id="briefing-share-title">转发给同事</h2>
        <button className="icon-button" aria-label="取消转发" onClick={onClose} autoFocus>
          <X size={20} />
        </button>
      </div>
      <p className="briefing-share-source">{reference.config.title}</p>
      <p className="briefing-share-note">仅演示转发流程，不会向同事发送消息。</p>
      {shared ? (
        <div className="briefing-share-done" role="status">
          <Check size={20} />
          <span>已保存演示转发记录</span>
          <button
            onClick={() => {
              setShared(false);
              setRecipient('');
              setNote('');
            }}
          >
            再转发给其他同事
          </button>
          <button className="button primary" onClick={onClose}>
            完成
          </button>
        </div>
      ) : (
        <>
          <div className="briefing-recipients">
            {recipients.map((r) => (
              <button
                key={r.name}
                disabled={!r.allowed}
                aria-pressed={recipient === r.name}
                onClick={() => setRecipient(r.name)}
              >
                <span>{r.name}</span>
                {r.allowed ? recipient === r.name && <Check size={16} /> : <small>无来源查看权限</small>}
              </button>
            ))}
          </div>
          {!recipients.some((r) => r.allowed) && (
            <p className="briefing-share-note">当前没有可接收此内容的同事。</p>
          )}
          <textarea
            aria-label="转发说明"
            placeholder="附带一句说明（选填）"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p role="alert" className="briefing-share-note">
              {error}
            </p>
          )}
          <button
            className="button primary briefing-share-submit"
            disabled={!recipient || !recipients.some((r) => r.name === recipient && r.allowed)}
            onClick={() => {
              try {
                change((s) => simulateBriefingShare(s, reference, recipient, note));
                setShared(true);
                setError('');
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            模拟转发
          </button>
        </>
      )}
    </dialog>,
    document.body,
  );
}
