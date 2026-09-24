import type { Chat, DemoState } from './model.ts';
import type { BriefingCard, CardData } from './briefing.ts';
import { canReadMaterial, visibleSpaces } from './libraryModel.ts';

// Legacy normal/builder chats predate origin tracking. Exclude every known card
// association before accepting that fallback; opening a card must never clone it.
export function isStandaloneConversation(state: DemoState, chat: Chat) {
  return (
    !chat.archived &&
    (chat.origin === 'conversation' || (!chat.origin && ['normal', 'builder'].includes(chat.kind))) &&
    !['briefing', 'briefing-optimize'].includes(chat.kind) &&
    !chat.briefingContext &&
    !chat.messages.some((message) => message.briefing) &&
    !state.briefing?.cards.some(
      (card) =>
        card.data.sourceKind !== 'conversation' &&
        (card.chatId === chat.id || card.optimizeChatId === chat.id),
    ) &&
    (['none', 'personal'].includes(chat.space) ||
      visibleSpaces(state).some((space) => space.id === chat.space))
  );
}

export function readableConversationReply(state: DemoState, data: CardData) {
  const chat = state.chats.find((chat) => chat.id === data.sourceId);
  if (!chat || !isStandaloneConversation(state, chat)) return false;
  return Object.entries(data.conversation?.refVersions || {}).every(([id, version]) =>
    state.materials.some(
      (doc) =>
        doc.id === id && canReadMaterial(state, doc) && doc.versions.some((item) => item.id === version),
    ),
  );
}

export function conversationBriefingSources(state: DemoState, now: string): CardData[] {
  return state.chats
    .filter((chat) => isStandaloneConversation(state, chat))
    .flatMap((chat) => {
      const reply = chat.messages.findLast((message) => message.role === 'assistant' && message.text.trim());
      if (!reply) return [];
      const id = `conversation:${chat.id}`;
      const existing = state.briefing?.cards.find((card) => card.id === id);
      // Older messages have no recorded time. Keep their first observed time
      // stable, rather than inventing a historical date or bumping them on reload.
      const at =
        reply.createdAt || (existing?.data.conversation?.replyId === reply.id ? existing.updatedAt : now);
      const data: CardData = {
        id,
        type: '活跃会话',
        template: 'conversation',
        title: chat.title,
        fact: reply.text,
        advice: '',
        source:
          chat.space === 'none'
            ? '未归入空间'
            : chat.space === 'personal'
              ? '个人空间'
              : state.spaces.find((space) => space.id === chat.space)!.name,
        space: chat.space === 'none' ? 'personal' : chat.space,
        size: '2×1',
        sourceKind: 'conversation',
        sourceId: chat.id,
        authoredAt: at,
        prompts: [],
        refs: [...new Set([...(reply.refs || []), ...(reply.doc ? [reply.doc] : [])])],
        conversation: { replyId: reply.id, refVersions: reply.refVersions },
      };
      return readableConversationReply(state, data) ? [data] : [];
    });
}

// The conversation view includes content discussions, not card-design sessions.
// Source-card messages establish context; they are not new AI replies.
export function briefingConversation(state: DemoState, card: BriefingCard) {
  const chat = state.chats.find((chat) => chat.id === card.chatId);
  if (
    !chat ||
    chat.archived ||
    chat.kind === 'briefing-optimize' ||
    chat.briefingContext?.purpose === 'optimize' ||
    (!['none', 'personal'].includes(chat.space) &&
      !visibleSpaces(state).some((space) => space.id === chat.space))
  )
    return undefined;
  const reply = chat.messages.findLast(
    (message) => message.role === 'assistant' && message.text.trim() && !message.briefing,
  );
  const refs = [
    ...new Set([
      ...(reply?.refs || []),
      ...(reply?.doc ? [reply.doc] : []),
      ...Object.keys(reply?.refVersions || {}),
    ]),
  ];
  if (
    !refs.every((id) =>
      state.materials.some(
        (doc) =>
          doc.id === id &&
          canReadMaterial(state, doc) &&
          (!reply?.refVersions?.[id] ||
            doc.versions.some((version) => version.id === reply.refVersions![id])),
      ),
    )
  )
    return undefined;
  return {
    chatId: chat.id,
    // Untimed legacy replies retain their first observed card time. Merely
    // opening a chat, changing its title or sending a user message cannot bump it.
    at: reply
      ? reply.createdAt ||
        (card.data.sourceKind === 'conversation' ? card.updatedAt : card.history[0]?.at || card.updatedAt)
      : '',
  };
}
