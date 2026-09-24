/** Test-only browser selection; never changes product configuration. */
import { chromium, firefox, webkit } from '@playwright/test';
const targets = { chromium, firefox, webkit };
const selected = process.env.DREAMCORE_TEST_BROWSER || 'chromium';
if (!Object.hasOwn(targets, selected)) throw new Error('Unknown test browser: ' + selected);
export const browserName = selected as keyof typeof targets;
export const browserType = targets[browserName];
export function browserArtifacts(journey: string, fallback: string) {
  return process.env.DREAMCORE_TEST_BROWSER ? `.local/m7-browser/${browserName}/${journey}` : fallback;
}
