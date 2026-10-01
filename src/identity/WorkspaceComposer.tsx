import { useContext, useEffect, useRef, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import { prepareViewportMotion } from '../conversation/viewport-motion';
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
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const opening = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [focused, setFocused] = useState(false);
  const saveDraft = (value = text, focus = false) => {
    const latest = readTabDraft(key);
    if (latest.unreadable) return false;
    const current = record(latest.value) ? latest.value : {};
    if (current.pending) return true;
    return writeTabDraft(key, {
      ...current,
      text: value,
      ...(focus
        ? {
            focus: {
              start: input.current?.selectionStart ?? value.length,
              end: input.current?.selectionEnd ?? value.length,
              direction: input.current?.selectionDirection || 'none',
            },
          }
        : {}),
    });
  };
  useEffect(() => {
    if (!initial.pending) {
      setError(saveDraft() ? '' : '草稿暂时无法保存，请保留输入内容后重试。');
    }
  }, [initial, key, text]);
  useEffect(() => {
    const scroll = input.current?.closest('.access-main')?.querySelector('.access-content');
    if (!scroll) return;
    let origin = scroll.scrollTop;
    const onScroll = () => {
      const top = scroll.scrollTop;
      if (focused || text || initial.pending) {
        setCollapsed(false);
        origin = top;
      } else if (top < 40 || top < origin - 36) {
        setCollapsed(false);
        origin = top;
      } else if (top > origin + 60) {
        setCollapsed(true);
        origin = top;
      }
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, [focused, text, initial]);
  const enter = (value = text) => {
    if (pendingRequest || opening.current || composing.current) return;
    // A pending request keeps its original body and idempotency key.
    if (!saveDraft(value, true)) {
      setError('草稿暂时无法保存，请保留输入内容后重试。');
      return;
    }
    if (input.current?.form) prepareViewportMotion(tenant, input.current.form, 'composer');
    opening.current = true;
    location.hash = conversationHref(tenant) + '&from=briefing';
  };
  return (
    <form
      className={`workspace-composer ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="从画报发起会话"
      onSubmit={(event) => {
        event.preventDefault();
        enter();
      }}
    >
      {collapsed && (
        <button
          type="button"
          aria-label="新建会话"
          onClick={() => {
            setCollapsed(false);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Plus size={22} />
        </button>
      )}
      <textarea
        ref={input}
        rows={1}
        inert={collapsed || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const value = event.currentTarget.value;
          setText(value);
          if (value.trim()) enter(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            enter();
          }
        }}
        aria-label="新的工作需求"
        placeholder="有什么工作想交给 AI？"
        disabled={pendingRequest || !!initial.pending}
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          if (value.trim() && !composing.current) enter(value);
        }}
        maxLength={2000}
      />
      <button
        hidden={collapsed}
        type="submit"
        aria-label={initial.pending ? '继续未确认的会话' : '进入会话，继续编辑'}
        disabled={pendingRequest}
      >
        <ArrowUp size={18} />
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
