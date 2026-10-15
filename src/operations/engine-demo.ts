import { telemetryChannels, type EngineTelemetry, type TelemetryChannelCode } from '../../contracts/public-api/engine-telemetry.ts';
import { changes, sample } from './engine-dashboard-model.ts';

// Keyed by channel so inserting a channel cannot shift another channel's activity.
const demoRunning: Record<TelemetryChannelCode, number> = {
  COLLECTION: 9, KNOWLEDGE: 12, RETRIEVAL: 15, TASK: 24, COMPANY: 7,
  SCENE_KNOWLEDGE: 8, EXPERIENCE: 8, GENERALIZATION: 5,
  GENERAL_ADJUSTMENT: 4, RESPONSE: 18, EXPORT: 6,
};

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
      running: demoRunning[code] + ((step + i * 2) % 5) + (step % 4),
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
