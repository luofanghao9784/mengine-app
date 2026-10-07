import test from 'node:test';
import assert from 'node:assert/strict';
import { busyDemo, busySnapshot } from '../src/operations/engine-demo.ts';
import { telemetryChannels } from '../contracts/public-api/engine-telemetry.ts';

test('busy demo covers every channel and changes without touching real telemetry', () => {
  const at = Date.parse('2026-10-07T02:00:00Z');
  const first = busySnapshot(at),
    second = busySnapshot(at + 3000);
  assert.deepEqual(
    first.channels.map((c) => c.code),
    [...telemetryChannels],
  );
  assert.ok(first.channels.every((c) => c.running > 0 && c.queued > 0));
  assert.notEqual(
    first.channels.reduce((n, c) => n + c.running, 0),
    second.channels.reduce((n, c) => n + c.running, 0),
  );
  assert.equal(first.evolution, 'NOT_CONNECTED');
  assert.equal(first.tenantId, null);
  const demo = busyDemo(at);
  assert.equal(demo.samples.at(-1)?.at, at);
  assert.ok(demo.samples.every((s, i, a) => i === 0 || s.at - a[i - 1].at === 3000));
  assert.ok(demo.log.length > 0);
  assert.deepEqual(first, busySnapshot(at));
});
