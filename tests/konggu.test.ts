import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed, KONGGU_STORAGE_KEY } from '../src/kongguSeed.ts';
import { loadKongguState } from '../src/kongguStorage.ts';
import { syncBriefing, openBriefingChat, replyToBriefing } from '../src/briefing.ts';
import { addMessage, editMaterial, latest } from '../src/model.ts';
import { canReadMaterial } from '../src/libraryModel.ts';
import { replyKonggu } from '../src/kongguReply.ts';
import { kongguResearch as research } from '../src/kongguResearch.ts';

test('空谷40张内容卡和3张活跃会话卡、6空间、45资料，所有引用和原文可追溯，日期不会因刷新漂移', () => {
  const s = syncBriefing(createKongguSeed());
  assert.equal(s.spaces.length, 6);
  assert.equal(s.materials.length, 45);
  const authored = s.briefing!.cards.filter((c) => c.data.sourceKind !== 'conversation');
  assert.equal(authored.length, 40);
  assert.equal(s.briefing!.cards.filter((c) => c.data.sourceKind === 'conversation').length, 3);
  assert.equal(s.materials.filter((d) => d.type === '资讯').length, 10);
  for (const d of s.materials)
    for (const ref of d.relations)
      assert.ok(
        s.materials.some((d) => d.id === ref),
        ref,
      );
  for (const c of authored) {
    assert.ok(c.id.startsWith('konggu:'));
    assert.ok(c.active);
    for (const ref of c.data.refs || [])
      assert.ok(
        s.materials.some((d) => d.id === ref && canReadMaterial(s, d)),
        ref,
      );
    for (const link of c.data.sourceLinks || []) assert.ok(link.publishedAt <= c.updatedAt.slice(0, 10));
    if (c.updatedAt.slice(0, 10) < '2026-09-20')
      assert.ok(c.data.refs!.some((id) => id.startsWith('kg-edition-')));
  }
  assert.equal(new Set(authored.map((c) => c.updatedAt.slice(0, 10))).size, 4);
  const before = structuredClone(s.briefing);
  syncBriefing(s, '2026-10-01T00:00:00Z');
  assert.deepEqual(s.briefing, before);
  const ads = research.research.images.find((i) => i.id === 'I08')!;
  assert.ok(!JSON.stringify(s).includes(ads.url));
  assert.equal(s.briefing!.cards.filter((c) => c.data.photo).length, 3);
});

test('零售金额、渠道、分类和环比使用同一底表，收入不混算订金', () => {
  const b = research.business;
  const current = b.dailyRetail.slice(12);
  const prior = b.dailyRetail.slice(5, 12);
  const sum = (rows: typeof current) => rows.reduce((a, r) => a + r.netSalesFen, 0);
  assert.equal(sum(current), 4817800);
  assert.equal(sum(prior), 4278800);
  assert.equal(
    current.reduce((a, r) => a + r.completedOrders, 0),
    1307,
  );
  assert.equal(
    b.weeklyCategorySales.reduce((a, r) => a + r.netSalesFen, 0),
    sum(current),
  );
  assert.equal(
    b.weeklyChannels.reduce((a, r) => a + r.orders, 0),
    1307,
  );
  assert.equal(((sum(current) / sum(prior) - 1) * 100).toFixed(1), '12.6');
  assert.equal(sum(current) / 100 + 11400, 59578);
  assert.equal(8100 + 2400, 10500);
});

test('独立存储不读取或覆盖旧Demo，空谷的编辑、隐藏和固定在重新加载后保留', () => {
  const old = '{"legacy":"user changes"}';
  const map = new Map([['enterprise-ai-demo-v1', old]]);
  const storage = { getItem: (key: string) => map.get(key) || null };
  const s = loadKongguState(storage);
  assert.equal(s.scenario, 'konggu');
  s.briefing!.cards[0].pinned = true;
  s.briefing!.cards[0].hidden = true;
  editMaterial(s, 'kg-D01', '用户核对后的正文', '新的标题', '新简介', '手工修改');
  map.set(KONGGU_STORAGE_KEY, JSON.stringify(s));
  const next = loadKongguState(storage);
  assert.equal(next.briefing!.cards[0].pinned, true);
  assert.equal(next.briefing!.cards[0].hidden, true);
  assert.equal(latest(next.materials.find((d) => d.id === 'kg-D01')!).content, '用户核对后的正文');
  assert.equal(map.get('enterprise-ai-demo-v1'), old);
});

test('新品与活动预设回复生成可审阅草稿，引用精确版本而不执行外部动作', () => {
  const s = createKongguSeed();
  for (const [chatId, prompt, expected] of [
    ['kg-development', '整理新品验证计划', '9人偏好V2'],
    ['kg-event-plan', '整理30人读书会方案', '6,000元'],
  ]) {
    const chat = s.chats.find((c) => c.id === chatId)!;
    addMessage(chat, 'user', prompt);
    const id = replyKonggu(s, chat, prompt)!;
    const doc = s.materials.find((d) => d.id === id)!;
    assert.equal(doc.space, 'personal');
    assert.ok(latest(doc).content.includes(expected));
    const answer = chat.messages.at(-1)!;
    assert.ok(answer.text.includes('尚未调用真实模型'));
    for (const ref of answer.refs!) assert.equal(answer.refVersions![ref], `${ref}-v1`);
  }
  assert.equal(s.requests.length, 0);
  assert.equal(s.records.length, 11);
});

test('画报留存绑定v1；资料变更或无权访问后，不将旧结论当成新分析', () => {
  const s = syncBriefing(createKongguSeed());
  editMaterial(s, 'kg-D01', '数额改变', '零售', '新底表', '修改');
  const chatId = openBriefingChat(s, 'konggu:C01', 'content');
  const chat = s.chats.find((c) => c.id === chatId)!;
  assert.equal(chat.messages.at(-1)!.refVersions!['kg-D01'], 'kg-D01-v1');
  replyToBriefing(s, chatId, '拆解销售增长');
  assert.match(chat.messages.at(-1)!.text, /已有新版本/);
  s.materials = s.materials.filter((d) => d.id !== 'kg-D01');
  syncBriefing(s);
  assert.equal(s.briefing!.cards.find((c) => c.id === 'konggu:C01')!.active, false);
  const normal = s.chats.find((c) => c.id === 'kg-review')!;
  replyKonggu(s, normal, '整理经营复盘');
  assert.match(normal.messages.at(-1)!.text, /已删除|不可用/);
});

test('历史情境回复保留当期依据，过期版本和已失去权限的资料不被替换', () => {
  const s = syncBriefing(createKongguSeed());
  const id = openBriefingChat(s, 'konggu:C25', 'content');
  replyToBriefing(s, id, '整理活动清单');
  const message = s.chats.find((c) => c.id === id)!.messages.at(-1)!;
  assert.ok(message.refs!.includes('kg-edition-C25'));
  assert.ok(!message.text.includes('48,178'));
  const chat = s.chats.find((c) => c.id === 'kg-review')!;
  addMessage(chat, 'user', '核对资料', undefined, ['kg-D01']);
  chat.messages.at(-1)!.refVersions = { 'kg-D01': 'missing-version' };
  replyKonggu(s, chat, '核对资料');
  assert.match(chat.messages.at(-1)!.text, /引用版本已不可用/);
  const space = s.spaces.find((sp) => sp.id === 'finance')!;
  space.owner = '其他人';
  space.members = [];
  space.canEdit = false;
  syncBriefing(s);
  assert.ok(s.briefing!.cards.filter((c) => c.data.space === 'finance').every((c) => !c.active));
});
