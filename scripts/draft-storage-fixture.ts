import type { Page } from '@playwright/test';

/** Fail only draft writes; authentication and unrelated browser storage remain usable. */
export async function blockDraftWrites(page: Page, prefix: string) {
  await page.evaluate((prefix) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) throw new DOMException('Synthetic quota exhausted', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage = () => {
      Storage.prototype.setItem = original;
    };
  }, prefix);
}
export async function restoreDraftWrites(page: Page) {
  await page.evaluate(() => (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage());
}
