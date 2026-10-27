import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkState, hasWork } from '../src/native-conversation/chat/work.ts';
import { buildTranscript } from '../src/native-conversation/chat/transcript.ts';
import { syntheticNativeEvents, syntheticWorkEvents } from '../src/native-conversation/chat/fixture.ts';
import type { NativeEvent } from '../src/native-conversation/chat/events.ts';

const ev = (seq: number, type: string, data: unknown): NativeEvent => ({ type, seq, time: 1000 * seq, data });

test('long-task progress is read from the DH log', () => {
  const w = buildWorkState(syntheticWorkEvents(100));
  assert.equal(hasWork(w), true);
  assert.equal(w.planMode, true);
  assert.equal(w.goal?.phase, 'active');
  assert.equal(w.todos.length, 3);
  assert.deepEqual(
    w.jobs.map((j) => j.status),
    ['completed', 'running'],
  );
  assert.equal(w.subtasks[0].label, '凭证核对助手');
  assert.deepEqual(
    w.workflows[0].agents.map((a) => a.outcome),
    ['completed', undefined],
  );
});

test('the latest to-do list replaces the earlier one, and clearing a goal removes it', () => {
  const w = buildWorkState([
    ev(1, 'todo/write', { todos: [{ content: 'a', status: 'pending' }] }),
    ev(2, 'goal/change', {
      operation: 'create',
      goal: { objective: 'x', phase: 'active', maxGoalRounds: 5 },
      roundsStarted: 1,
    }),
    ev(3, 'todo/write', {
      todos: [
        { content: 'b', status: 'completed' },
        { content: 'bad', status: 'odd' },
      ],
    }),
    ev(4, 'goal/change', { operation: 'clear' }),
  ]);
  assert.deepEqual(w.todos, [{ content: 'b', status: 'completed' }]);
  assert.equal(w.goal, null);
});

test('a settled job keeps the label it was registered with; unknown outcomes count as failed', () => {
  const w = buildWorkState([
    ev(1, 'job/registered', { jobId: 'j', label: '导出', kind: 'shell', startedAt: 500 }),
    ev(2, 'job/settled', { jobId: 'j', finishedAt: 900, status: 'weird' }),
  ]);
  assert.deepEqual(w.jobs[0], {
    id: 'j',
    label: '导出',
    kind: 'shell',
    startedAt: 500,
    finishedAt: 900,
    status: 'failed',
    detail: undefined,
  });
});

test('an empty log has no work to show', () => {
  assert.equal(hasWork(buildWorkState([])), false);
});

test('a pending plan review is flagged for the status bar', () => {
  const base = syntheticNativeEvents();
  const t = buildTranscript([...base, ...syntheticWorkEvents(base.at(-1)!.seq)]);
  assert.equal(t.pending.planReview, true);
});

const child = (seq: number, type: string, data: unknown, sessionId = 'child-1'): NativeEvent => ({
  type,
  seq,
  time: seq * 1000,
  data,
  sessionId,
});

test('a sub-task shows what its own session is doing right now', () => {
  const catalog = ev(1, 'subagent/catalog', {
    childId: 'child-1',
    label: '凭证核对助手',
    mode: 'continuable',
  });
  const w = buildWorkState(
    [catalog],
    [
      child(2, 'session.status', { status: 'running' }),
      child(3, 'turn/start', { turn: 1 }),
      child(4, 'tool/call', { callId: 'c1', name: 'enterprise_search', arguments: '{}' }),
      child(5, 'tool/result', { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } }),
      child(6, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '找到一笔' }] },
      }),
      child(7, 'tool/call', { callId: 'c2', name: 'enterprise_read', arguments: '{}' }),
      child(8, 'turn/start', { turn: 1 }, 'someone-else'),
    ],
  );
  const s = w.subtasks[0];
  assert.equal(s.state, 'running');
  assert.equal(s.current, '正在读取企业资料…');
  assert.equal(s.steps, 2);
  assert.equal(s.output, '找到一笔');
});

test('the finish notice decides the outcome and carries the final output', () => {
  const w = buildWorkState([
    ev(1, 'subagent.started', { parentSessionId: 'root', childSessionId: 'child-2' }),
    ev(2, 'subagent.finished', {
      childSessionId: 'child-2',
      status: 'error',
      stopReason: 'error',
      lastAssistantMessage: [{ type: 'text', text: '资料读取失败' }],
    }),
  ]);
  assert.deepEqual(
    { label: w.subtasks[0].label, state: w.subtasks[0].state, output: w.subtasks[0].output },
    { label: '子任务', state: 'failed', output: '资料读取失败' },
  );
});

const reply = (seq: number, value: string, sessionId = 'child'): NativeEvent =>
  child(
    seq,
    'assistant/message',
    { turn: 1, step: 1, message: { content: [{ type: 'text', text: value }] } },
    sessionId,
  );
const finished = (seq: number, data: Record<string, unknown>) =>
  ev(seq, 'subagent.finished', { childSessionId: 'child', status: 'ok', stopReason: 'completed', ...data });

test('the output selected at finish outranks a different earlier reply from the child', () => {
  const w = buildWorkState(
    [
      ev(1, 'subagent.started', { parentSessionId: 'root', childSessionId: 'child' }),
      finished(3, { lastAssistantMessage: [{ type: 'text', text: 'selected final output' }] }),
    ],
    [reply(2, 'previous child reply')],
  );
  assert.equal(w.subtasks[0].state, 'done');
  assert.equal(w.subtasks[0].output, 'selected final output');
});

test('without usable final output the child history reply is the fallback', () => {
  for (const data of [
    {},
    { lastAssistantMessage: [] },
    { lastAssistantMessage: [{ type: 'text', text: '  ' }] },
  ]) {
    const w = buildWorkState(
      [ev(1, 'subagent.started', { parentSessionId: 'root', childSessionId: 'child' }), finished(3, data)],
      [reply(2, 'previous child reply')],
    );
    assert.equal(w.subtasks[0].output, 'previous child reply');
    assert.equal(w.subtasks[0].state, 'done');
  }
});

test('a failed finish keeps its outcome, and other sessions do not leak into the sub-task', () => {
  const w = buildWorkState(
    [
      ev(1, 'subagent.started', { parentSessionId: 'root', childSessionId: 'child' }),
      finished(4, { status: 'error', lastAssistantMessage: [{ type: 'text', text: '读取失败' }] }),
    ],
    [child(2, 'session.status', { status: 'running' }), reply(3, '另一个子任务的话', 'other-child')],
  );
  assert.deepEqual(
    { state: w.subtasks[0].state, output: w.subtasks[0].output, current: w.subtasks[0].current },
    { state: 'failed', output: '读取失败', current: undefined },
  );
});
