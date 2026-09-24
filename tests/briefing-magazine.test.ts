import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { addMessage } from '../src/model.ts';
import { openBriefingChat, syncBriefing } from '../src/briefing.ts';
import {
  magazineFilter,
  magazineHeadline,
  magazineType,
  magazineTypes,
  magazineView,
} from '../src/briefingMagazine.ts';
import { briefingPeriod, briefingSource, briefingTime } from '../src/briefingTypography.ts';

const fixture = () => syncBriefing(createKongguSeed(), '2026-09-24T01:00:00.000Z');

test('混合日期卡片明确区分今天、往期、跨年及完整快照时间', () => {
  const now = new Date(2026, 8, 24, 9, 0);
  const at = (y: number, m: number, d: number, h = 9, minute = 26) =>
    new Date(y, m - 1, d, h, minute).toISOString();
  assert.equal(briefingTime(at(2026, 9, 24), false, now), '今天 09:26');
  assert.equal(briefingTime(at(2026, 9, 20), false, now), '9月20日 09:26');
  assert.equal(briefingTime(at(2025, 9, 20), false, now), '2025年9月20日 09:26');
  assert.equal(briefingTime(at(2026, 9, 20), true, now), '2026年9月20日 09:26');
  assert.equal(briefingTime(at(2026, 9, 23, 23, 59), false, new Date(2026, 8, 24, 0, 1)), '9月23日 23:59');
  assert.equal(briefingTime('invalid', false, now), '时间待核实');
  assert.equal(briefingPeriod('9/13—9/19 · 零售净销售额'), '统计期：9月13日—9月19日 · 零售净销售额');
  assert.equal(briefingPeriod('截至 9/19 · 未到账余额'), '截至 9月19日 · 未到账余额');
  assert.equal(briefingPeriod('拟议计划 · 不代表已批准'), '拟议计划 · 不代表已批准');
  assert.equal(briefingSource('贵州网 · 原文 2026-09-14'), '贵州网 · 发布于2026年9月14日');
});

test('统一显示标题尊重自定义标题与历史内容，不改写事实或快照', () => {
  const state = fixture();
  const original = structuredClone(state);
  const data = state.briefing!.cards.find((c) => c.id === 'konggu:C01')!.data;
  assert.equal(magazineHeadline(data), '过去7天，零售向上。');
  assert.equal(magazineHeadline(data, '我的零售复盘'), '我的零售复盘');
  assert.equal(magazineHeadline({ ...data, fact: '已更新，须重新核对' }), data.title);
  assert.deepEqual(state, original);
});

test('六类展示、旧筛选恢复与原卡会话相互独立，读取不修改存储', () => {
  const state = fixture();
  const original = structuredClone(state);
  assert.deepEqual(new Set(state.briefing!.cards.map((c) => magazineType(c.data))), new Set(magazineTypes));
  for (const c of state.briefing!.cards) magazineView(c.data);
  assert.deepEqual(state, original);
  assert.equal(magazineFilter('经营数据'), '数据');
  assert.equal(magazineFilter('风险提醒'), '建议');
  assert.equal(magazineFilter('活跃会话'), '会话');
  assert.equal(magazineFilter('会话'), '会话');
  assert.equal(magazineFilter('失效筛选'), '全部');
  const card = state.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  openBriefingChat(state, card.id, 'content');
  assert.equal(magazineType(card.data), '数据');
  assert.equal(card.data.type, '经营数据');
  const conversation = state.briefing!.cards.find((c) => c.id === 'conversation:kg-review')!;
  assert.equal(magazineType({ ...conversation.data, type: '经营数据' }), '会话');
});

test('杂志摘要保留原始事实和限定条件；源内容更新不复用旧版配图与摘要', () => {
  const s = fixture();
  const source = (id: string) => s.briefing!.cards.find((c) => c.id === `konggu:${id}`)!.data;
  assert.match(magazineView(source('C17')).note!, /购买意愿未验证/);
  assert.deepEqual(magazineView(source('C17')).dots, { selected: 9, total: 12 });
  assert.match(magazineView(source('C15')).photo!.credit, /AI.*非产品实拍/);
  const updated = { ...source('C15'), fact: '更新后的空间观察，结论尚未形成' };
  assert.equal(magazineView(updated).photo, undefined);
  assert.equal(magazineView(updated).summary, updated.fact);
  const updatedValue = { ...source('C02'), value: '+8.0%' };
  assert.equal(magazineView(updatedValue).value, '+8.0%');
  assert.equal(magazineView(updatedValue).headline, undefined);
});

test('活跃会话新回复和同一回复编辑立即替换旧数字、旧照片，原文不被摘要改写', () => {
  const s = fixture();
  const card = s.briefing!.cards.find((c) => c.id === 'conversation:kg-development')!;
  const originalFact = card.data.fact;
  assert.ok(magazineView(card.data).photo);
  const edited = { ...card.data, fact: '更新后的回答：仍需收集真实付费意愿。' };
  assert.equal(magazineView(edited).photo, undefined);
  assert.equal(magazineView(edited).summary, edited.fact);
  assert.equal(card.data.fact, originalFact);
  const chat = s.chats.find((c) => c.id === 'kg-review')!;
  addMessage(chat, 'assistant', '新核对结果：暂不提供综合销售数。');
  syncBriefing(s, '2026-09-24T02:00:00.000Z');
  const latest = s.briefing!.cards.find((c) => c.id === 'conversation:kg-review')!.data;
  assert.equal(magazineView(latest).value, undefined);
  assert.equal(magazineView(latest).summary, '新核对结果：暂不提供综合销售数。');
});
