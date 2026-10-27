import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRule,
  emptyForm,
  formProblems,
  fromConfig,
  resumable,
  toConfig,
  toRule,
} from '../src/native-conversation/schedules.ts';
import type { NativeSchedule } from '../contracts/public-api/native-conversations.ts';

const base = {
  ...emptyForm(new Date(2026, 9, 27, 10), 'Asia/Shanghai'),
  title: '收款复核',
  prompt: '核对昨天的收款',
};

test('each repeat choice becomes the DH 0.2.1 rule shape', () => {
  assert.deepEqual(toRule({ ...base, repeat: 'daily', time: '09:30' }), {
    kind: 'daily',
    daily: { time: '09:30:00', time_zone: 'Asia/Shanghai' },
  });
  assert.deepEqual(toRule({ ...base, repeat: 'weekly', weekdays: [5, 1, 3] }), {
    kind: 'weekly',
    weekly: { time: '09:00:00', time_zone: 'Asia/Shanghai', weekdays: [1, 3, 5] },
  });
  assert.deepEqual(toRule({ ...base, repeat: 'once', date: '2026-10-28' }), {
    kind: 'at',
    at: { date: '2026-10-28', time: '09:00:00', time_zone: 'Asia/Shanghai' },
  });
  assert.deepEqual(toRule({ ...base, repeat: 'every', everyHours: 1.5 }), {
    kind: 'every',
    everySeconds: 5400,
  });
  assert.equal(toRule({ ...base, repeat: 'material' }), null);
});

test('material-only schedules always watch material updates; limits are converted to seconds', () => {
  const c = toConfig({ ...base, repeat: 'material', materialEvents: false, minIntervalMinutes: 30 });
  assert.equal(c.rule, null);
  assert.equal(c.materialEvents, true);
  assert.equal(c.minIntervalSeconds, 1800);
  assert.ok(Date.parse(c.expiresAt) > Date.now());
});

test('the form round-trips through a stored configuration for editing', () => {
  const form = { ...base, repeat: 'weekly' as const, weekdays: [2, 4], time: '18:15', maxRunsPerDay: 2 };
  const back = fromConfig(toConfig(form), base);
  assert.deepEqual(
    { repeat: back.repeat, weekdays: back.weekdays, time: back.time, maxRunsPerDay: back.maxRunsPerDay },
    { repeat: 'weekly', weekdays: [2, 4], time: '18:15', maxRunsPerDay: 2 },
  );
});

test('rules read as plain Chinese', () => {
  assert.equal(describeRule(toRule({ ...base, repeat: 'weekly', weekdays: [1, 3] })), '每周一、三 09:00');
  assert.equal(
    describeRule(toRule({ ...base, repeat: 'every', everyHours: 4 }), true),
    '每隔 4 小时，资料更新时也会运行',
  );
  assert.equal(describeRule(null), '资料更新时运行');
  assert.equal(describeRule(toRule({ ...base, repeat: 'once', date: '2026-10-28' })), '10月28日 09:00 一次');
});

test('missing pieces are listed before sending', () => {
  assert.deepEqual(formProblems(base), []);
  assert.deepEqual(formProblems({ ...base, title: ' ', repeat: 'weekly', weekdays: [] }), [
    '写一个名称',
    '至少选一天',
  ]);
  assert.deepEqual(formProblems({ ...base, repeat: 'cron', cron: '0 9 *' }), ['cron 需要 5 段']);
});

test('a schedule paused for an unknown outcome or past its end cannot be resumed', () => {
  const s = (reason: string | null, expiresAt = '2099-01-01T00:00:00Z') =>
    ({
      state: 'PAUSED',
      reason,
      configuration: { ...toConfig(base), expiresAt },
    }) as unknown as NativeSchedule;
  assert.equal(resumable(s(null)), true);
  assert.equal(resumable(s('OUTCOME_UNKNOWN')), false);
  assert.equal(resumable(s(null, '2020-01-01T00:00:00Z')), false);
});

test('empty and invalid expiry remain editable and cannot be submitted', () => {
  for (const expires of ['', 'invalid', '2026-02-30']) {
    const form = { ...base, expires };
    assert.ok(formProblems(form).includes('填写有效的截止日期'));
    assert.equal(toConfig(form).expiresAt, '');
  }
  assert.deepEqual(formProblems({ ...base, expires: '2026-12-01' }), []);
  assert.ok(Number.isFinite(Date.parse(toConfig({ ...base, expires: '2026-12-01' }).expiresAt)));
});

test('editing an after plan keeps one-shot semantics and exact seconds', () => {
  const configuration = { ...toConfig(base), rule: { kind: 'after' as const, afterSeconds: 3661 } };
  const form = fromConfig(configuration, base);
  assert.equal(form.repeat, 'after');
  assert.deepEqual(toConfig({ ...form, title: 'renamed' }).rule, configuration.rule);
  assert.ok(formProblems({ ...form, afterSeconds: 0 }).length);
});

test('absolute at is displayed in the form timezone and preserves the exact instant', () => {
  for (const at of ['2026-10-28T09:00:31.123Z', '2026-10-28T11:00:31.123+02:00']) {
    const configuration = { ...toConfig(base), rule: { kind: 'at' as const, at } };
    const form = fromConfig(configuration, base);
    assert.equal(form.date, '2026-10-28');
    assert.equal(form.time, '17:00');
    assert.deepEqual(toConfig({ ...form, title: 'renamed' }).rule, configuration.rule);
    assert.deepEqual(toConfig({ ...form, time: '18:00' }).rule, {
      kind: 'at',
      at: { date: '2026-10-28', time: '18:00:00', time_zone: 'Asia/Shanghai' },
    });
  }
});

test('at projection respects day rollover and DST and preserves object seconds', () => {
  const at = '2026-07-01T00:30:42Z';
  const c = { ...toConfig(base), rule: { kind: 'at' as const, at } };
  const form = fromConfig(c, { ...base, timeZone: 'America/New_York' });
  assert.equal(form.date, '2026-06-30');
  assert.equal(form.time, '20:30');
  assert.deepEqual(toConfig(form).rule, c.rule);
  const object = {
    ...c,
    rule: { kind: 'at' as const, at: { date: '2026-10-28', time: '09:00:31', time_zone: 'Asia/Shanghai' } },
  };
  assert.deepEqual(toConfig(fromConfig(object, base)).rule, object.rule);
});
