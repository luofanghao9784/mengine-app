import { withBriefingArticle } from './briefingArticle.ts';
import { addMessage, type DemoState } from './model.ts';
import { briefingCreatedAt, briefingLifecycle } from './briefingLifecycle.ts';
import {
  canReadCardData,
  openBriefingChat,
  type BriefingCard,
  type BriefingReference,
  type CardData,
} from './briefing.ts';

const legacyFeedbackReasons = [
  { id: 'irrelevant', label: '与我的工作无关' },
  { id: 'timing', label: '现在不需要' },
  { id: 'known', label: '这些我已经知道了' },
  { id: 'repeated', label: '类似内容太多了' },
  { id: 'inaccurate', label: '内容不准确或已过时' },
  { id: 'shallow', label: '分析太浅，没回答重点' },
  { id: 'impractical', label: '建议不实际，用不上' },
  { id: 'unreadable', label: '太长或不好理解' },
] as const;
// Four quick reasons plus the custom conversation entry make five visible choices.
export const feedbackReasons = [
  { id: 'irrelevant', label: '与当前工作无关' },
  { id: 'repeated', label: '已经知道或内容重复' },
  { id: 'inaccurate', label: '内容不准确或已过时' },
  { id: 'shallow', label: '分析或建议没帮助' },
] as const;
export type FeedbackReason = (typeof legacyFeedbackReasons)[number]['id'] | 'custom';
export function feedbackReasonLabel(reason?: FeedbackReason) {
  return (
    feedbackReasons.find((r) => r.id === reason)?.label ||
    legacyFeedbackReasons.find((r) => r.id === reason)?.label
  );
}
export type CardFeedback = {
  value: 'useful' | 'useless';
  reason?: FeedbackReason;
  text?: string;
  version: string;
  at: string;
};
export type CardInteraction = {
  readVersions?: string[]; // Retained legacy records; no new version list is written.
  readContent?: string;
  readAt?: string;
  lastRecommendedAt?: string;
  feedbacks?: CardFeedback[];
};
export type BriefingShare = {
  id: string;
  from: string;
  to: string;
  note: string;
  reference: BriefingReference;
  at: string;
  simulated: true;
};

// Content identity excludes cosmetic title/size/photo changes. Reading an older
// snapshot never acknowledges a newer fact or an unread conversation reply.
export function briefingContentVersion(data: CardData) {
  return JSON.stringify([
    data.fact,
    data.advice,
    data.value,
    data.unit,
    data.items,
    data.refs,
    data.source,
    data.sourceLinks,
    data.conversation,
    data.presentation?.lead,
    data.presentation?.points,
    data.presentation?.chart,
  ]);
}
export function cardInteraction(state: DemoState, id: string): CardInteraction {
  return state.briefing?.interactions?.[state.profile.name]?.[id] || {};
}
function writableInteraction(state: DemoState, data: CardData) {
  if (!state.briefing?.cards.some((card) => card.id === data.id) || !canReadCardData(state, data))
    throw new Error('这张卡片的来源已不可访问。');
  const users = (state.briefing.interactions ||= {});
  const cards = (users[state.profile.name] ||= {});
  return (cards[data.id] ||= {});
}
export function isBriefingRead(state: DemoState, data: CardData) {
  const interaction = cardInteraction(state, data.id);
  const content = briefingContentVersion(data);
  return interaction.readContent !== undefined
    ? interaction.readContent === content
    : !!interaction.readVersions?.includes(content);
}
export function markBriefingRead(state: DemoState, data: CardData, now = new Date().toISOString()) {
  const interaction = writableInteraction(state, data);
  interaction.readContent = briefingContentVersion(data);
  interaction.readAt = now;
}
export function currentFeedback(state: DemoState, data: CardData) {
  return cardInteraction(state, data.id).feedbacks?.at(-1);
}
export function setBriefingFeedback(
  state: DemoState,
  data: CardData,
  value: 'useful' | 'useless' | null,
  reason?: FeedbackReason,
  text?: string,
) {
  if (
    value === 'useless' &&
    (!reason || (reason === 'custom' ? !text?.trim() : !legacyFeedbackReasons.some((r) => r.id === reason)))
  )
    throw new Error('请选择原因或填写具体说明。');
  const interaction = writableInteraction(state, data);
  const version = briefingContentVersion(data);
  interaction.feedbacks = [];
  if (value)
    interaction.feedbacks.push({
      value,
      version,
      at: new Date().toISOString(),
      ...(value === 'useless' ? { reason, ...(reason === 'custom' ? { text: text!.trim() } : {}) } : {}),
    });
}
export function openFeedbackConversation(state: DemoState, reference: BriefingReference) {
  reference = withBriefingArticle(reference);
  const id = openBriefingChat(
    state,
    reference.cardId,
    'optimize',
    { at: reference.asOf, data: reference.snapshot, article: reference.article },
    reference.config,
  );
  const chat = state.chats.find((c) => c.id === id)!;
  const refVersions = Object.fromEntries(
    (reference.snapshot.refs || []).flatMap((id) => {
      const doc = state.materials.find((d) => d.id === id);
      const version =
        reference.snapshot.conversation?.refVersions?.[id] ||
        (state.scenario === 'konggu' && doc?.versions.some((v) => v.id === `${id}-v1`)
          ? `${id}-v1`
          : doc?.versions.at(-1)?.id);
      return version ? [[id, version]] : [];
    }),
  );
  chat.title = `调整画报 · ${reference.config.title}`;
  chat.briefingContext!.feedback = { pending: true, refVersions };
  // A context message prepares the conversation but submits no user feedback.
  const last = chat.messages.at(-1);
  if (!last?.text.startsWith('这张卡片哪里没帮到你？') || last.briefing?.asOf !== reference.asOf) {
    const text =
      '这张卡片哪里没帮到你？也可以直接说希望它怎样调整。已带入当前卡片内容和来源，发送说明后才提交“没用”反馈。';
    if (last?.text.startsWith('一起调整「')) last.text = text;
    else addMessage(chat, 'assistant', text, undefined, reference.snapshot.refs);
    chat.messages.at(-1)!.briefing = structuredClone(reference);
    chat.messages.at(-1)!.refVersions = refVersions;
  }
  return id;
}
export function commitCustomFeedback(state: DemoState, chatId: string, text: string) {
  const ctx = state.chats.find((c) => c.id === chatId)?.briefingContext;
  if (!ctx?.feedback?.pending) return false;
  setBriefingFeedback(state, ctx.snapshot, 'useless', 'custom', text);
  ctx.feedback.pending = false;
  return true;
}

export function hasActiveBriefingConversation(state: DemoState, card: BriefingCard, now = Date.now()) {
  const chat = state.chats.find((c) => c.id === card.chatId && !c.archived && c.kind !== 'briefing-optimize');
  if (!chat) return false;
  if (card.data.sourceKind === 'conversation') return true;
  // Opening a source (assistant context only) is not an active work conversation.
  return chat.messages.some(
    (m) => m.role === 'user' && !!m.createdAt && now - Date.parse(m.createdAt) < 7 * 86400000,
  );
}
export type Recommendation = {
  id: string;
  group: 'priority' | 'standard';
  reason?: 'important' | 'preferred' | 'following';
};
// Reversible Demo policy: meaningful data changes may surface immediately;
// unchanged, read data can return after 24 hours, with an explicit interest signal.
export const dataRecommendationCooldown = 24 * 60 * 60 * 1000;
export function recommendBriefing(state: DemoState, now = Date.now()): Recommendation[] {
  return (state.briefing?.cards || [])
    .filter((c) => c.active && canReadCardData(state, c.data))
    .sort((a, b) =>
      (briefingLifecycle(b.data) === 'dated' ? briefingCreatedAt(b) : b.updatedAt).localeCompare(
        briefingLifecycle(a.data) === 'dated' ? briefingCreatedAt(a) : a.updatedAt,
      ),
    )
    .map((card): Recommendation => {
      const read = isBriefingRead(state, card.data);
      const live = briefingLifecycle(card.data) === 'live';
      const interaction = cardInteraction(state, card.id);
      const feedback = currentFeedback(state, card.data);
      const lastSeen = Math.max(
        Date.parse(interaction.readAt || '') || 0,
        Date.parse(interaction.lastRecommendedAt || '') || 0,
      );
      const signal = card.pinned
        ? 'following'
        : feedback?.value === 'useful'
          ? 'preferred'
          : card.data.recommendation?.importance === 'high'
            ? 'important'
            : undefined;
      const reason =
        live &&
        !card.hidden &&
        feedback?.value !== 'useless' &&
        signal &&
        (!read || now - lastSeen >= dataRecommendationCooldown)
          ? signal
          : undefined;
      const priority =
        reason ||
        (!live && card.pinned) ||
        hasActiveBriefingConversation(state, card, now) ||
        (card.data.sourceKind === 'request' &&
          state.requests.some((r) => r.id === card.data.sourceId && r.status === 'pending'));
      return {
        id: card.id,
        group: priority ? 'priority' : 'standard',
        ...(reason ? { reason } : {}),
      };
    });
}

export function refreshBriefingRecommendations(state: DemoState, now = Date.now()) {
  const recommendations = recommendBriefing(state, now);
  for (const recommendation of recommendations) {
    if (!recommendation.reason) continue;
    const card = state.briefing!.cards.find((c) => c.id === recommendation.id)!;
    writableInteraction(state, card.data).lastRecommendedAt = new Date(now).toISOString();
  }
  return recommendations;
}

export function briefingRecipients(state: DemoState, data: CardData) {
  const names = [
    ...new Set(state.spaces.filter((s) => s.members.includes(state.profile.name)).flatMap((s) => s.members)),
  ].filter((name) => name !== state.profile.name);
  return names.map((name) => {
    const recipient = { ...state, profile: { ...state.profile, name } };
    // A personal conversation cannot become shared through a card forwarding action.
    const allowed =
      data.sourceKind !== 'conversation' && data.space !== 'personal' && canReadCardData(recipient, data);
    return { name, allowed };
  });
}
export function simulateBriefingShare(
  state: DemoState,
  reference: BriefingReference,
  to: string,
  note: string,
) {
  if (
    !canReadCardData(state, reference.snapshot) ||
    !briefingRecipients(state, reference.snapshot).some((r) => r.name === to && r.allowed)
  )
    throw new Error('该同事没有这张卡片及来源资料的查看权限。');
  const share: BriefingShare = {
    id: crypto.randomUUID(),
    from: state.profile.name,
    to,
    note: note.trim(),
    reference: structuredClone(reference),
    at: new Date().toISOString(),
    simulated: true,
  };
  (state.briefing!.shares ||= []).push(share);
  return share.id;
}
