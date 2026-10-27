import type { NativeStatus } from './NativeChat';

/** Status reports arrive every 2 s while a runtime is up; older than this is not a current fact (appendix C). */
const FRESH_MS = 10_000;

export type StatusEnvelope = { time: number; data: Record<string, unknown> };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function toStatus(envelope: StatusEnvelope | null, now: number, lifecycleTime = 0): NativeStatus | undefined {
  if (!envelope) return undefined;
  const d = envelope.data;
  const b = d.budget && typeof d.budget === 'object' ? (d.budget as Record<string, unknown>) : null;
  const used = num(b?.usedYuan);
  const soft = num(b?.softYuan);
  const hard = num(b?.hardYuan);
  return {
    running: typeof d.running === 'boolean' && envelope.time >= lifecycleTime ? d.running : undefined,
    stale: now - envelope.time > FRESH_MS,
    synthetic: d.executionClass === 'SYNTHETIC',
    ...(used !== undefined && soft !== undefined && hard !== undefined
      ? {
          budget: {
            usedYuan: used,
            reservedYuan: num(b?.reservedYuan),
            softYuan: soft,
            hardYuan: hard,
            elapsedMinutes: num(b?.elapsedMinutes),
            blocked: typeof b?.blocked === 'string' ? b.blocked : null,
          },
        }
      : {}),
  };
}
