import test from 'node:test';
import assert from 'node:assert/strict';
import { telemetryChannels } from '../contracts/public-api/engine-telemetry.ts';
import { createTelemetryClient, isTelemetry } from '../src/operations/telemetry-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const snapshot = (id: string | null = null) => ({
  tenantId: id,
  checkedAt: '2026-10-04T10:00:00Z',
  recentSeconds: 300,
  evolution: 'NOT_CONNECTED',
  channels: telemetryChannels
    .filter((c) => !id || c !== 'GENERAL_ADJUSTMENT')
    .map((code) => ({
      code,
      running: 0,
      queued: 0,
      waiting: 0,
      failed: 0,
      unknown: 0,
      completedRecent: 0,
      lastCompletedAt: null,
    })),
});
test('telemetry validates exact bounded vocabulary and rejects private payloads, false timestamps and missing channels', () => {
  assert.ok(isTelemetry(snapshot()));
  assert.ok(isTelemetry(snapshot(tenant)));
  for (const change of [
    { prompt: 'private' },
    { evolution: 'RUNNING' },
    { recentSeconds: 60 },
    { checkedAt: 'invalid' },
    { channels: snapshot().channels.slice(1) },
  ])
    assert.equal(isTelemetry({ ...snapshot(), ...change }), false);
  for (const change of [
    { running: -1 },
    { running: 0.5 },
    { code: 'MODEL_RAW' },
    { lastCompletedAt: '2026-10-04T11:00:00Z' },
    { trace: 'private' },
  ]) {
    const s = snapshot();
    Object.assign(s.channels[0], change);
    assert.equal(isTelemetry(s), false);
  }
  const duplicate = snapshot();
  duplicate.channels[1] = duplicate.channels[0];
  assert.equal(isTelemetry(duplicate), false);
  assert.equal(isTelemetry({ ...snapshot(tenant), channels: snapshot().channels }), false);
});
test('endpoint and returned tenant are fixed by realm; mismatches never become visible', async () => {
  const calls: string[] = [];
  const client = createTelemetryClient((async (input) => {
    calls.push(String(input));
    return Response.json(snapshot(tenant));
  }) as typeof fetch);
  assert.ok(await client('tenant', tenant));
  assert.equal(calls[0], `/api/tenant-admin/v1/tenants/${tenant}/engine-telemetry`);
  await assert.rejects(client('platform', null), { code: 'CONTRACT_MISMATCH' });
  assert.throws(() => client('platform', tenant), { code: 'INVALID_REQUEST' });
  assert.throws(() => client('tenant', null), { code: 'INVALID_REQUEST' });
});
