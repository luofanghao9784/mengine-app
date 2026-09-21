import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Plus, X, FileText, Files, ListChecks, LayoutGrid } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { addChat, addMessage, createMaterial, spaceName } from '../model';
import { canReadMaterial, readableDraftReferences, visibleSpaces } from '../libraryModel';
import { startCollaboration } from '../colleagues';
import { Button } from './ui';
import { DraftSpacePicker } from './DraftSpacePicker';
import { captureDraftVisual } from './conversationMotion';
import { replyKonggu } from '../kongguReply';

function DraftComposer({
  floating = false,
  focusRequest = 0,
}: {
  floating?: boolean;
  focusRequest?: number;
}) {
  const { state, change } = useDemo();
  const ui = useUI();
  const { newDraft: draft, setNewDraft } = ui;
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [attachments, setAttachments] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const opening = useRef(false);
  const openDraft = (input: HTMLTextAreaElement) => {
    const composer = root.current?.querySelector<HTMLElement>('.draft-composer');
    if (!floating || opening.current || composing.current || !input.value.trim() || !composer) return;
    opening.current = true;
    ui.openDraftConversation({
      visual: captureDraftVisual(composer),
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectionDirection: input.selectionDirection,
    });
  };
  const protectedDraft = focused || !!draft.text || !!draft.refs.length || attachments;
  const expanded = !floating || protectedDraft;
  const isCollapsed = floating && collapsed && !protectedDraft;
  useEffect(() => {
    if (focusRequest) textarea.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  useEffect(() => {
    if (!floating || !root.current) return;
    const stage = root.current.parentElement;
    const observer = new ResizeObserver(([entry]) => {
      stage?.style.setProperty(
        '--briefing-composer-clearance',
        `${Math.max(230, entry.contentRect.height + 60)}px`,
      );
    });
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      stage?.style.removeProperty('--briefing-composer-clearance');
    };
  }, [floating]);
  useEffect(() => {
    if (!floating) return;
    const scroll = root.current?.parentElement?.querySelector('.page-main');
    if (!scroll) return;
    let origin = scroll.scrollTop;
    const onScroll = () => {
      const top = scroll.scrollTop;
      if (protectedDraft) {
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
  }, [floating, protectedDraft]);
  const send = (text = draft.text) => {
    if (!text.trim()) return;
    // Draft attachment selection never creates a chat or moves a source material.
    const result = change((s) => {
      const { refs, refVersions } = readableDraftReferences(s, draft.refs, draft.refVersions);
      const space =
        draft.space === 'none' || visibleSpaces(s).some((x) => x.id === draft.space) ? draft.space : 'none';
      const kind = /应用|表单/.test(text) ? 'builder' : 'normal';
      const chat = addChat(s, text.trim().slice(0, 18), space, kind, space === 'none' ? 'personal' : space);
      chat.origin = 'conversation';
      addMessage(chat, 'user', text.trim(), undefined, refs);
      if (Object.keys(refVersions).length) chat.messages.at(-1)!.refVersions = refVersions;
      if (s.scenario === 'konggu' && kind === 'normal') {
        return { chat: chat.id, doc: replyKonggu(s, chat, text) };
      }
      if (/同事|财务.*(报表|销售表|分析|协作)|月度经营报表/.test(text)) {
        chat.kind = 'colleague';
        startCollaboration(s, 'finance-report', chat.id, text);
        return { chat: chat.id, doc: null };
      }
      if (kind === 'normal' && /方案|生成|整理/.test(text)) {
        const doc = createMaterial(s, /方案/.test(text) ? '客户合作方案' : '工作整理草稿');
        doc.relations = refs.length ? refs : ['needs', 'price'];
        addMessage(
          chat,
          'assistant',
          '已按演示模板准备初稿，保存在个人空间。你可以继续修改，或确认后共享。',
          doc.id,
          doc.relations,
        );
        return { chat: chat.id, doc: doc.id };
      }
      addMessage(
        chat,
        'assistant',
        kind === 'builder'
          ? '先把重复工作变成一个可使用的小工具。下面可以调整名称和字段，预览后保存。'
          : '已记录你的想法。当前为前端演示，可以继续补充需求，或体验方案生成与资料整理。',
      );
      return { chat: chat.id, doc: null };
    });
    setNewDraft({ text: '', space: 'none', refs: [] });
    ui.preview(result.doc);
    ui.go(`chat/${result.chat}`);
  };
  return (
    <div
      ref={root}
      className={
        floating ? `briefing-compose-dock ${isCollapsed ? 'is-collapsed' : ''}` : 'new-conversation-composer'
      }
    >
      <div className={`draft-composer ${expanded ? 'is-expanded' : ''}`}>
        {floating && (
          <button
            type="button"
            className="briefing-compose-trigger"
            aria-label="新建会话"
            title="新建会话"
            aria-hidden={!isCollapsed}
            tabIndex={isCollapsed ? 0 : -1}
            disabled={!isCollapsed}
            onClick={() => {
              setCollapsed(false);
              requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }));
            }}
          >
            <Plus size={22} aria-hidden="true" />
          </button>
        )}
        <div
          className="draft-composer-content"
          inert={isCollapsed}
          aria-hidden={isCollapsed || undefined}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          {attachments && (
            <section className="draft-attachments" aria-label="选择参考资料">
              <div className="row between">
                <strong>添加参考资料</strong>
                <Button onClick={() => setAttachments(false)}>完成选择</Button>
              </div>
              {state.materials
                .filter((d) => canReadMaterial(state, d))
                .map((d) => (
                  <label className="check-row" key={d.id}>
                    <input
                      type="checkbox"
                      checked={draft.refs.includes(d.id)}
                      onChange={(event) =>
                        setNewDraft((current) => ({
                          ...current,
                          refs: event.target.checked
                            ? [...current.refs, d.id]
                            : current.refs.filter((id) => id !== d.id),
                        }))
                      }
                    />
                    <span>
                      {d.title}
                      <small>{spaceName(state, d.space)}</small>
                    </span>
                  </label>
                ))}
            </section>
          )}
          {!!draft.refs.length && (
            <div className="draft-references" aria-label="已选参考资料">
              {draft.refs.map((id) => (
                <button
                  key={id}
                  onClick={() =>
                    setNewDraft((current) => ({ ...current, refs: current.refs.filter((ref) => ref !== id) }))
                  }
                  aria-label={`移除引用 ${state.materials.find((d) => d.id === id)?.title || '不可用资料'}`}
                >
                  <FileText size={14} />
                  {state.materials.find((d) => d.id === id)?.title || '不可用资料'}
                  {draft.refVersions?.[id] &&
                    ' · v' +
                      (state.materials
                        .find((d) => d.id === id)
                        ?.versions.find((v) => v.id === draft.refVersions?.[id])?.number || '?')}
                  <X size={13} />
                </button>
              ))}
            </div>
          )}
          <div className="draft-input-row">
            <textarea
              ref={textarea}
              aria-label="描述你的工作需求"
              placeholder="有什么工作想交给 AI？"
              rows={expanded ? 3 : 1}
              value={draft.text}
              onChange={(event) => {
                const text = event.target.value;
                setNewDraft((current) => ({ ...current, text }));
                if (!(event.nativeEvent as InputEvent).isComposing) openDraft(event.currentTarget);
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                const text = event.currentTarget.value;
                setNewDraft((current) => ({ ...current, text }));
                openDraft(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !composing.current &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  send();
                }
              }}
            />
          </div>
          {expanded && (
            <div className="draft-tools">
              <Button
                icon={Paperclip}
                variant="ghost"
                onClick={() => setAttachments(!attachments)}
                aria-expanded={attachments}
              >
                添加资料
              </Button>
              <span className="vertical-rule" aria-hidden="true" />
              <DraftSpacePicker />
            </div>
          )}
          <button
            className="send-button"
            aria-label="发送消息"
            disabled={!draft.text.trim()}
            onClick={() => send()}
          >
            <ArrowUp size={20} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function BriefingComposer() {
  return <DraftComposer floating />;
}

export function NewConversation({ space }: { space?: string }) {
  const ui = useUI();
  const { state } = useDemo();
  const cafe = state.scenario === 'konggu';
  const [focusRequest, setFocusRequest] = useState(0);
  const suggest = (text: string) => {
    ui.setNewDraft((draft) => ({ ...draft, text }));
    setFocusRequest((request) => request + 1);
  };
  useEffect(() => {
    if (space) ui.setNewDraft((draft) => ({ ...draft, space }));
  }, [space]);
  return (
    <>
      <div className="conversation-scroll new-conversation-empty">
        <section className="conversation-start" aria-label="新会话启动建议">
          <header>
            <h2>从一件具体的工作开始</h2>
            <p>选一个方向，或直接写下你想完成的事。</p>
          </header>
          <div className="conversation-starter-grid">
            {[
              {
                title: '起草方案',
                description: '明确需求，形成可执行的初稿',
                Icon: FileText,
                prompt: cafe
                  ? '根据30人读书会需求起草活动方案，列出空间、服务与待确认项。'
                  : '请帮我起草一份合作方案，先向我确认合作目标、客户需求和交付范围。',
              },
              {
                title: '整理资料',
                description: '提炼结论，找出待确认的问题',
                Icon: Files,
                prompt: cafe
                  ? '把本周销售、活动台账和顾客反馈放在一起，整理经营复盘。'
                  : '请帮我整理参考资料，提炼关键结论、待确认问题和下一步行动。',
              },
              {
                title: '梳理思路',
                description: '拆解目标，理清下一步行动',
                Icon: ListChecks,
                prompt: cafe
                  ? '结合贵州风味资讯、顾客反馈和配方成本，梳理下一轮新品试饮计划。'
                  : '请帮我梳理当前工作思路，先确认目标，再拆解优先级和行动步骤。',
              },
              {
                title: '搭建应用',
                description: '把重复工作变成好用的小工具',
                Icon: LayoutGrid,
                prompt: cafe
                  ? '我想搭建一个企业活动跟进应用，记录需求、档期和下一步。'
                  : '我想搭建一个客户跟进应用，请先确认使用场景和需要记录的字段。',
              },
            ].map(({ title, description, Icon, prompt }) => (
              <button key={title} type="button" onClick={() => suggest(prompt)}>
                <Icon size={20} strokeWidth={1.65} aria-hidden="true" />
                <strong>{title}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          <div className="conversation-prompt-suggestions" aria-label="提示词建议">
            <span>也可以这样开始</span>
            <div>
              {[
                ['总结一份资料', '请总结我提供的资料，并列出关键结论与需要核对的内容。'],
                ['准备一份周报', '帮我整理本周工作周报，先询问本周进展、遇到的问题和下周计划。'],
                ['规划下一步', '帮我把当前目标拆解为行动清单，标明优先级、负责人和完成时间。'],
              ].map(([title, prompt]) => (
                <button key={title} type="button" onClick={() => suggest(prompt)}>
                  {title}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
      <DraftComposer focusRequest={focusRequest} />
    </>
  );
}
