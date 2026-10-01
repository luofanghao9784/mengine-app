import test from 'node:test';
import assert from 'node:assert/strict';
import { addChat, addMessage, type Chat } from '../src/model.ts';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { syncBriefing, openBriefingChat, canReadCardData } from '../src/briefing.ts';
import { loadKongguState } from '../src/kongguStorage.ts';
import {
  groupBriefingEntries,
  layoutBriefingSpread,
  refreshConversationLayout,
  saveBriefingLayout,
} from '../src/briefingLayout.ts';

const t1 = '2026-09-21T01:00:00.000Z',
  t2 = '2026-09-21T02:00:00.000Z';
const fixture = () => syncBriefing(createKongguSeed(), t1);
const reply = (chat: Chat, text: string, at = t1) => {
  addMessage(chat, 'assistant', text);
  chat.messages.at(-1)!.createdAt = at;
};
const entry = (s: ReturnType<typeof fixture>, chat: Chat) =>
  s.briefing!.cards.find((card) => card.id === `conversation:${chat.id}`)!;

test('发送前和仅有用户消息不生成卡片，每个会话仅一张，最新回复更新且重复同步不漂移', () => {
  const s = fixture(),
    chat = addChat(s, '新需求');
  chat.origin = 'conversation';
  syncBriefing(s, t1);
  assert.equal(entry(s, chat), undefined);
  addMessage(chat, 'user', '准备一份计划');
  syncBriefing(s, t1);
  assert.equal(entry(s, chat), undefined);
  reply(chat, '第一份计划');
  syncBriefing(s, t1);
  let card = entry(s, chat);
  assert.equal(card.data.fact, '第一份计划');
  assert.equal(card.chatId, chat.id);
  assert.equal(card.data.space, 'personal');
  assert.equal(card.data.source, '未归入空间');
  const before = structuredClone(card);
  addMessage(chat, 'user', '继续');
  syncBriefing(s, t2);
  assert.deepEqual(entry(s, chat), before);
  reply(chat, '第一份计划', t2);
  syncBriefing(s, t2);
  card = entry(s, chat);
  assert.equal(card.updatedAt, t2);
  assert.equal(card.history.length, 0);
  assert.equal(card.data.conversation?.replyId, chat.messages.at(-1)!.id);
  assert.equal(s.briefing!.cards.filter((c) => c.id === card.id).length, 1);
  const after = structuredClone(s);
  syncBriefing(s, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(s, after);
});

test('旧独立会话首次观察时间固定，新应用会话纳入；已知卡片关联与系统入口排除', () => {
  const s = fixture();
  assert.equal(s.briefing!.cards.filter((c) => c.data.type === '活跃会话').length, 3);
  const system = addChat(s, '系统事项');
  reply(system, '系统内容');
  const builder = addChat(s, '新建应用', 'none', 'builder');
  builder.origin = 'conversation';
  reply(builder, '字段建议');
  const legacy = addChat(s, '旧卡片关联');
  delete legacy.origin;
  reply(legacy, '原卡的回复');
  s.briefing!.cards.find((c) => c.id === 'konggu:C01')!.chatId = legacy.id;
  syncBriefing(s, t2);
  assert.equal(entry(s, system), undefined);
  assert.equal(entry(s, legacy), undefined);
  assert.ok(entry(s, builder)?.active);
  const previous = structuredClone(s.briefing);
  syncBriefing(s, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(s.briefing, previous);
});

test('打开活跃卡片复用原会话、不插入自引用或改变来源；画报展开和优化不重复生成', () => {
  const s = fixture(),
    original = s.chats.find((c) => c.id === 'kg-review')!;
  const before = structuredClone(original),
    count = s.chats.length;
  assert.equal(openBriefingChat(s, entry(s, original).id, 'content'), original.id);
  assert.deepEqual(
    s.chats.find((c) => c.id === original.id),
    before,
  );
  assert.equal(s.chats.length, count);
  const derivedId = openBriefingChat(s, 'konggu:C01', 'content');
  const optimizeId = openBriefingChat(s, entry(s, original).id, 'optimize');
  reply(
    s.chats.find((c) => c.id === derivedId)!,
    '继续分析',
  );
  reply(
    s.chats.find((c) => c.id === optimizeId)!,
    '样式更新',
  );
  syncBriefing(s, t2);
  assert.equal(s.briefing!.cards.filter((c) => c.active && c.data.sourceKind === 'conversation').length, 3);
  assert.equal(
    entry(
      s,
      s.chats.find((c) => c.id === derivedId)!,
    ),
    undefined,
  );
  assert.equal(
    entry(
      s,
      s.chats.find((c) => c.id === optimizeId)!,
    ),
    undefined,
  );
});

test('隐藏、关注和尺寸偏好随回复更新保留，归档退出、恢复回原卡，刷新不改回复时间', () => {
  const s = fixture(),
    chat = s.chats[0],
    card = entry(s, chat);
  card.hidden = true;
  card.pinned = true;
  card.config = { title: '经营讨论', size: '1×2', compact: false };
  reply(chat, '新的经营回复', t2);
  syncBriefing(s, t2);
  assert.equal(card.hidden, true);
  assert.equal(card.pinned, true);
  assert.equal(card.config.title, '经营讨论');
  chat.archived = true;
  syncBriefing(s, t2);
  assert.equal(card.active, false);
  assert.equal(canReadCardData(s, card.data), false);
  assert.throws(() => openBriefingChat(s, card.id, 'content'));
  chat.archived = false;
  syncBriefing(s, t2);
  assert.equal(card.active, true);
  const reloaded = loadKongguState({ getItem: () => JSON.stringify(s) });
  assert.deepEqual(reloaded.briefing, JSON.parse(JSON.stringify(s.briefing)));
  assert.equal(entry(reloaded, chat).updatedAt, t2);
});

test('当前空间、回复引用与指定版本不可读时不展示，旧快照也不能绕过当前权限', () => {
  const s = fixture(),
    chat = s.chats.find((c) => c.id === 'kg-development')!;
  const snapshot = structuredClone(entry(s, chat).data);
  s.spaces.find((space) => space.id === chat.space)!.members = [];
  syncBriefing(s, t2);
  assert.equal(entry(s, chat).active, false);
  assert.equal(canReadCardData(s, snapshot), false);
  s.spaces.find((space) => space.id === chat.space)!.members = [s.profile.name];
  chat.space = 'none';
  reply(chat, '有引用的回复', t2);
  chat.messages.at(-1)!.refs = ['kg-D01'];
  chat.messages.at(-1)!.refVersions = { 'kg-D01': 'missing-version' };
  syncBriefing(s, t2);
  assert.equal(entry(s, chat).active, false);
  chat.messages.at(-1)!.refVersions = { 'kg-D01': 'kg-D01-v1' };
  syncBriefing(s, t2);
  assert.equal(entry(s, chat).active, true);
  s.spaces.find((space) => space.id === 'operations')!.members = [];
  syncBriefing(s, t2);
  assert.equal(entry(s, chat).active, false);
  assert.equal(canReadCardData(s, entry(s, chat).data), false);
});

test('最新回复在已保存布局中前移，其余排列整体保留，手动重排后刷新稳定', () => {
  const s = fixture();
  const entries = s
    .briefing!.cards.filter((c) => c.active && c.data.sourceKind === 'conversation')
    .map((card) => ({ card, data: card.data, at: card.updatedAt }));
  for (const columns of [1, 2, 3, 4, 5]) {
    const saved = saveBriefingLayout(layoutBriefingSpread(entries, columns), columns, [entries[0].card.id]);
    const untouched = structuredClone(saved);
    const changed = entries.map((entry, i) => ({ ...entry, at: i === 2 ? t2 : t1 }));
    const projected = refreshConversationLayout(changed, saved)!;
    const placed = layoutBriefingSpread(changed, columns, false, {}, undefined, projected);
    assert.equal(placed[0].entry.card.id, entries[2].card.id);
    assert.deepEqual(saved, untouched);
    const a = placed.find((p) => p.entry.card.id === entries[0].card.id)!;
    const b = placed.find((p) => p.entry.card.id === entries[1].card.id)!;
    const savedA = saved.positions.find((p) => p.id === a.entry.card.id)!;
    const savedB = saved.positions.find((p) => p.id === b.entry.card.id)!;
    assert.equal(a.col, savedA.col);
    assert.equal(b.col, savedB.col);
    assert.equal(b.row - a.row, savedB.row - savedA.row);
    const committed = saveBriefingLayout(placed, columns);
    assert.deepEqual(refreshConversationLayout(changed, committed), committed);
    assert.equal(groupBriefingEntries(changed, '最新')[0].entries[0].card.id, entries[2].card.id);
    const extra = {
      ...changed[0],
      card: { ...changed[0].card, id: 'conversation:new' },
      at: '2026-09-21T03:00:00.000Z',
    };
    const added = layoutBriefingSpread(
      [...changed, extra],
      columns,
      false,
      {},
      undefined,
      refreshConversationLayout([...changed, extra], committed),
    );
    assert.equal(added[0].entry.card.id, extra.card.id);
  }
});
