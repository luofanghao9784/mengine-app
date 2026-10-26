import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript } from '../src/native-conversation/chat/transcript.ts';
import { syntheticNativeEvents } from '../src/native-conversation/chat/fixture.ts';
import type { NativeEvent } from '../src/native-conversation/chat/events.ts';

test('turns, prompts, replies and tool steps follow the DH log in order', () => {
  const t = buildTranscript(syntheticNativeEvents());
  assert.equal(t.title, '荔星中心店十月收款复核');
  assert.equal(t.turns.length, 2);
  const [first, second] = t.turns;
  assert.equal(first.prompts[0].text.startsWith('帮我复核'), true);
  assert.deepEqual(
    first.items.map((i) => i.kind),
    ['assistant', 'tool', 'tool', 'assistant', 'tool', 'deliverables'],
  );
  const search = first.items[1];
  assert.equal(search.kind === 'tool' && search.status, 'done');
  assert.equal(first.end?.kind, 'completed');
  assert.equal(second.end, undefined);
  assert.equal(t.running, true);
});

test('pending approvals and questions are what the employee must act on', () => {
  const t = buildTranscript(syntheticNativeEvents());
  assert.deepEqual(t.pending, { approvals: 1, questions: 1, planReview: false });
  const question = t.turns[1].items.find((i) => i.kind === 'question');
  assert.equal(question?.kind === 'question' && question.questions[0].options?.length, 2);
});

test('decisions and answers settle their cards; closing a turn interrupts unfinished tools', () => {
  const events = syntheticNativeEvents();
  let seq = events.at(-1)!.seq;
  const more = (type: string, data: unknown): NativeEvent => ({ type, seq: ++seq, time: 0, data });
  const t = buildTranscript([
    ...events,
    more('approval/decided', { id: 'ap1', outcome: 'rejected' }),
    more('tool/result', {
      message: { role: 'tool', toolCallId: 'c5', content: [{ type: 'text', text: '郑西' }] },
    }),
    more('turn/end', { turn: 2, reason: { kind: 'aborted' } }),
  ]);
  assert.deepEqual(t.pending, { approvals: 0, questions: 0, planReview: false });
  assert.equal(t.running, false);
  const save = t.turns[1].items.find((i) => i.kind === 'tool' && i.callId === 'c4');
  assert.equal(save?.kind === 'tool' && save.status, 'interrupted');
  const approval = t.turns[1].items.find((i) => i.kind === 'approval');
  assert.equal(approval?.kind === 'approval' && approval.outcome, 'rejected');
});

test('only prompts typed by the employee are shown; injected context is not', () => {
  const t = buildTranscript([
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 2,
      time: 0,
      data: { id: 'x', source: { kind: 'skill' }, content: [{ type: 'text', text: '技能说明' }] },
    },
    {
      type: 'user/message',
      seq: 3,
      time: 0,
      data: { id: 'y', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    },
  ]);
  assert.deepEqual(
    t.turns[0].prompts.map((p) => p.text),
    ['你好'],
  );
});

test('duplicates, unknown types and malformed payloads are skipped without breaking the view', () => {
  const t = buildTranscript([
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'team/message/queued', seq: 2, time: 0, data: { anything: true } },
    { type: 'tool/result', seq: 3, time: 0, data: null },
    { type: 'compaction/start', seq: 4, time: 0, data: {} },
  ]);
  assert.equal(t.turns.length, 1);
  assert.equal(t.maintenance, 'compacting');
  assert.equal(t.lastSeq, 4);
});
