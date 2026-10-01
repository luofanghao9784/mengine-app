import type { Page, APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
/** Run after real synthetic Harness has saved a preference for this current user's task. */
export async function taskWorkJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  task: string,
  conversation: string,
  artifacts: string,
) {
  const path = `/api/v1/tenants/${tenant}/tasks/${task}/work-receipts`;
  const before = await request.get(path);
  assert.equal(before.status(), 200);
  const data = await before.json();
  const preference = data.preferences.find((r: { canUndo: boolean }) => r.canUndo);
  assert.ok(preference, 'fixture must contain a real active preference receipt');
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.addInitScript(() => {
    const native = window.fetch.bind(window);
    (window as unknown as { workUndoProbe: { keys: string[]; armed: boolean } }).workUndoProbe = {
      keys: [],
      armed: true,
    };
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (
        url.pathname.includes('/work-receipts/') &&
        url.pathname.endsWith('/undo') &&
        init?.method === 'POST'
      ) {
        const probe = (window as unknown as { workUndoProbe: { keys: string[]; armed: boolean } })
          .workUndoProbe;
        probe.keys.push(JSON.parse(String(init.body)).requestId);
        const response = await native(input, init);
        if (response.ok && probe.armed) {
          probe.armed = false;
          throw new TypeError('synthetic lost reply');
        }
        return response;
      }
      return native(input, init);
    };
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await page.reload(); // Install the native fetch probe even when navigation only changed the hash.
  const card = page
    .getByRole('complementary', { name: '本任务的实际保存回执' })
    .filter({ hasText: preference.label });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '撤销这次偏好保存', exact: true }).click();
  await expect(card.getByRole('button', { name: '重试本次偏好撤销', exact: true })).toBeVisible();
  const accepted = await request.get(path);
  assert.equal(accepted.status(), 200);
  assert.equal(
    (await accepted.json()).preferences.find((r: { id: string }) => r.id === preference.id).currentStatus,
    'WITHDRAWN',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(card.getByRole('button', { name: '重试本次偏好撤销', exact: true })).toBeVisible();
  await card.getByRole('button', { name: '重试本次偏好撤销', exact: true }).click();
  await expect(card.getByText(/已撤销此偏好/)).toBeVisible();
  const probe = await page.evaluate(
    () => (window as unknown as { workUndoProbe: { keys: string[] } }).workUndoProbe,
  );
  assert.equal(probe.keys.length, 2);
  assert.equal(probe.keys[0], probe.keys[1]);
  const after = await request.get(path);
  assert.equal(
    (await after.json()).preferences.find((r: { id: string }) => r.id === preference.id).currentRevision,
    preference.acceptedRevision + 1,
  );
  await page.screenshot({ path: `${artifacts}/task-work-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  );
  await page.screenshot({ path: `${artifacts}/task-work-mobile.png`, fullPage: true });
  assert.deepEqual(browserErrors, []);
}
