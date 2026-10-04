/** Let the browser handle interior Tab moves; wrap only at the navigation boundary. */
export function navigationTabTarget<T>(targets: readonly T[], active: unknown, backwards: boolean): T | null {
  if (!targets.length) return null;
  const index = targets.findIndex((target) => target === active);
  if (index < 0) return backwards ? targets[targets.length - 1] : targets[0];
  if (backwards && index === 0) return targets[targets.length - 1];
  if (!backwards && index === targets.length - 1) return targets[0];
  return null;
}
