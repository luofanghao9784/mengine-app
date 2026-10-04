/** Operational records, not proof of physical CPU/model concurrency. No business identifiers. */
export const telemetryChannels = [
  'COLLECTION',
  'KNOWLEDGE',
  'RETRIEVAL',
  'TASK',
  'COMPANY',
  'EXPERIENCE',
  'GENERALIZATION',
  'GENERAL_ADJUSTMENT',
  'RESPONSE',
  'EXPORT',
] as const;
export type TelemetryChannelCode = (typeof telemetryChannels)[number];
export interface TelemetryChannel {
  code: TelemetryChannelCode;
  running: number;
  queued: number;
  waiting: number;
  failed: number;
  unknown: number;
  completedRecent: number;
  lastCompletedAt: string | null;
}
export interface EngineTelemetry {
  tenantId: string | null;
  checkedAt: string;
  recentSeconds: 300;
  evolution: 'NOT_CONNECTED';
  channels: TelemetryChannel[];
}
