import { useLayoutEffect, useRef } from 'react';
import {
  ArrowUp,
  Paperclip,
  ChevronDown,
  FileText,
  Folder,
  ArrowUpRight,
  Sparkles,
  ListFilter,
  CalendarDays,
  Share2,
  MoonStar,
  Check,
  LayoutGrid,
  ChartNoAxesCombined,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import { replyKonggu } from '../kongguReply';
import { addMessage, applyDream, createMaterial, editMaterial, latest, spaceName, type Chat } from '../model';
import { Button, Badge } from '../components/ui';
import { DashboardConfig, AppBuilder } from './Tools';
import { BriefingConversation } from '../components/BriefingConversation';
import { BriefingReferenceCard, messageBriefingReference } from '../components/BriefingReference';
import { replyToBriefing } from '../briefing';
import { canReadMaterial } from '../libraryModel';
import { CollaborationCard } from '../components/CollaborationCard';
import { startCollaboration, updateBriefFromText, isCollaborationOpen } from '../colleagues';

function scrollMessage(element: HTMLElement | null, behavior: ScrollBehavior) {
  const parent = element?.closest('.conversation-scroll');
  if (!element || !parent) return;
  const top =
    element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop - 16;
  parent.scrollTo({ top, behavior });
}

const colleagueIntent = (text: string) => /同事|财务.*(报表|销售表|分析|协作)|月度经营报表/.test(text);

function Composer({
  onSend,
  space,
  chatId,
  large = false,
  feedback = false,
}: {
  onSend: (text: string) => void;
  space: string;
  chatId?: string;
  large?: boolean;
  feedback?: boolean;
}) {
  const { state } = useDemo();
  const ui = useUI();
  const value = ui.conversationDrafts[chatId || 'new'] || '';
  const setValue = (text: string) => ui.setConversationDraft(chatId || 'new', text);
  const send = () => {
    if (value.trim()) {
      onSend(value.trim());
      setValue('');
    }
  };
  return (
    <div className={`composer-wrap ${large ? 'large' : ''}`}>
      <div className="composer">
        <textarea
          autoFocus={feedback}
          aria-label={feedback ? '说明没用的原因' : large ? '描述你的工作需求' : '继续对话'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            feedback
              ? '这张卡片哪里没帮到你？也可以直接说希望它怎样调整。'
              : large
                ? '描述你想完成的工作，剩下的我们一起推进…'
                : '继续描述你的想法，或选择上方建议…'
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-tools">
          <div className="row">
            <Button variant="ghost" icon={Paperclip} onClick={() => ui.open({ kind: 'attach', id: chatId })}>
              添加资料
            </Button>
            <span className="vertical-rule" />
            <button
              className="context-button"
              aria-label="选择工作空间"
              aria-haspopup="dialog"
              onClick={(event) =>
                chatId
                  ? ui.open({ kind: 'move', id: chatId, anchor: event.currentTarget, anchorSide: 'top' })
                  : ui.open({
                      kind: 'start-space',
                      target: space,
                      anchor: event.currentTarget,
                      anchorSide: 'top',
                    })
              }
            >
              <Folder size={16} />
              {spaceName(state, space)}
              <ChevronDown size={13} />
            </button>
          </div>
          <button className="send-button" aria-label="发送消息" disabled={!value.trim()} onClick={send}>
            <ArrowUp size={20} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
export function Conversation({ chatId }: { chatId: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const chat = state.chats.find((c) => c.id === chatId)!;
  const bottom = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLDivElement>(null);
  const priorCount = useRef<number | null>(null);
  const sourceMessage =
    chat.briefingContext?.purpose === 'content'
      ? chat.messages.findLast((m) => {
          const reference = messageBriefingReference(chat, m);
          return (
            reference?.cardId === chat.briefingContext!.cardId &&
            reference?.asOf === chat.briefingContext!.asOf
          );
        })
      : undefined;
  const docId = chat.messages.findLast((m) => m.doc)?.doc;
  const doc = state.materials.find((d) => d.id === docId);
  useLayoutEffect(() => {
    const initial = priorCount.current === null;
    if (initial) {
      priorCount.current = chat.messages.length;
      scrollMessage(origin.current || bottom.current, 'instant');
      return;
    }
    const frame = requestAnimationFrame(() => {
      priorCount.current = chat.messages.length;
      scrollMessage(bottom.current, 'smooth');
    });
    return () => cancelAnimationFrame(frame);
  }, [chat.messages.length]);
  function send(text: string) {
    change((s) =>
      addMessage(
        s.chats.find((c) => c.id === chatId)!,
        'user',
        text,
      ),
    );
    if (chat.briefingContext?.purpose === 'optimize') {
      change((s) => replyToBriefing(s, chatId, text));
      return;
    }
    const briefingData = chat.briefingContext?.snapshot;
    if (briefingData && /^查看|^预览|^打开/.test(text)) {
      if (briefingData.sourceKind === 'followup') {
        const status = text.includes('待跟进') ? '待跟进' : text.includes('已联系') ? '已联系' : '已约定';
        ui.go(`apps/${briefingData.sourceId}/followup?status=${encodeURIComponent(status)}`);
        return;
      }
      if (briefingData.sourceKind === 'material') {
        ui.preview(briefingData.sourceId);
        return;
      }
      if (briefingData.sourceKind === 'project') {
        ui.go(`space/${briefingData.sourceId}`);
        return;
      }
      if (briefingData.sourceKind === 'dream') {
        ui.go('library/personal');
        return;
      }
    }
    if (chat.kind === 'briefing') {
      change((s) => replyToBriefing(s, chatId, text));
      return;
    }
    if (/共享|发布/.test(text) && doc && chat.kind === 'normal') {
      ui.open({ kind: 'share', id: doc.id });
      return;
    }
    if (state.scenario === 'konggu' && chat.kind === 'normal') {
      const result = change((s) =>
        replyKonggu(
          s,
          s.chats.find((c) => c.id === chatId)!,
          text,
        ),
      );
      if (result) ui.preview(result);
      return;
    }
    const activeRequest = state.collaborations.find((r) => r.chatId === chat.id && isCollaborationOpen(r));
    if (activeRequest) {
      change((s) => {
        const r = s.collaborations.find((x) => x.id === activeRequest.id)!;
        const editable = ['draft', 'changes_requested'].includes(r.status);
        const needsClick = /批准|通过|授权|交付|取消/.test(text);
        if (editable && !needsClick) updateBriefFromText(r, text);
        addMessage(
          s.chats.find((c) => c.id === chatId)!,
          'assistant',
          needsClick
            ? '授权、交付或取消需要在下方当前需求卡中明确点击确认；文字回复不会改变授权状态。'
            : editable
              ? '已将补充更新到需求卡，请核对月份、范围和用途，再发送给同事。'
              : '补充已保留在当前会话，已发送的需求范围保持不变。如需调整，请由同事退回补充后重新提交。',
        );
      });
      return;
    }
    if (colleagueIntent(text) && ['normal', 'colleague'].includes(chat.kind)) {
      change((s) => startCollaboration(s, 'finance-report', chatId, text));
      return;
    }
    if (chat.kind === 'colleague') {
      change((s) =>
        addMessage(
          s.chats.find((c) => c.id === chatId)!,
          'assistant',
          '这次协作已结束。可以从交付卡查看成果，或新建会话发起下一项工作。',
        ),
      );
      return;
    }
    if (chat.kind === 'dream') {
      change((s) => {
        const c = s.chats.find((x) => x.id === chatId)!;
        if (s.dream.status === 'done')
          addMessage(c, 'assistant', '这批整理已经完成。可以在个人资料库查看新的分类，原始内容与版本保留。');
        else if (/按客户|客户分类/.test(text)) {
          s.dream.scheme = '按客户';
          s.dream.revision++;
          addMessage(
            c,
            'assistant',
            '已按客户重新考虑：客户 A、客户 B 与工作回顾各自归类。报价资料保持原位。',
          );
        } else if (/按月/.test(text)) {
          s.dream.scheme = '按月份';
          s.dream.revision++;
          addMessage(c, 'assistant', '已改为按月份归类，报价资料保持原位。');
        } else if (/全部|通过|处理|执行/.test(text)) {
          applyDream(s, s.dream.revision);
          addMessage(c, 'assistant', '已完成当前方案中的 3 份资料分类，内容、版本和共享范围均保留。');
        } else
          addMessage(
            c,
            'assistant',
            '这版可演示按客户或按月份归类，也可以暂缓处理。请用下面的卡片调整当前方案。',
          );
      });
      return;
    }
    if (chat.kind !== 'normal') {
      change((s) =>
        addMessage(
          s.chats.find((c) => c.id === chatId)!,
          'assistant',
          '已记录你的补充。这版通过下方配置卡片演示修改；你可以调整选项，预览并保存结果。',
        ),
      );
      return;
    }
    if (/精简|补充|修改|完善/.test(text) && doc) {
      const result = change((s) => {
        const old = s.materials.find((d) => d.id === doc.id)!;
        const content = /精简/.test(text)
          ? '一、合作目标\n明确客户需求，完成服务方案与团队试用。\n\n二、实施安排\n需求梳理 → 方案确认 → 分阶段交付。\n\n三、报价依据\n参考财务部门工作空间的服务价格表，最终报价待确认。'
          : latest(old).content +
            '\n\n补充实施计划\n第 1 周：整理需求与资料，明确负责人。\n第 2 周：完成配置与试用，收集团队反馈。\n第 3 周：完善流程并确认交付。';
        const next = editMaterial(
          s,
          old.id,
          content,
          old.title,
          /精简/.test(text)
            ? '合作目标、实施路径与报价依据的精简版本。'
            : old.summary + ' 已补充三周实施计划。',
          /精简/.test(text) ? '精简表述' : '补充实施计划',
        );
        addMessage(
          s.chats.find((c) => c.id === chatId)!,
          'assistant',
          `已${/精简/.test(text) ? '精简表述' : '补充实施计划'}，保存为 v${latest(next).number}。历史版本仍可查看。`,
          next.id,
          next.relations,
        );
        return next.id;
      });
      ui.preview(result);
      return;
    }
    if (/方案|生成/.test(text)) {
      const id = change((s) => {
        const d = createMaterial(s, '客户合作方案');
        d.relations = [
          ...(s.chats.find((c) => c.id === chatId)!.messages.findLast((m) => m.refs?.length)?.refs || [
            'needs',
            'price',
          ]),
        ];
        addMessage(
          s.chats.find((c) => c.id === chatId)!,
          'assistant',
          '已生成演示方案，保存在个人空间。可以继续修改和预览。',
          d.id,
          d.relations,
        );
        return d.id;
      });
      ui.preview(id);
      return;
    }
    change((s) =>
      addMessage(
        s.chats.find((c) => c.id === chatId)!,
        'assistant',
        '已收到。当前是前端演示，可以体验生成方案、精简表述、补充实施计划或共享成果；其他开放式需求暂不由真实 AI 处理。',
      ),
    );
  }
  return (
    <>
      <div className="conversation-scroll">
        <div className="conversation-column">
          <div className="date-divider">今天</div>
          {chat.messages.map((m) =>
            messageBriefingReference(chat, m) ? (
              <div
                key={m.id}
                ref={m.id === sourceMessage?.id ? origin : undefined}
                className="briefing-reference-message"
                data-current-origin={m.id === sourceMessage?.id || undefined}
              >
                <BriefingReferenceCard
                  reference={messageBriefingReference(chat, m)!}
                  active={m.id === sourceMessage?.id}
                  onSend={send}
                />
              </div>
            ) : (
              <div key={m.id} className={`message ${m.role}`}>
                {m.role === 'assistant' && <span className="ai-avatar">AI</span>}
                <div className="message-body">
                  {m.role === 'assistant' && <strong className="author">AI 助手</strong>}
                  <div className="message-text">{m.text}</div>
                  {m.refs?.length ? (
                    <div className="source-row">
                      {m.refs.map((id) => {
                        const ref = state.materials.find((d) => d.id === id && canReadMaterial(state, d));
                        return ref ? (
                          <button
                            className="source-chip"
                            key={id}
                            onClick={() => ui.preview(id, m.refVersions?.[id])}
                          >
                            <FileText size={14} />
                            <span>
                              {spaceName(state, ref.space)} · {ref.title}
                              {m.refVersions?.[id] &&
                                ' · v' +
                                  (ref.versions.find((v) => v.id === m.refVersions?.[id])?.number || '?')}
                            </span>
                          </button>
                        ) : null;
                      })}
                    </div>
                  ) : null}
                  {m.doc &&
                    (() => {
                      const d = state.materials.find((x) => x.id === m.doc);
                      return (
                        d && (
                          <button className="artifact-card" onClick={() => ui.preview(d.id)}>
                            <span className="file-icon">
                              <FileText size={22} strokeWidth={1.5} />
                            </span>
                            <span>
                              <strong>{d.title}</strong>
                              <small>
                                v{latest(d).number} · {d.confirmed === latest(d).id ? '已确认' : '草稿'} ·{' '}
                                {spaceName(state, d.space)}
                              </small>
                            </span>
                            <span className="artifact-action">
                              预览成果
                              <ArrowUpRight size={14} />
                            </span>
                          </button>
                        )
                      );
                    })()}
                </div>
              </div>
            ),
          )}
          {chat.kind === 'normal' && (
            <div className="chat-actions">
              {doc ? (
                <>
                  <Button
                    icon={ListFilter}
                    onClick={() => send(state.scenario === 'konggu' ? '核对分析依据' : '精简表述')}
                  >
                    {state.scenario === 'konggu' ? '核对分析依据' : '精简表述'}
                  </Button>
                  <Button
                    icon={CalendarDays}
                    onClick={() => send(state.scenario === 'konggu' ? '整理下一步行动计划' : '补充实施计划')}
                  >
                    {state.scenario === 'konggu' ? '整理行动计划' : '补充实施计划'}
                  </Button>
                  <Button icon={Share2} onClick={() => ui.open({ kind: 'share', id: doc.id })}>
                    准备共享
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    icon={FileText}
                    onClick={() => send(state.scenario === 'konggu' ? '整理分析草稿' : '生成合作方案')}
                  >
                    {state.scenario === 'konggu' ? '整理分析草稿' : '生成合作方案'}
                  </Button>
                  <Button icon={ChartNoAxesCombined} onClick={() => ui.go('briefing')}>
                    查看智能画报
                  </Button>
                  <Button icon={LayoutGrid} onClick={() => ui.go('apps/all')}>
                    打开应用
                  </Button>
                </>
              )}
            </div>
          )}
          {chat.kind === 'normal' && chat.space === 'none' && chat.messages.length >= 2 && (
            <div className="inline-suggestion">
              <Folder size={17} />
              <div>
                <strong>让这项工作有个归属</strong>
                <p>可以归入正在推进的项目，后续会优先参考该空间的工作说明。</p>
              </div>
              <Button
                onClick={(event) => ui.open({ kind: 'move', id: chat.id, anchor: event.currentTarget })}
              >
                选择空间
              </Button>
            </div>
          )}
          {chat.briefingContext && <BriefingConversation chat={chat} />}
          {state.collaborations
            .filter((r) => r.chatId === chat.id)
            .map((r) => (
              <CollaborationCard key={r.id} request={r} />
            ))}
          {chat.kind === 'dream' && <DreamCard chatId={chat.id} />}
          {chat.kind === 'dashboard' && (
            <DashboardConfig chatId={chat.id} scope={chat.context || 'personal'} />
          )}
          {chat.kind === 'builder' && <AppBuilder chatId={chat.id} appId={chat.context} />}
          <div ref={bottom} />
        </div>
      </div>
      <Composer
        feedback={!!chat.briefingContext?.feedback}
        space={chat.space}
        chatId={chat.id}
        onSend={send}
      />
    </>
  );
}
export function DreamCard({ chatId }: { chatId?: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const done = state.dream.status === 'done';
  return (
    <div className="collaboration-card">
      <div className="card-heading">
        <span className="row">
          <MoonStar size={18} />
          <strong>这批资料，如何归类？</strong>
        </span>
        <Badge blue>{done ? '已整理' : `方案 ${state.dream.revision}`}</Badge>
      </div>
      <p className="subtle">3 份个人资料 · 仅调整分类 · 报价资料保持原位</p>
      <div className="segmented">
        {(['按月份', '按客户'] as const).map((scheme) => (
          <button
            key={scheme}
            disabled={done}
            aria-pressed={state.dream.scheme === scheme}
            className={state.dream.scheme === scheme ? 'selected' : ''}
            onClick={() =>
              change((s) => {
                s.dream.scheme = scheme;
                s.dream.revision++;
              })
            }
          >
            {scheme}
          </button>
        ))}
      </div>
      <div className="classification-list">
        {['客户 A 合作方案', '客户 B 沟通记录', '本周工作小结'].map((title, i) => (
          <div key={title}>
            <span>{title}</span>
            <span className="subtle">→</span>
            <Badge>
              {state.dream.scheme === '按月份' ? '2026 年 9 月' : ['客户 A', '客户 B', '工作回顾'][i]}
            </Badge>
          </div>
        ))}
      </div>
      <div className="row wrap">
        {done ? (
          <>
            <span className="success-text">
              <Check size={16} />
              已完成当前批次
            </span>
            <Button onClick={() => ui.go('library/personal')}>查看整理结果</Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              onClick={() => {
                change((s) => {
                  applyDream(s, state.dream.revision);
                  if (chatId)
                    addMessage(
                      s.chats.find((c) => c.id === chatId)!,
                      'assistant',
                      '已完成这批资料的分类调整，原始内容和版本保留。',
                    );
                });
                ui.toast('3 份资料已归类，可在个人资料库查看');
              }}
            >
              按当前方案处理
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                ui.go('briefing');
                ui.toast('建议已保留，可以稍后继续');
              }}
            >
              稍后处理
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
