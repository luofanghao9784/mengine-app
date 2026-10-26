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
