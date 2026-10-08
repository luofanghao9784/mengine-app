/** Visual-only cycle. It never represents or starts a real evolution task. */
export type EvolutionPhase = '待接入' | '静态演示' | '巡检中' | '扫描中' | '校准中' | '修复中' | '验证中';
export const EVOLUTION_ORBIT_SECONDS = 28;
export const EVOLUTION_SCAN_SECONDS = 9;

/** Seeded per-orbit schedule: two complete scans, with at least one second between them and at the seam. */
export function evolutionScanStarts(orbit: number, seed: number): [number, number] {
  const random = (salt: number) => {
    let x = (Math.imul(orbit + 1, 0x9e3779b1) ^ seed ^ salt) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  };
  const firstGap = 1 + 7 * random(0x68bc21eb);
  const middleGap = 1 + (8 - firstGap) * random(0x02e5be93);
  return [firstGap, firstGap + EVOLUTION_SCAN_SECONDS + middleGap];
}

export function evolutionFrame(seconds: number, demo: boolean, reduced: boolean, seed = 0) {
  const active = demo && !reduced;
  const time = active ? Math.max(0, seconds) : 0;
  const orbit = Math.floor(time / EVOLUTION_ORBIT_SECONDS);
  const cycle = time % EVOLUTION_ORBIT_SECONDS;
  const start = evolutionScanStarts(orbit, seed).find(
    (value) => cycle >= value && cycle < value + EVOLUTION_SCAN_SECONDS,
  );
  const scanTime = active && start !== undefined ? cycle - start : -1;
  const phase: EvolutionPhase = !demo
    ? '待接入'
    : reduced
      ? '静态演示'
      : scanTime < 0
        ? '巡检中'
        : scanTime < 2
          ? '扫描中'
          : scanTime < 5
            ? '校准中'
            : scanTime < 7
              ? '修复中'
              : '验证中';
  const angle = -2.5 + (time * Math.PI * 2) / EVOLUTION_ORBIT_SECONDS;
  const strength = scanTime >= 0 ? Math.min(1, scanTime / 1.2, (EVOLUTION_SCAN_SECONDS - scanTime) / 1.5) : 0;
  return {
    active,
    phase,
    cycle,
    scanTime,
    angle,
    strength,
    repair: scanTime < 0 ? 0 : Math.min(1, Math.max(0, (scanTime - 2) / 5)),
  };
}

/** Integrate angular velocity; scan transitions must never scale elapsed time. */
export function advanceSatelliteRoll(
  angle: number,
  deltaSeconds: number,
  frame: Pick<ReturnType<typeof evolutionFrame>, 'active' | 'strength'>,
) {
  if (!frame.active) return angle;
  const strength = Math.max(0, Math.min(1, frame.strength));
  const eased = strength * strength * (3 - 2 * strength);
  // Visible scan rotation, smoothly returning to a quiet patrol spin.
  const speed = 0.32 + ((Math.PI * 2) / 3 - 0.32) * eased;
  return (angle + Math.max(0, Math.min(1 / 30, deltaSeconds)) * speed) % (Math.PI * 2);
}
