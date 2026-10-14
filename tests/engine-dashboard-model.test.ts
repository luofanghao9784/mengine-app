import test from 'node:test';
import assert from 'node:assert/strict';
import { telemetryChannels, type EngineTelemetry } from '../contracts/public-api/engine-telemetry.ts';
import type { OperationsOverview } from '../contracts/public-api/operations.ts';
import {
  addSample,
  attention,
  beads,
  changes,
  completions,
  particles,
  runs,
  sample,
  totals,
  week,
  type Sample,
} from '../src/operations/engine-dashboard-model.ts';
const snapshot = (patch: Partial<Record<string, Partial<EngineTelemetry['channels'][number]>>> = {}) =>
  ({
    tenantId: null,
    checkedAt: '2026-10-06T10:00:00Z',
    recentSeconds: 300,
    evolution: 'NOT_CONNECTED',
    channels: telemetryChannels.map((code) => ({
      code,
      running: 0,
      queued: 0,
      waiting: 0,
      failed: 0,
      unknown: 0,
      completedRecent: 0,
      lastCompletedAt: null,
      ...patch[code],
    })),
  }) as EngineTelemetry;
test('particles equal running records with a per-lane cap; queue beads show +n past ten', () => {
  assert.equal(particles(0), 0);
  assert.equal(particles(4), 4);
  assert.equal(particles(9), 6);
  assert.equal(particles(14, 10), 10);
  assert.deepEqual(beads(0), { shown: 0, more: 0 });
  assert.deepEqual(beads(10), { shown: 10, more: 0 });
  assert.deepEqual(beads(13), { shown: 10, more: 3 });
});
test('totals group channels by stage; streaming counts once in output', () => {
  const t = totals(
    snapshot({
      COLLECTION: { running: 2, queued: 3 },
      TASK: { running: 1, failed: 1 },
      GENERAL_ADJUSTMENT: { running: 1, unknown: 1 },
      RESPONSE: { running: 4, completedRecent: 5 },
    }),
  );
  assert.deepEqual(t, { in: 2, pr: 2, out: 4, r: 8, q: 3, w: 0, u: 1, f: 1, d: 5 });
});
test('attention combines task error codes with non-task telemetry without double counting', () => {
  const ops = {
    errors: [
      { code: 'TASK_MODEL_FAILED', tasks: 4, lastOccurredAt: '2026-10-06T09:00:00Z' },
      { code: 'TASK_RESULT_UNKNOWN', tasks: 1, lastOccurredAt: '2026-10-06T09:30:00Z' },
    ],
  } as OperationsOverview;
  const items = attention(
    snapshot({
      TASK: { failed: 4, unknown: 1 },
      COLLECTION: { failed: 3, queued: 12 },
      EXPORT: { unknown: 2 },
    }),
    ops,
  );
  assert.deepEqual(
    items.map((i) => [i.key, i.n]),
    [
      ['error:TASK_RESULT_UNKNOWN', 1],
      ['error:TASK_MODEL_FAILED', 4],
      ['failed:COLLECTION', 3],
      ['unknown:EXPORT', 2],
      ['queue:COLLECTION', 12],
    ],
  );
  assert.deepEqual(attention(snapshot(), undefined), []);
});
test('missing operations summary preserves task failures and unknown results from telemetry', () => {
  assert.deepEqual(
    attention(snapshot({ TASK: { failed: 2 }, RESPONSE: { unknown: 1 } }), undefined)
      .map((i) => [i.key, i.n]),
    [['failed:TASK', 2], ['unknown:RESPONSE', 1]],
  );
});
test('samples stay within five minutes and gaps are not joined', () => {
  const s = (at: number) => ({ ...totals(snapshot()), at, ch: {} }) as Sample;
  let list: Sample[] = [];
  for (const at of [0, 3000, 6000, 20000, 23000]) list = addSample(list, s(at));
  assert.deepEqual(
    runs(list).map((r) => r.map((x) => x.at)),
    [
      [0, 3000, 6000],
      [20000, 23000],
    ],
  );
  list = addSample(list, s(305000));
  assert.deepEqual(
    list.map((x) => x.at),
    [6000, 20000, 23000, 305000],
  );
});
test('week keeps the last seven days and leaves unreported tokens distinct from zero', () => {
  const days = Array.from({ length: 9 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10),
    workRequests: i,
    maintenanceCalls: null,
    unknownMaintenanceRuns: 0,
    inputTokens: i === 5 ? null : i * 10,
    outputTokens: i === 5 ? null : i,
  }));
  const w = week(days);
  assert.equal(w.length, 7);
  assert.equal(w[0].requests, 2);
  assert.equal(w[3].tokens, null);
  assert.equal(w[4].tokens, 66);
  assert.equal(w.at(-1)!.label, '今天');
  assert.ok(w.at(-1)!.today);
});
test('a sample keeps per-channel running and queued for the detail sparkline', () => {
  const v = sample(snapshot({ KNOWLEDGE: { running: 2, queued: 5 } }));
  assert.deepEqual(v.ch.KNOWLEDGE, [2, 5]);
  assert.equal(v.at, Date.parse('2026-10-06T10:00:00Z'));
});
test('change log lists exact snapshot differences only', () => {
  const prev = snapshot({ COLLECTION: { running: 3, queued: 5, failed: 1 }, TASK: { running: 2 } });
  const next = {
    ...snapshot({ COLLECTION: { running: 1, queued: 6, failed: 3 }, TASK: { running: 2 } }),
    checkedAt: '2026-10-06T10:00:03Z',
  };
  assert.deepEqual(
    changes(prev, next).map((c) => [c.code, c.text, c.delta, c.kind]),
    [
      ['COLLECTION', '新增异常', 2, 'alert'],
      ['COLLECTION', '执行中减少', -2, 'down'],
      ['COLLECTION', '排队增加', 1, 'down'],
    ],
  );
  assert.deepEqual(changes(prev, prev), []);
});
test('completion bursts come from snapshot deltas, never from the window size alone', () => {
  const c = (completedRecent: number, lastCompletedAt: string | null) =>
    snapshot({ TASK: { completedRecent, lastCompletedAt } }).channels.find((x) => x.code === 'TASK')!;
  assert.equal(completions(undefined, c(5, '2026-10-06T09:59:00Z')), 0);
  assert.equal(completions(c(5, '2026-10-06T09:59:00Z'), c(5, '2026-10-06T09:59:00Z')), 0);
  assert.equal(completions(c(5, '2026-10-06T09:59:00Z'), c(7, '2026-10-06T09:59:59Z')), 2);
  // The window can shrink while a new completion still lands.
  assert.equal(completions(c(5, '2026-10-06T09:59:00Z'), c(3, '2026-10-06T09:59:59Z')), 1);
  assert.equal(completions(c(0, null), c(0, null)), 0);
});

test('scene knowledge uses processing orbit; queued company sources do not fake running particles', () => {
  const t=totals(snapshot({SCENE_KNOWLEDGE:{running:2},COMPANY:{queued:20}}));
  assert.equal(t.pr,2);assert.equal(t.in,0);assert.equal(t.q,20);assert.equal(particles(t.pr),2);
  assert.equal(totals(snapshot({COMPANY:{queued:20}})).pr,0);
});

test('invalid particle counts cannot stop the animation frame', () => {
  for (const n of [NaN, Infinity, -Infinity, -3]) assert.equal(particles(n), 0);
  assert.equal(particles(2.8), 2);
  assert.equal(particles(4, NaN), 0);
  assert.equal(particles(4, -1), 0);
});
