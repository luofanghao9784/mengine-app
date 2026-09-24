import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { cardConfig, syncBriefing, replyToBriefing, type BriefingReference } from '../src/briefing.ts';
import {
  briefingRecipients,
  currentFeedback,
  feedbackReasons,
  feedbackReasonLabel,
  isBriefingRead,
  markBriefingRead,
  openFeedbackConversation,
  recommendBriefing,
  setBriefingFeedback,
  simulateBriefingShare,
} from '../src/briefingFeedback.ts';
const seed = () => syncBriefing(createKongguSeed());
const source = (s: ReturnType<typeof seed>) => s.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
const reference = (s: ReturnType<typeof seed>): BriefingReference => {
  const c = source(s);
  return { cardId: c.id, asOf: c.updatedAt, snapshot: structuredClone(c.data), config: cardConfig(c) };
};

test('已读按用户和内容版本保存，历史阅读不覆盖新内容，外观调整不会制造未读', () => {
  const s = seed(),
    c = source(s),
    old = structuredClone(c.data);
  markBriefingRead(s, old);
  markBriefingRead(s, old);
  assert.ok(isBriefingRead(s, old));
  c.data.title = '更清楚的标题';
  c.data.size = '1×1';
  assert.ok(isBriefingRead(s, c.data));
  c.data.fact = '出现新的经营事实';
  assert.equal(isBriefingRead(s, c.data), false);
  markBriefingRead(s, old);
  assert.equal(isBriefingRead(s, c.data), false);
  s.profile.name = s.spaces[0].members[1];
  assert.equal(isBriefingRead(s, old), false);
});

test('没用必须有有效原因，与有用互斥，撤销不影响关注、隐藏、事实和事项', () => {
  const s = seed(),
    c = source(s);
  c.pinned = true;
  const original = JSON.stringify(c);
  setBriefingFeedback(s, c.data, 'useful');
  assert.throws(() => setBriefingFeedback(s, c.data, 'useless'));
  assert.throws(() => setBriefingFeedback(s, c.data, 'useless', 'custom', '   '));
  assert.equal(currentFeedback(s, c.data)?.value, 'useful');
  for (const reason of feedbackReasons) {
    setBriefingFeedback(s, c.data, 'useless', reason.id);
    assert.equal(currentFeedback(s, c.data)?.reason, reason.id);
  }
  setBriefingFeedback(s, c.data, null);
  assert.equal(currentFeedback(s, c.data), undefined);
  assert.equal(JSON.stringify(c), original);
});

test('自填入口准备当前快照和来源版本，发送前不提交；发送后关联反馈而不生成活跃卡片', () => {
  const s = seed(),
    ref = reference(s),
    count = s.briefing!.cards.length;
  const id = openFeedbackConversation(s, ref),
    chat = s.chats.find((c) => c.id === id)!;
  assert.equal(currentFeedback(s, ref.snapshot), undefined);
  assert.deepEqual(chat.briefingContext!.snapshot, ref.snapshot);
  assert.ok(Object.keys(chat.briefingContext!.feedback!.refVersions).length);
  assert.equal(chat.messages.filter((m) => m.role === 'user').length, 0);
  replyToBriefing(s, id, '请分析工作日的客流，不要只汇总金额');
  assert.equal(currentFeedback(s, ref.snapshot)?.reason, 'custom');
  assert.equal(chat.briefingContext!.feedback!.pending, false);
  replyToBriefing(s, id, '补充：按时段分析');
  assert.equal(currentFeedback(s, ref.snapshot)?.text, '请分析工作日的客流，不要只汇总金额');
  syncBriefing(s);
  assert.equal(s.briefing!.cards.length, count);
  assert.equal(recommendBriefing(s).find((r) => r.id === ref.cardId)?.group, 'unread');
  assert.equal(openFeedbackConversation(s, ref), id);
});

test('推荐刷新分组：普通已读在后，关注与活跃保留，没用本身不隐藏或删除', () => {
  const s = seed(),
    c = source(s);
  const before = recommendBriefing(s);
  markBriefingRead(s, c.data);
  assert.equal(before.find((r) => r.id === c.id)?.group, 'unread');
  assert.equal(recommendBriefing(s).find((r) => r.id === c.id)?.group, 'read');
  c.pinned = true;
  assert.equal(recommendBriefing(s).find((r) => r.id === c.id)?.group, 'priority');
  setBriefingFeedback(s, c.data, 'useless', 'shallow');
  assert.equal(c.hidden, false);
  assert.ok(recommendBriefing(s).some((r) => r.id === c.id));
});

test('失权后不能写入反馈、阅读或转发；个人会话不因转发变为共享', () => {
  const s = seed(),
    ref = reference(s);
  const c = s.briefing!.cards.find((c) => c.data.sourceKind === 'conversation')!;
  assert.ok(briefingRecipients(s, c.data).every((r) => !r.allowed));
  s.spaces.find((space) => space.id === ref.snapshot.space)!.members = [];
  assert.throws(() => markBriefingRead(s, ref.snapshot));
  assert.throws(() => setBriefingFeedback(s, ref.snapshot, 'useful'));
  assert.throws(() => simulateBriefingShare(s, ref, '任意同事', ''));
});

test('演示转发只记录所选卡片与说明，收件权限重验，不携带会话或改变双方阅读状态', () => {
  const s = seed();
  const card = s.briefing!.cards.find((c) => briefingRecipients(s, c.data).some((r) => r.allowed))!;
  const ref = { cardId: card.id, snapshot: card.data, asOf: card.updatedAt, config: cardConfig(card) };
  const to = briefingRecipients(s, card.data).find((r) => r.allowed)!.name;
  const chats = JSON.stringify(s.chats);
  simulateBriefingShare(s, ref, to, '  请参考  ');
  assert.equal(s.briefing!.shares!.length, 1);
  assert.equal(s.briefing!.shares![0].simulated, true);
  assert.equal(s.briefing!.shares![0].note, '请参考');
  assert.equal(JSON.stringify(s.chats), chats);
  assert.equal(isBriefingRead(s, card.data), false);
  s.spaces.forEach((sp) => {
    sp.members = sp.members.filter((n) => n !== to);
  });
  assert.throws(() => simulateBriefingShare(s, ref, to, '再次转发'));
  assert.equal(s.briefing!.shares!.length, 1);
});

test('收敛快捷原因后，旧版本原因仍可读取、修改和撤销', () => {
  const s = seed(),
    c = source(s);
  setBriefingFeedback(s, c.data, 'useless', 'timing');
  assert.equal(feedbackReasonLabel(currentFeedback(s, c.data)?.reason), '现在不需要');
  setBriefingFeedback(s, c.data, 'useless', 'shallow');
  assert.equal(feedbackReasonLabel(currentFeedback(s, c.data)?.reason), '分析或建议没帮助');
  setBriefingFeedback(s, c.data, null);
  assert.equal(currentFeedback(s, c.data), undefined);
});
