import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { addMessage } from '../src/model.ts';
import { canReadCardData, openBriefingChat, syncBriefing } from '../src/briefing.ts';
import { briefingConversation } from '../src/briefingChats.ts';
import {
  groupBriefingEntries,
  layoutBriefingSpread,
  refreshConversationTabLayout,
  saveBriefingLayout,
} from '../src/briefingLayout.ts';

const t1 = '2026-09-21T01:00:00.000Z',
  t2 = '2026-09-21T02:00:00.000Z';
const fixture = () => syncBriefing(createKongguSeed(), t1);
const entries = (s: ReturnType<typeof fixture>) =>
  s.briefing!.cards.flatMap((card) => {
    const conversation = briefingConversation(s, card);
    return card.active && canReadCardData(s, card.data) && conversation
      ? [{ card, data: card.data, at: card.updatedAt, conversationAt: conversation.at }]
      : [];
  });
const ordered = (s: ReturnType<typeof fixture>) => groupBriefingEntries(entries(s), '会话')[0]?.entries || [];

test('会话栏汇总独立卡与原卡，不重复；上下文引用和用户发送不算回复', () => {
  const s = fixture();
  assert.equal(ordered(s).length, 3);
  const card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const before = structuredClone(card);
  const id = openBriefingChat(s, card.id, 'content');
  const chat = s.chats.find((c) => c.id === id)!;
  assert.equal(ordered(s).length, 4);
  assert.equal(ordered(s).at(-1)!.card.id, card.id);
  assert.equal(briefingConversation(s, card)?.at, '');
  addMessage(chat, 'user', '请核对');
  assert.equal(briefingConversation(s, card)?.at, '');
  addMessage(chat, 'assistant', '已经核对');
  chat.messages.at(-1)!.createdAt = t2;
  syncBriefing(s, t2);
  assert.equal(ordered(s)[0].card.id, card.id);
  assert.equal(ordered(s).length, 4);
  assert.equal(card.updatedAt, before.updatedAt);
  assert.deepEqual(card.history, before.history);
  const snapshot = structuredClone(s);
  ordered(s);
  assert.deepEqual(s, snapshot);
  openBriefingChat(s, card.id, 'content');
  addMessage(chat, 'user', '继续');
  assert.equal(briefingConversation(s, card)?.at, t2);
});

test('无会话、仅优化、归档和失效关联退出；恢复会话后回到原卡', () => {
  const s = fixture();
  const card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  assert.equal(briefingConversation(s, card), undefined);
  openBriefingChat(s, card.id, 'optimize');
  assert.equal(briefingConversation(s, card), undefined);
  const id = openBriefingChat(s, card.id, 'content');
  const chat = s.chats.find((c) => c.id === id)!;
  chat.archived = true;
  assert.equal(briefingConversation(s, card), undefined);
  chat.archived = false;
  assert.equal(briefingConversation(s, card)?.chatId, id);
  card.chatId = 'missing';
  assert.equal(briefingConversation(s, card), undefined);
});

test('会话栏遵守当前空间及回复资料版本可读性，旧无时间回复稳定', () => {
  const s = fixture();
  const card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const id = openBriefingChat(s, card.id, 'content');
  const chat = s.chats.find((c) => c.id === id)!;
  addMessage(chat, 'assistant', '旧回复');
  delete chat.messages.at(-1)!.createdAt;
  const at = briefingConversation(s, card)!.at;
  card.updatedAt = t2;
  assert.equal(briefingConversation(s, card)!.at, at);
  chat.messages.at(-1)!.refVersions = { 'kg-D01': 'missing' };
  assert.equal(briefingConversation(s, card), undefined);
  chat.messages.at(-1)!.refVersions = { 'kg-D01': 'kg-D01-v1' };
  assert.ok(briefingConversation(s, card));
  chat.space = 'missing-space';
  assert.equal(briefingConversation(s, card), undefined);
});

test('会话排序不被补洞或旧布局反转；新回复后重新排序，单至五列均保持阅读顺序', () => {
  const s = fixture();
  const rows = entries(s).map((entry, index) => ({ ...entry, conversationAt: index === 2 ? t2 : t1 }));
  rows[0].card.config = { title: '宽卡', compact: false, size: '2×1' };
  rows[1].card.config = { title: '方卡', compact: false, size: '1×1' };
  rows[2].card.config = { title: '高卡', compact: false, size: '2×2' };
  const sorted = groupBriefingEntries(rows, '会话')[0].entries;
  for (const columns of [1, 2, 3, 4, 5]) {
    const placements = layoutBriefingSpread(sorted, columns, false, {}, undefined, undefined, true);
    assert.deepEqual(
      placements.map((p) => p.entry.card.id),
      sorted.map((e) => e.card.id),
    );
    const saved = saveBriefingLayout(placements, columns);
    assert.equal(refreshConversationTabLayout(sorted, columns, saved), saved);
    const changed = sorted.map((e) => ({
      ...e,
      conversationAt: e === sorted[2] ? '2026-09-21T03:00:00.000Z' : e.conversationAt,
    }));
    const projected = refreshConversationTabLayout(changed, columns, saved)!;
    assert.equal(projected.order[0], sorted[2].card.id);
    assert.notDeepEqual(projected, saved);
    assert.deepEqual(
      saved.order,
      sorted.map((e) => e.card.id),
    );
    const pending = { ...sorted[0], card: { ...sorted[0].card, id: 'no-reply' }, conversationAt: '' };
    const added = refreshConversationTabLayout([...sorted, pending], columns, saved)!;
    assert.equal(added.order.at(-1), 'no-reply');
  }
});
