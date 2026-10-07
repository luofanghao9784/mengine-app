import { telemetryChannels, type EngineTelemetry } from '../../contracts/public-api/engine-telemetry.ts';
import { changes, sample } from './engine-dashboard-model.ts';

/** Synthetic display data only: never submits jobs or reads customer records. */
export function busySnapshot(at: number): EngineTelemetry {
  const step = Math.floor(at / 3000);
  return {
    tenantId: null,
    checkedAt: new Date(at).toISOString(),
    recentSeconds: 300,
    evolution: 'NOT_CONNECTED',
    channels: telemetryChannels.map((code, i) => ({
      code,
      running: [9, 12, 15, 24, 7, 8, 5, 4, 18, 6][i] + ((step + i * 2) % 5) + (step % 4),
      queued: 3 + ((step * 3 + i) % 12),
      waiting: i % 3,
      failed: 0,
      unknown: 0,
      completedRecent: 40 + i * 7 + (step % 30),
      lastCompletedAt: new Date(at - i * 300).toISOString(),
    })),
  };
}
export function busyDemo(at: number) {
  const value = busySnapshot(at);
  return {
    value,
    samples: Array.from({ length: 40 }, (_, i) => sample(busySnapshot(at - (39 - i) * 3000))),
    log: changes(busySnapshot(at - 3000), value)
      .reverse()
      .slice(0, 4),
  };
}
