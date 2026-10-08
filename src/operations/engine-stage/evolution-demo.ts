/** Visual-only cycle. It never represents or starts a real evolution task. */
export type EvolutionPhase = '待接入' | '静态演示' | '巡检中' | '扫描中' | '校准中' | '修复中' | '验证中';
export function evolutionFrame(seconds: number, demo: boolean, reduced: boolean) {
  const active = demo && !reduced;
  const time = active ? Math.max(0, seconds) : 0;
  const cycle = time % 28;
  const phase: EvolutionPhase = !demo
    ? '待接入'
    : reduced
      ? '静态演示'
      : cycle < 4 || cycle >= 13
        ? '巡检中'
        : cycle < 6
          ? '扫描中'
          : cycle < 9
            ? '校准中'
            : cycle < 11
              ? '修复中'
              : '验证中';
  // Smoothly slow near the scan window, while preserving a complete 28-second orbit.
  const angle = -2.5 + (time * Math.PI * 2) / 28 - 0.45 * Math.sin(((cycle - 8.5) * Math.PI * 2) / 28);
  const strength =
    active && cycle >= 4 && cycle < 13 ? Math.min(1, (cycle - 4) / 1.2, (13 - cycle) / 1.5) : 0;
  return { active, phase, cycle, angle, strength, repair: Math.min(1, Math.max(0, (cycle - 6) / 5)) };
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
  const speed = 0.32 + 0.73 * eased;
  return (angle + Math.max(0, Math.min(1 / 30, deltaSeconds)) * speed) % (Math.PI * 2);
}
