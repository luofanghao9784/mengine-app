import test from 'node:test';
import assert from 'node:assert/strict';
import { telemetryChannels } from '../contracts/public-api/engine-telemetry.ts';
import {
  createTelemetryClient,
  createTenantDistributionClient,
  isTelemetry,
  isTenantDistribution,
} from '../src/operations/telemetry-client.ts';
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
const row = (i: number, running: number) => ({
  tenantId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  tenantName: `合成企业 ${i}`,
  running,
});
const distribution = (rows = [row(1, 3), row(2, 1)], otherTenants = 0, otherRunning = 0) => ({
  checkedAt: '2026-10-06T10:00:00Z',
  tenants: rows,
  otherTenants,
  otherRunning,
});
test('tenant distribution accepts only bounded sorted counts without content', () => {
  assert.ok(isTenantDistribution(distribution()));
  assert.ok(isTenantDistribution(distribution([])));
  const ten = Array.from({ length: 10 }, (_, i) => row(i + 1, 12 - i));
  assert.ok(isTenantDistribution(distribution(ten, 2, 3)));
  for (const bad of [
    distribution([row(1, 1), row(2, 3)]),
    distribution([row(1, 0)]),
    distribution([row(1, 2), row(1, 1)]),
    distribution([{ ...row(1, 2), channels: [] } as never]),
    distribution([row(1, 2)], 1, 1),
    distribution(ten, 2, 0),
    distribution([...ten, row(11, 1)]),
    { ...distribution(), prompt: 'private' },
  ])
    assert.equal(isTenantDistribution(bad), false);
});
test('tenant distribution is read only from the platform endpoint', async () => {
  const calls: string[] = [];
  const read = createTenantDistributionClient((async (input) => {
    calls.push(String(input));
    return Response.json(distribution());
  }) as typeof fetch);
  assert.equal((await read()).tenants.length, 2);
  assert.deepEqual(calls, ['/api/platform-admin/v1/engine-telemetry/tenants']);
});
