import test from 'node:test';
import assert from 'node:assert/strict';
import { isRootEvent, toNativeEvent, type NativeEvent } from '../src/native-conversation/chat/events.ts';
import { buildTranscript } from '../src/native-conversation/chat/transcript.ts';
import { toStatus } from '../src/native-conversation/chat/status.ts';

const root = '5a995d29-9030-4f08-81cb-e869d8676c99';
const ev = (seq: number, type: string, data: unknown, extra: Partial<NativeEvent> = {}): NativeEvent => ({
  type,
  seq,
  time: seq * 1000,
  data,
  sessionId: root,
  ...extra,
});

test('platform envelopes accept DH millisecond and ISO times and drop malformed ones', () => {
  assert.equal(
    toNativeEvent({ type: 'turn/start', seq: 3, time: 1700000000000, data: {} })?.time,
    1700000000000,
  );
  assert.equal(
    toNativeEvent({ type: 'status', seq: 4, time: '2026-10-27T01:00:00Z', data: {} })?.time,
    Date.parse('2026-10-27T01:00:00Z'),
  );
  assert.equal(toNativeEvent({ type: 'x', seq: 1.5, time: 1, data: {} }), null);
  assert.equal(toNativeEvent({ type: 'x', seq: 1, time: 'not a time', data: {} }), null);
});

test('sub-task events stay out of the conversation', () => {
  assert.equal(isRootEvent(ev(1, 'turn/start', {}), root), true);
  assert.equal(isRootEvent(ev(2, 'turn/start', {}, { sessionId: 'child' }), root), false);
  assert.equal(isRootEvent({ type: 'subagent.started', seq: 3, time: 0, data: {} }, root), true);
});

const ask = (seq: number) =>
  ev(seq, 'question/asked', {
    callId: 'q1',
    timed: true,
    questions: [{ id: 'a', question: '谁补凭证？', options: [{ label: '郑西' }] }],
  });

test('question notices create the card once and track the deadline', () => {
  const t = buildTranscript([
    ev(1, 'turn/start', { turn: 1 }),
    ask(2),
    ev(3, 'tool/call', { callId: 'q1', name: 'ask_user_question', arguments: '{}' }),
    ev(4, 'question/deadline', { callId: 'q1', remainingMs: 120000, deadline: '2026-10-27T01:02:00Z' }),
  ]);
  const items = t.turns[0].items.filter((i) => i.kind === 'question');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind === 'question' && items[0].deadline, Date.parse('2026-10-27T01:02:00Z'));
  assert.equal(t.pending.questions, 1);
});

test('a timed-out question stays answerable; a late reply settles it; a cancelled one is not pending', () => {
  const timedOut = [
    ev(1, 'turn/start', { turn: 1 }),
    ask(2),
    ev(3, 'question/closed', { callId: 'q1', outcome: 'ASK_TIMED_OUT' }),
  ];
  let t = buildTranscript(timedOut);
  assert.equal(t.pending.questions, 1);
  t = buildTranscript([
    ...timedOut,
    ev(4, 'user/message', {
      id: 'm',
      source: { kind: 'user-question-reply', callId: 'q1' },
      content: [{ type: 'text', text: '郑西' }],
    }),
  ]);
  assert.equal(t.pending.questions, 0);
  assert.equal(t.turns[0].prompts.length, 0);
  t = buildTranscript([
    ev(1, 'turn/start', { turn: 1 }),
    ask(2),
    ev(3, 'question/closed', { callId: 'q1', outcome: 'ASK_ABORTED' }),
  ]);
  assert.equal(t.pending.questions, 0);
});

test('feedback targets the platform seq of the reply, and referenced materials are not shown as typed text', () => {
  const t = buildTranscript([
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'user/message', {
      id: 'u',
      source: { kind: 'user' },
      content: [
        {
          type: 'text',
          text: '核对一下\n\n用户引用的企业资料（须经 enterprise_read/search 按当前权限读取）：\n{"materialId":"a","versionId":"b"}',
        },
      ],
    }),
    ev(7, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '好的' }] } }),
  ]);
  assert.deepEqual(t.turns[0].prompts[0], { id: 'u', text: '核对一下', references: 1, attachments: 0 });
  const reply = t.turns[0].items[0];
  assert.equal(reply.kind === 'assistant' && reply.feedbackKey, '7');
});

test('status reports go stale after 10 seconds and count reservations', () => {
  const report = {
    time: 0,
    data: {
      running: true,
      executionClass: 'SYNTHETIC',
      budget: {
        usedYuan: 0.4,
        reservedYuan: 0.2,
        softYuan: 2,
        hardYuan: 5,
        elapsedMinutes: 3,
        blocked: null,
      },
    },
  };
  const fresh = toStatus(report, 9_000);
  assert.equal(fresh?.stale, false);
  assert.equal(fresh?.running, true);
  assert.equal(fresh?.synthetic, true);
  assert.equal(fresh?.budget?.reservedYuan, 0.2);
  assert.equal(toStatus(report, 11_000)?.stale, true);
  assert.equal(toStatus(null, 0), undefined);
});
