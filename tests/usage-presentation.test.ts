import test from 'node:test';
import assert from 'node:assert/strict';
import type { UsageDay } from '../contracts/public-api/usage';
import { usageTrendState } from '../src/operations/usage-presentation.ts';

const day: UsageDay = {
  date: '2026-10-04',
  workRequests: 0,
  maintenanceCalls: 0,
  unknownMaintenanceRuns: 0,
  inputTokens: null,
  outputTokens: null,
};

test('zero or absent daily observations use a compact empty presentation', () => {
  assert.deepEqual(usageTrendState([day]), {
    hasKnownActivity: false,
    hasUnknownMaintenance: false,
    unknownMaintenanceRuns: 0,
  });
  assert.equal(usageTrendState([]).hasKnownActivity, false);
});

test('unknown maintenance is retained alongside otherwise zero observations', () => {
  assert.deepEqual(usageTrendState([{ ...day, maintenanceCalls: null, unknownMaintenanceRuns: 2 }]), {
    hasKnownActivity: false,
    hasUnknownMaintenance: true,
    unknownMaintenanceRuns: 2,
  });
  assert.equal(usageTrendState([{ ...day, maintenanceCalls: null }]).hasUnknownMaintenance, true);
});

test('either daily source keeps the chart without concealing incomplete maintenance', () => {
  assert.equal(usageTrendState([{ ...day, workRequests: 1 }]).hasKnownActivity, true);
  assert.equal(usageTrendState([{ ...day, maintenanceCalls: 1 }]).hasKnownActivity, true);
  const result = usageTrendState([
    day,
    { ...day, workRequests: 5, maintenanceCalls: null, unknownMaintenanceRuns: 1 },
  ]);
  assert.equal(result.hasKnownActivity, true);
  assert.equal(result.hasUnknownMaintenance, true);
  assert.equal(result.unknownMaintenanceRuns, 1);
});
