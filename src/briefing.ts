import {
  addChat,
  addMessage,
  latest,
  spaceName,
  type DemoState,
  type SourceLink,
  type SourcePhoto,
} from './model.ts';
import { kongguBriefingSources } from './kongguBriefing.ts';
import { replyKonggu } from './kongguReply.ts';
import { canReadMaterial, visibleSpaces } from './libraryModel.ts';
import { capabilities, collaborationStatus, colleagueName } from './colleagues.ts';
import { briefingExampleDate, exampleBriefingSources } from './briefingExamples.ts';
import type { BriefingPresentation, BriefingPerson } from './briefingPresentation.ts';
import { conversationBriefingSources, readableConversationReply } from './briefingChats.ts';

export const cardSizes = ['1×1', '2×1', '1×2', '2×2'] as const;
export type CardSize = (typeof cardSizes)[number];
export const cardTypes = [
  '资讯',
  '经营数据',
  '待办决策',
  '项目进展',
  '风险提醒',
  '成果交付',
  '知识洞察',
  '维护优化',
  '活跃会话',
] as const;
export type CardType = (typeof cardTypes)[number];
export type CardData = {
  id: string;
  type: CardType;
  template: 'number' | 'chart' | 'trend' | 'editorial' | 'list' | 'progress' | 'document' | 'conversation';
  title: string;
  fact: string;
  advice: string;
  source: string;
  space: string;
  size: CardSize;
  sourceKind:
    | 'followup'
    | 'dream'
    | 'request'
    | 'collaboration'
    | 'project'
    | 'material'
    | 'news'
    | 'demo-finance'
    | 'conversation';
  sourceId: string;
  value?: string;
  unit?: string;
  items?: { label: string; value: string }[];
  prompts: string[];
  refs?: string[];
  sourceSpaces?: string[];
  presentation?: BriefingPresentation;
  people?: BriefingPerson[];
  authoredAt?: string;
  sourceLinks?: SourceLink[];
  photo?: SourcePhoto;
  conversation?: { replyId: string; refVersions?: Record<string, string> };
};
export type CardConfig = { size: CardSize; title: string; compact: boolean };
export type BriefingCard = {
  id: string;
  data: CardData;
  updatedAt: string;
  history: { at: string; data: CardData }[];
  active: boolean;
  pinned: boolean;
  hidden: boolean;
  chatId?: string;
  optimizeChatId?: string;
  config?: CardConfig;
};
export type BriefingState = {
  version: 1;
  cards: BriefingCard[];
  layouts?: Record<string, import('./briefingLayout.ts').BriefingSavedLayout>;
};
export type BriefingReference = { cardId: string; asOf: string; snapshot: CardData; config: CardConfig };
export type BriefingChatContext = {
  cardId: string;
  purpose: 'content' | 'optimize';
  snapshot: CardData;
  asOf: string;
  draft?: CardConfig;
  display?: CardConfig;
};

export function followupRows(s: DemoState, scope: string) {
  const spaces = visibleSpaces(s);
  const apps = s.apps.filter(
    (a) =>
      (a.space === 'personal' || spaces.some((x) => x.id === a.space)) &&
      (scope === 'personal' || a.space === scope),
  );
  return s.records.filter(
    (r) => apps.some((a) => a.id === r.app) && (scope !== 'personal' || r.owner === s.profile.name),
  );
}

export function canReadCardData(s: DemoState, data: CardData) {
  if (data.sourceKind === 'conversation' && !readableConversationReply(s, data)) return false;
  if (data.space !== 'personal' && !visibleSpaces(s).some((x) => x.id === data.space)) return false;
  if ((data.sourceSpaces || []).some((id) => id !== 'personal' && !visibleSpaces(s).some((x) => x.id === id)))
    return false;
  return (data.refs || []).every((id) => s.materials.some((d) => d.id === id && canReadMaterial(s, d)));
}

// Readable frontend demo sources only. This is not a server-side permission boundary.
export function briefingSources(s: DemoState, now = new Date().toISOString()): CardData[] {
  const conversations = conversationBriefingSources(s, now).filter((data) => canReadCardData(s, data));
  if (s.scenario === 'konggu')
    return [...kongguBriefingSources(s), ...conversations].filter((data) => canReadCardData(s, data));
  const spaces = visibleSpaces(s);
  const docs = s.materials.filter((d) => canReadMaterial(s, d));
  const cards: CardData[] = [];
  if (spaces.some((x) => x.id === 'finance'))
    cards.push({
      id: 'finance:demo-receipts',
      type: '经营数据',
      template: 'trend',
      title: '近四周已到账回款',
      fact: '最后一周 18 万元，前一周 13 万元。',
      advice: '回款有所增加，建议继续核对未结款项的预计到账时间。',
      source: '合成回款记录 · 截至 2026-09-19',
      space: 'finance',
      size: '2×2',
      sourceKind: 'demo-finance',
      sourceId: 'demo-receipts',
      value: '57.0',
      unit: '万元',
      items: [
        { label: '8/29', value: '12' },
        { label: '9/5', value: '14' },
        { label: '9/12', value: '13' },
        { label: '9/19', value: '18' },
      ],
      prompts: ['分析回款变化', '列出需要核对的数据'],
    });
  for (const scope of ['personal', ...spaces.map((x) => x.id)]) {
    const apps = s.apps.filter(
      (a) => a.space === scope || (scope === 'personal' && spaces.some((x) => x.id === a.space)),
    );
    const rows = followupRows(s, scope);
    if (!apps.length) continue;
    const pending = rows.filter((r) => r.status === '待跟进');
    cards.push({
      id: `followup:${scope}`,
      type: '经营数据',
      template: 'chart',
      title: scope === 'personal' ? '我的客户跟进' : '销售跟进概览',
      fact: `${rows.length} 条记录，${pending.length} 位客户待跟进。`,
      advice: pending.length
        ? '先确认待跟进客户的下一次沟通时间。'
        : '当前没有待跟进客户，可复盘已联系的进展。',
      source: `${spaceName(s, scope)} · 客户跟进应用`,
      space: scope,
      size: '2×1',
      sourceKind: 'followup',
      sourceId: scope,
      sourceSpaces: [...new Set(apps.map((a) => a.space))],
      value: String(rows.length),
      unit: '条跟进',
      items: (['待跟进', '已联系', '已约定'] as const).map((status) => ({
        label: status,
        value: String(rows.filter((r) => r.status === status).length),
      })),
      prompts: ['查看待跟进客户', '查看已联系客户', '查看已约定客户', '梳理下一步跟进安排'],
    });
    if (scope === 'personal' && pending.length)
      cards.push({
        id: 'followup-todo',
        type: '待办决策',
        template: 'number',
        title: '下一次沟通，先排好',
        fact:
          pending
            .map((r) => r.customer)
            .slice(0, 2)
            .join('、') + (pending.length > 2 ? ` 等 ${pending.length} 位客户待跟进。` : '等待跟进。'),
        advice: '先补齐时间与负责人，再逐项推进。',
        source: '我的客户跟进',
        space: 'personal',
        size: '1×1',
        sourceKind: 'followup',
        sourceId: 'personal',
        sourceSpaces: [...new Set(apps.map((a) => a.space))],
        value: String(pending.length),
        unit: '待跟进',
        prompts: ['查看待跟进客户', '梳理下一步跟进安排'],
      });
  }
  cards.splice(cards[0]?.sourceKind === 'demo-finance' ? 2 : 1, 0, {
    id: 'dream',
    type: '维护优化',
    template: 'number',
    title: '本周资料整理',
    fact:
      s.dream.status === 'done'
        ? `3 份资料已${s.dream.scheme}归类。`
        : `3 份资料可${s.dream.scheme}归类，等待确认。`,
    advice:
      s.dream.status === 'done' ? '原文和版本已保留，可以继续使用。' : '报价资料保持原位，先核对归类方案。',
    source: `个人资料库 · 方案 ${s.dream.revision}`,
    space: 'personal',
    size: '1×1',
    sourceKind: 'dream',
    sourceId: 'dream',
    value: s.dream.status === 'done' ? '已整理' : '3',
    unit: s.dream.status === 'done' ? '' : '份资料',
    prompts: s.dream.status === 'done' ? ['查看整理结果'] : ['按客户分类，报价留在原处', '按月份归类'],
  });
  for (const r of s.requests.filter((r) => spaces.some((x) => x.id === r.target)))
    cards.unshift({
      id: `request:${r.id}`,
      type: '待办决策',
      template: 'document',
      title: r.title,
      fact: `${r.status === 'pending' ? '等待授权' : r.status === 'approved' ? '已批准' : '已拒绝'} · ${r.kind === 'app' ? '应用发布' : `资料入库 v${r.version?.number}`}。`,
      advice:
        r.status === 'pending' ? '核对目标位置与查看范围后再决定。' : '申请时的版本与个人后续修改分开保留。',
      source: `共享申请 · ${spaceName(s, r.target)}`,
      space: r.target,
      size: '1×1',
      sourceKind: 'request',
      sourceId: r.id,
      prompts: ['核对申请内容与查看范围'],
    });
  for (const r of s.collaborations)
    cards.unshift({
      id: `collaboration:${r.id}`,
      type: r.status === 'delivered' ? '成果交付' : '待办决策',
      template: 'document',
      title: `${colleagueName(s, r.colleagueId)} · ${capabilities.find((c) => c.id === r.capabilityId)?.name || '协作'}`,
      fact: `${collaborationStatus[r.status]} · ${r.brief.month} ${r.brief.scope}。`,
      advice:
        r.status === 'delivered' ? '结合交付成果继续讨论下一步。' : '先确认本次需求，再由同事授权与交付。',
      source: `同事协作 · 需求版本 ${r.revision}`,
      space: 'personal',
      size: '1×1',
      sourceKind: 'collaboration',
      sourceId: r.id,
      prompts: ['核对本次协作需求'],
    });
  for (const p of spaces.filter((x) => x.project))
    cards.push({
      id: `project:${p.id}`,
      type: '项目进展',
      template: 'progress',
      title: p.name,
      fact: `当前阶段：${p.project!.phase}。`,
      advice: '围绕交付目标核对本阶段的资料与待办。',
      source: `项目计划 · 目标 ${p.project!.targetDate}`,
      space: p.id,
      size: p.id === 'project-delivery' ? '1×2' : '1×1',
      sourceKind: 'project',
      sourceId: p.id,
      items: [
        { label: '目标', value: p.project!.goal },
        { label: '交付日期', value: p.project!.targetDate },
      ],
      prompts: ['梳理本阶段的待确认事项', '打开项目空间'],
    });
  const proposal = docs.find((x) => x.id === 'proposal');
  if (proposal)
    cards.push({
      id: 'deliverable:proposal',
      type: '成果交付',
      template: 'document',
      title: proposal.title,
      fact: `v${latest(proposal).number} · ${proposal.confirmed === latest(proposal).id ? '当前版本已确认' : '当前版本待确认'}。`,
      advice: '共享前确认报价口径与实施安排。',
      source: `${spaceName(s, proposal.space)} · ${latest(proposal).date}`,
      space: proposal.space,
      size: '1×1',
      sourceKind: 'material',
      sourceId: proposal.id,
      prompts: ['预览这份成果', '列出共享前的核对事项'],
      refs: [proposal.id],
    });
  const expired = docs.find((d) => d.status === '已过期');
  if (expired)
    cards.push({
      id: 'risk:expired',
      type: '风险提醒',
      template: 'document',
      title: '引用前，先核对有效性',
      fact: `「${expired.title}」已过期。`,
      advice: '请核对当前有效版本，避免继续引用旧口径。',
      source: `${spaceName(s, expired.space)} · 资料状态`,
      space: expired.space,
      size: '1×1',
      sourceKind: 'material',
      sourceId: expired.id,
      refs: [expired.id],
      prompts: ['查看过期资料', '列出引用前的核对事项'],
    });
  const guide = docs.find((x) => x.id === 'guide');
  if (guide)
    cards.push({
      id: 'insight:guide',
      type: '知识洞察',
      template: 'list',
      title: '让经验成为下一次的起点',
      fact: guide.summary,
      advice: '将重复出现的问题整理为可复用的检查清单。',
      source: `${guide.title} · v${latest(guide).number}`,
      space: guide.space,
      size: '2×1',
      sourceKind: 'material',
      sourceId: guide.id,
      refs: [guide.id],
      items: [
        { label: '准备', value: '先明确目标与现有资料' },
        { label: '推进', value: '记录待确认问题与负责人' },
        { label: '沉淀', value: '把确认的结果更新到资料库' },
      ],
      prompts: ['查看参考资料', '整理为可复用的检查清单'],
    });
  cards.push({
    id: 'news:direction',
    type: '资讯',
    template: 'editorial',
    title: '从回答问题，到持续参与工作',
    fact: '主动整理、持续适应、深入具体需求：办公 AI 的三个产品方向。',
    advice: '先用可回看的结果与可继续的会话，验证主动服务是否有用。',
    source: '合成资讯样例 · 2026-09-18',
    space: 'personal',
    size: '2×2',
    sourceKind: 'news',
    sourceId: 'direction',
    items: [
      { label: '01 / 主动', value: '整理资料、发现变化，在需要时呈现结果。' },
      { label: '02 / 适应', value: '识别重复需求，把操作沉淀为可复用组件。' },
      { label: '03 / 深入', value: '用少量选择，帮助用户表达具体需求。' },
    ],
    prompts: ['把这三个方向转成验证清单', '讨论智能画报的使用场景'],
  });
  cards.push(...exampleBriefingSources().filter((data) => canReadCardData(s, data)));
  return [...cards, ...conversations];
}

export function syncBriefing(s: DemoState, now = new Date().toISOString()) {
  s.briefing ||= { version: 1, cards: [] };
  const sources = briefingSources(s, now);
  s.briefing.cards.forEach((c) => {
    c.active = false;
  });
  for (const data of sources) {
    const card = s.briefing.cards.find((c) => c.id === data.id);
    if (!card) {
      // Authored demo editions have explicit publication dates. Existing sources
      // still start on first observation; never backfill the user's old snapshots.
      const at =
        data.authoredAt ||
        briefingExampleDate(data.id) ||
        (data.sourceKind === 'news' ? '2026-09-18T01:00:00.000Z' : now);
      s.briefing.cards.push({
        id: data.id,
        data,
        updatedAt: at,
        history: [{ at, data: structuredClone(data) }],
        active: true,
        pinned: false,
        hidden: false,
        ...(data.sourceKind === 'conversation' ? { chatId: data.sourceId } : {}),
      });
    } else {
      card.active = true;
      if (data.sourceKind === 'conversation') card.chatId = data.sourceId;
      if (JSON.stringify(card.data) !== JSON.stringify(data)) {
        card.data = data;
        card.updatedAt = data.sourceKind === 'conversation' ? data.authoredAt! : now;
        card.history.push({ at: card.updatedAt, data: structuredClone(data) });
      }
    }
  }
  return s;
}
export const localDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');
export function snapshotOn(card: BriefingCard, day: string) {
  return card.history.findLast((h) => localDate(h.at) <= day);
}
export function cardConfig(card: BriefingCard): CardConfig {
  return card.config || { size: card.data.size, title: card.data.title, compact: false };
}
export function openBriefingChat(
  s: DemoState,
  id: string,
  purpose: 'content' | 'optimize',
  snapshot?: { at: string; data: CardData },
  displayConfig?: CardConfig,
) {
  syncBriefing(s);
  const card = s.briefing!.cards.find((c) => c.id === id && c.active);
  if (!card) throw new Error('卡片来源已不可用。');
  if (card.data.sourceKind === 'conversation' && purpose === 'content') {
    if (!canReadCardData(s, snapshot?.data || card.data)) throw new Error('该会话已不可访问。');
    // Return to the existing thread without inserting a self-referencing card
    // message or changing its origin/type. Subsequent replies update this card.
    return card.data.sourceId;
  }
  const config =
    purpose === 'content'
      ? displayConfig ||
        (snapshot
          ? { size: snapshot.data.size, title: snapshot.data.title, compact: false }
          : cardConfig(card))
      : card.config || displayConfig || cardConfig(card);
  const key = purpose === 'content' ? 'chatId' : 'optimizeChatId';
  const data = snapshot?.data || card.data;
  if (!canReadCardData(s, data)) throw new Error('该快照的来源已不可访问。');
  const at = snapshot?.at || card.updatedAt;
  let chat = s.chats.find((c) => c.id === card[key]);
  if (!chat && purpose === 'content') {
    if (data.sourceKind === 'collaboration')
      chat = s.chats.find((c) => c.id === s.collaborations.find((r) => r.id === data.sourceId)?.chatId);
    if (data.sourceKind === 'dream') chat = s.chats.find((c) => c.kind === 'dream');
  }
  if (!chat) {
    chat = addChat(
      s,
      purpose === 'optimize' ? `优化卡片 · ${config.title}` : data.title,
      data.space,
      purpose === 'optimize' ? 'briefing-optimize' : data.sourceKind === 'dream' ? 'dream' : 'briefing',
    );
    chat.origin = 'briefing';
  }
  chat.archived = false;
  card[key] = chat.id;
  const sourceText = `${snapshot ? '回看留存快照' : '来自智能画报'} · ${localDate(at)}\n${data.title}\n${data.fact}\n${data.advice}\n依据：${data.source}`;
  const reference =
    purpose === 'content'
      ? chat.messages.find(
          (m) =>
            (m.briefing?.cardId === id && m.briefing.asOf === at) ||
            (!m.briefing &&
              m.role === 'assistant' &&
              ['来自智能画报', '回看留存快照'].some(
                (prefix) => m.text === sourceText.replace(/^(来自智能画报|回看留存快照)/, prefix),
              )),
        )
      : undefined;
  if (
    purpose === 'content'
      ? !reference
      : chat.briefingContext?.asOf !== at ||
        chat.briefingContext?.cardId !== id ||
        chat.briefingContext?.purpose !== purpose
  ) {
    addMessage(
      chat,
      'assistant',
      purpose === 'optimize'
        ? `一起调整「${config.title}」的呈现。当前为 ${config.size}，${config.compact ? '精简' : '完整'}展示。可以描述想改的地方，或用下方配置预览后保存。`
        : sourceText,
      undefined,
      data.refs,
    );
  }
  if (purpose === 'content') {
    const message = reference || chat.messages.at(-1)!;
    if (s.scenario === 'konggu') {
      message.refVersions ||= Object.fromEntries((data.refs || []).map((id) => [id, `${id}-v1`]));
    }
    message.briefing ||= {
      cardId: id,
      asOf: at,
      snapshot: structuredClone(data),
      config: structuredClone(config),
    };
  }
  const draft = purpose === 'optimize' ? chat.briefingContext?.draft || structuredClone(config) : undefined;
  chat.briefingContext = {
    cardId: id,
    purpose,
    snapshot: structuredClone(data),
    asOf: at,
    draft,
    display: structuredClone(config),
  };
  return chat.id;
}
export function replyToBriefing(s: DemoState, chatId: string, text: string) {
  const chat = s.chats.find((c) => c.id === chatId)!;
  const ctx = chat.briefingContext!;
  if (ctx.purpose === 'optimize') {
    const card = s.briefing!.cards.find((c) => c.id === ctx.cardId)!;
    const draft = (ctx.draft ||= structuredClone(cardConfig(card)));
    const size = text.match(/([12])\s*[×xX*乘]\s*([12])/);
    if (size) draft.size = `${size[1]}×${size[2]}` as CardSize;
    else if (/放大|大一点/.test(text)) draft.size = '2×2';
    if (/精简|简洁|少一点/.test(text)) draft.compact = true;
    if (/完整|详细|展开/.test(text)) draft.compact = false;
    const title = text.match(/(?:标题|名称)(?:改为|改成|设为|：|:)\s*[「“"]?([^」”"\n]+)/)?.[1]?.trim();
    if (title) draft.title = title.slice(0, 28);
    const changed = JSON.stringify(draft) !== JSON.stringify(cardConfig(card));
    addMessage(
      chat,
      'assistant',
      changed
        ? '已把可识别的调整放入下方预览，确认后保存到画报。这里使用演示规则解析尺寸、精简程度和标题。'
        : '已记录你的想法。此 Demo 可调整尺寸、标题与信息密度，请在下方选择并预览；其他设计需求暂不自动实现。',
    );
  } else {
    const d = ctx.snapshot;
    if (s.scenario === 'konggu') {
      replyKonggu(s, chat, text);
      return;
    }
    addMessage(
      chat,
      'assistant',
      `基于 ${localDate(ctx.asOf)} 留存的内容：${d.fact}\n\n建议先确认：\n1. 依据是否仍适用于当前工作（${d.source}）。\n2. 谁负责下一步，需要哪些补充信息。\n3. 确认结果后，再更新资料或推进事项。\n\n${d.advice}\n这是一份演示核对清单，可继续补充具体要求。`,
    );
  }
}
