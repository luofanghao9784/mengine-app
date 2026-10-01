import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed } from '../src/kongguSeed.ts';
import {
  syncBriefing,
  reconcileBriefing,
  canReadCardData,
  openBriefingChat,
  replyToBriefing,
} from '../src/briefing.ts';
import { briefingEntry, briefingCreatedAt } from '../src/briefingLifecycle.ts';
import {
  currentFeedback,
  isBriefingRead,
  markBriefingRead,
  setBriefingFeedback,
  recommendBriefing,
  refreshBriefingRecommendations,
} from '../src/briefingFeedback.ts';

const first = '2026-09-24T04:00:00.000Z',
  later = '2026-09-26T04:00:00.000Z';
const fixture = () => syncBriefing(createKongguSeed(), first);

test('数据跨日更新原卡，保留会话与偏好，阅读依据不被改写，不生成历史版本', () => {
  const s = fixture(),
    card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const created = briefingCreatedAt(card),
    original = structuredClone(card.data);
  const chatId = openBriefingChat(s, card.id, 'content');
  const chatEvidence = structuredClone(s.chats.find((c) => c.id === chatId)!.messages);
  card.pinned = card.hidden = true;
  card.config = { title: '我的经营仪表盘', size: '1×2', compact: false };
  markBriefingRead(s, card.data, first);
  setBriefingFeedback(s, card.data, 'useful');
  const next = { ...original, value: '50,000', fact: '最新数据已更新' };
  reconcileBriefing(s, [next, next], later);
  assert.equal(s.briefing!.cards.filter((c) => c.id === card.id).length, 1);
  assert.equal(card.data.value, '50,000');
  assert.equal(card.createdAt, created);
  assert.equal(card.updatedAt, later);
  assert.deepEqual(card.history, []);
  assert.equal(card.chatId, chatId);
  assert.equal(card.config.title, '我的经营仪表盘');
  assert.ok(card.pinned && card.hidden);
  assert.equal(currentFeedback(s, card.data)?.value, 'useful');
  assert.equal(isBriefingRead(s, card.data), false);
  assert.deepEqual(s.chats.find((c) => c.id === chatId)!.messages, chatEvidence);
  assert.equal(briefingEntry(card, '2026-09-24'), undefined);
  assert.equal(briefingEntry(card, ''), undefined);
  assert.equal(briefingEntry(card)!.data.value, '50,000');
  reconcileBriefing(s, [next], '2026-09-27T04:00:00.000Z');
  assert.equal(card.updatedAt, later);
});

test('资讯、成果和建议保持产生当天的内容，日期为精确匹配，来源退出候选后仍可查找', () => {
  for (const type of ['资讯', '成果交付', '待办决策'] as const) {
    const s = fixture(),
      card = s.briefing!.cards.find((c) => c.data.type === type)!;
    const before = structuredClone(card.data),
      at = briefingCreatedAt(card);
    const day = new Date(at).toLocaleDateString('sv-SE');
    reconcileBriefing(s, [{ ...before, fact: '后来的数字不应改写原判断', authoredAt: later }], later);
    assert.deepEqual(card.data, before);
    assert.equal(briefingEntry(card, day)!.at, at);
    assert.equal(briefingEntry(card, '2026-09-26'), undefined);
    reconcileBriefing(s, [], later);
    assert.ok(card.active);
    assert.deepEqual(briefingEntry(card, day)!.data, before);
    s.spaces.find((space) => space.id === card.data.space)!.members = [];
    reconcileBriefing(s, [], later);
    assert.equal(card.active, false);
    assert.equal(canReadCardData(s, card.data), false);
    assert.throws(() => openBriefingChat(s, card.id, 'content'));
  }
});

test('旧存储迁移保留已有内容和历史原件，但不再追加或查询卡片旧版本', () => {
  const s = fixture(),
    card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  delete card.createdAt;
  card.history = [{ at: first, data: { ...card.data, value: '旧数字' } }];
  const retained = structuredClone(card.history);
  reconcileBriefing(s, [{ ...card.data, value: '当前数字' }], later);
  assert.deepEqual(card.history, retained);
  assert.equal(briefingEntry(card, '2026-09-24'), undefined);
  assert.equal(briefingEntry(card)!.data.value, '当前数字');
  const dated = s.briefing!.cards.find((c) => c.data.type === '待办决策')!;
  delete dated.createdAt;
  dated.history = [{ at: first, data: { ...dated.data, fact: '先前判断' } }];
  dated.updatedAt = later;
  reconcileBriefing(s, [], later);
  assert.equal(briefingEntry(dated, '2026-09-24'), undefined);
  assert.equal(briefingEntry(dated, '2026-09-26')!.data.fact, dated.data.fact);
});

test('只改变推荐重要性不会伪造数据更新时间或产生未读内容', () => {
  const s = fixture(),
    card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const updated = card.updatedAt;
  markBriefingRead(s, card.data, first);
  reconcileBriefing(s, [{ ...card.data, recommendation: { importance: 'high', reason: '关键指标' } }], later);
  assert.equal(card.updatedAt, updated);
  assert.equal(isBriefingRead(s, card.data), true);
  assert.equal(recommendBriefing(s, Date.parse(later)).find((r) => r.id === card.id)!.reason, 'important');
});

test('已读数据因关注、有用或明确重要性再次推荐，冷却期阻止连续刷新置顶，身份和日期不变', () => {
  for (const signal of ['follow', 'useful', 'important']) {
    const s = fixture(),
      card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
    if (signal === 'follow') card.pinned = true;
    if (signal === 'useful') setBriefingFeedback(s, card.data, 'useful');
    if (signal === 'important') card.data.recommendation = { importance: 'high', reason: '关键经营指标' };
    markBriefingRead(s, card.data, first);
    const before = structuredClone(card);
    assert.equal(recommendBriefing(s, Date.parse(first)).find((r) => r.id === card.id)!.group, 'standard');
    const refreshed = refreshBriefingRecommendations(s, Date.parse(later));
    assert.equal(refreshed.filter((r) => r.id === card.id).length, 1);
    assert.equal(refreshed.find((r) => r.id === card.id)!.group, 'priority');
    assert.ok(refreshed.find((r) => r.id === card.id)!.reason);
    assert.equal(
      recommendBriefing(s, Date.parse(later) + 1000).find((r) => r.id === card.id)!.group,
      'standard',
    );
    assert.deepEqual(card, before);
    assert.equal(isBriefingRead(s, card.data), true);
  }
});

test('隐藏、没用和失去权限抑制再次推荐，新数据不清空反馈或旧阅读记录', () => {
  const s = fixture(),
    card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  card.pinned = true;
  markBriefingRead(s, card.data, first);
  card.hidden = true;
  assert.equal(recommendBriefing(s, Date.parse(later)).find((r) => r.id === card.id)!.reason, undefined);
  card.hidden = false;
  setBriefingFeedback(s, card.data, 'useless', 'irrelevant');
  assert.equal(recommendBriefing(s, Date.parse(later)).find((r) => r.id === card.id)!.reason, undefined);
  const next = { ...card.data, value: '50,000' };
  reconcileBriefing(s, [next], later);
  assert.equal(currentFeedback(s, card.data)?.value, 'useless');
  setBriefingFeedback(s, card.data, null);
  assert.equal(recommendBriefing(s, Date.parse(later)).find((r) => r.id === card.id)!.group, 'priority');
  s.spaces.find((space) => space.id === card.data.space)!.members = [];
  assert.equal(
    recommendBriefing(s, Date.parse(later)).find((r) => r.id === card.id),
    undefined,
  );
});

test('优化标题保留用户完整文字，不按固定字符数切断', () => {
  const s = fixture(),
    card = s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const title = '十一条合成商机分别处在哪个阶段以及需要补齐哪些资料和跟进行动';
  const chat = openBriefingChat(s, card.id, 'optimize');
  replyToBriefing(s, chat, `标题改为${title}`);
  assert.equal(s.chats.find((c) => c.id === chat)!.briefingContext!.draft!.title, title);
});
