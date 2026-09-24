import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBriefingArticle, withBriefingArticle } from '../src/briefingArticle.ts';
import { cardConfig, openBriefingChat, syncBriefing } from '../src/briefing.ts';
import { openFeedbackConversation } from '../src/briefingFeedback.ts';
import { createKongguSeed } from '../src/kongguSeed.ts';
import { kongguCards } from '../src/kongguBriefing.ts';

function setup() {
  const state = syncBriefing(createKongguSeed());
  const card = state.briefing!.cards.find((c) => c.id === 'konggu:C01')!;
  const reference = withBriefingArticle({
    cardId: card.id,
    asOf: card.updatedAt,
    snapshot: structuredClone(card.data),
    config: cardConfig(card),
  });
  return { state, card, reference };
}

test('延伸阅读覆盖40张既有样例，不改来源事实、日期或历史，也不套用到已变更事实', () => {
  const { state, card } = setup();
  const before = JSON.stringify(state.briefing);
  const articles = kongguCards.map(buildBriefingArticle);
  assert.equal(articles.length, 40);
  assert.equal(new Set(articles.map((a) => JSON.stringify(a))).size, 40);
  for (const article of articles)
    assert.ok(article.sections.flatMap((s) => s.paragraphs).join('').length > 100);
  assert.equal(JSON.stringify(state.briefing), before);
  const changed = buildBriefingArticle({ ...card.data, fact: '另一时期的新事实，需要重新核对' });
  assert.ok(!JSON.stringify(changed).includes('这次增长，可以怎样理解'));
});

test('正文随所读快照进入业务和反馈会话，之后改动调用方或当前来源不会覆盖留存', () => {
  const { state, reference } = setup();
  const expected = structuredClone(reference.article);
  const id = openBriefingChat(
    state,
    reference.cardId,
    'content',
    { at: reference.asOf, data: reference.snapshot, article: reference.article },
    reference.config,
  );
  const chat = state.chats.find((c) => c.id === id)!;
  assert.deepEqual(chat.briefingContext!.article, expected);
  assert.deepEqual(chat.messages.at(-1)!.briefing!.article, expected);
  const feedbackId = openFeedbackConversation(state, reference);
  const feedback = state.chats.find((c) => c.id === feedbackId)!;
  assert.deepEqual(feedback.briefingContext!.article, expected);
  assert.deepEqual(feedback.messages.at(-1)!.briefing!.article, expected);
  reference.article!.sections[0].paragraphs[0] = '外部对象发生修改';
  reference.snapshot.fact = '新事实';
  syncBriefing(state);
  assert.deepEqual(chat.briefingContext!.article, expected);
  assert.deepEqual(chat.messages.at(-1)!.briefing!.article, expected);
  assert.deepEqual(feedback.messages.at(-1)!.briefing!.article, expected);
});

test('再次打开旧快照复用会话，保留已经留存的正文而不复制历史消息', () => {
  const { state, reference } = setup();
  const snapshot = { at: reference.asOf, data: reference.snapshot, article: reference.article };
  const id = openBriefingChat(state, reference.cardId, 'content', snapshot, reference.config);
  const chat = state.chats.find((c) => c.id === id)!;
  const original = JSON.stringify(chat.messages);
  assert.equal(openBriefingChat(state, reference.cardId, 'content', snapshot, reference.config), id);
  assert.equal(JSON.stringify(chat.messages), original);
});
