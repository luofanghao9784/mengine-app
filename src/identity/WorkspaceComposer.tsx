import { useContext, useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { conversationHref } from '../conversation/Conversations';
import { readTabDraft, writeTabDraft } from '../shared/tab-drafts';
import { record } from './client';
import { RequestPending } from '../shared/request-guard';

/** The briefing launcher shares the real new-conversation draft; entering never submits a task. */
export function WorkspaceComposer({ tenant, account }: { tenant: string; account: string }) {
  const pendingRequest = useContext(RequestPending);
  const key = `dreamcore:composer:${account}:${tenant}:new`;
  const [initial] = useState(() => {
    const loaded = readTabDraft(key);
    return record(loaded.value) ? loaded.value : {};
  });
  const [text, setText] = useState(typeof initial.text === 'string' ? initial.text : '');
  const [error, setError] = useState('');
  const saveDraft = () => {
    const latest = readTabDraft(key);
    if (latest.unreadable) return false;
    const current = record(latest.value) ? latest.value : {};
    if (current.pending) return true;
    return writeTabDraft(key, { ...current, text });
  };
  useEffect(() => {
    if (!initial.pending) {
      setError(saveDraft() ? '' : '草稿暂时无法保存，请保留输入内容后重试。');
    }
  }, [initial, key, text]);
  const enter = () => {
    if (pendingRequest) return;
    // A pending request keeps its original body and idempotency key.
    if (!saveDraft()) {
      setError('草稿暂时无法保存，请保留输入内容后重试。');
      return;
    }
    location.hash = conversationHref(tenant);
  };
  return (
    <form
      className="workspace-composer"
      aria-label="从画报发起会话"
      onSubmit={(event) => {
        event.preventDefault();
        enter();
      }}
    >
      <input
        aria-label="新的工作需求"
        placeholder="有什么工作想交给 AI？"
        disabled={pendingRequest || !!initial.pending}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={12000}
      />
      <button
        type="submit"
        aria-label={initial.pending ? '继续未确认的会话' : '进入会话，继续编辑'}
        disabled={pendingRequest}
      >
        <ArrowUp size={20} />
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
