/** Real PostgreSQL + local parser + independently running local engine. No model calls. */
import assert from 'node:assert/strict';
import { blockDraftWrites, restoreDraftWrites } from './draft-storage-fixture.ts';
import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext } from '@playwright/test';
import { join } from 'node:path';
export async function conversationJourney({
  tenant,
  space,
  memberContext,
  adminContext,
  platformContext,
  artifacts,
}: {
  tenant: string;
  space: string;
  memberContext: BrowserContext;
  adminContext: BrowserContext;
  platformContext: BrowserContext;
  artifacts: string;
}) {
  const page = await memberContext.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tenantRoot = `/api/v1/tenants/${tenant}`,
    root = tenantRoot + '/conversations';
  const context = await (await memberContext.request.get(tenantRoot + '/context')).json();
  const personal = context.workspaces.find((s: { kind: string }) => s.kind === 'PERSONAL').id;
  const csrf = async () => {
    const c = await (await memberContext.request.get('/api/v1/auth/csrf')).json();
    return { [c.headerName]: c.token };
  };
  const upload = await memberContext.request.post(`${tenantRoot}/workspaces/${personal}/materials`, {
    headers: await csrf(),
    multipart: {
      metadata: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ requestId: randomUUID() })),
      },
      file: {
        name: '会话验收.md',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          '梦核进度：私人会话和可恢复任务\n<script>window.__conversationInjected=true</script>',
        ),
      },
    },
  });
  assert.equal(upload.status(), 201);
  const file = await upload.json();
  const detail = await (
    await memberContext.request.get(`${tenantRoot}/workspaces/${personal}/materials/${file.id}`)
  ).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await memberContext.request.get(
              `${tenantRoot}/workspaces/${personal}/materials/${file.id}/versions/${detail.versions[0].id}/analysis`,
            )
          ).json()
        ).status,
      { timeout: 30000 },
    )
    .toBe('READY');
  const href = `/workspace/#tenant=${tenant}&view=conversations`;
  await page.goto(href);
  await expect(page.getByRole('heading', { name: '开始新会话', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '新会话启动建议' })).toBeVisible();
  await expect(page.locator('.live-composer-surface')).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'conversation-start-desktop.png'), fullPage: true });
  const keywords = page.getByLabel('资料关键词', { exact: true });
  await keywords.fill('先前已存草稿');
  await blockDraftWrites(page, 'dreamcore:composer:');
  await keywords.fill('无法写入的最新草稿');
  await expect(page.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' })).toBeVisible();
  await expect(page.locator('.conversation-send')).not.toContainText('草稿在本标签页恢复');
  await expect(keywords).toHaveValue('无法写入的最新草稿');
  assert.equal(
    await page.evaluate(
      () => Object.keys(sessionStorage).filter((k) => k.startsWith('dreamcore:composer:')).length,
    ),
    0,
  );
  await restoreDraftWrites(page);
  await page.getByLabel('资料关键词', { exact: true }).fill('梦核进度');
  await expect(page.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('资料关键词', { exact: true })).toHaveValue('梦核进度');
  // Browser offline: no request reaches the server, reconnecting must not submit automatically.
  await memberContext.setOffline(true);
  await page.getByRole('button', { name: '查找资料', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次发送', exact: true })).toBeEnabled();
  await memberContext.setOffline(false);
  assert.equal((await (await memberContext.request.get(root)).json()).items.length, 0);
  // Server accepts the request, but its reply is lost. Reload + explicit retry must use the same key.
  await page.route('**/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 202);
    await route.abort();
  });
  await page.getByRole('button', { name: '重试上次发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次发送', exact: true })).toBeEnabled();
  const firstList = await (await memberContext.request.get(root)).json();
  assert.equal(firstList.items.length, 1);
  const id = firstList.items[0].id;
  await page.unrouteAll();
  await page.reload();
  await expect(page.getByRole('button', { name: '重试上次发送', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试上次发送', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`conversation=${id}`));
  await expect(page.locator('.conversation-result')).toContainText('执行完成', { timeout: 15000 });
  await expect(page.locator('.conversation-sources').first()).toContainText('会话验收.md · v1');
  assert.equal((await (await memberContext.request.get(`${root}/${id}`)).json()).tasks.length, 1);
  assert.equal((await (await memberContext.request.get(root)).json()).items.length, 1);
  assert.equal((await adminContext.request.get(`${root}/${id}`)).status(), 404);
  assert.equal((await adminContext.request.get(`${root}/${id}/events`)).status(), 404);
  assert.equal((await platformContext.request.get(`${root}/${id}`)).status(), 403);
  await page.locator('.conversation-sources button').first().click();
  const source = page.getByRole('region', { name: '资料来源', exact: true });
  await expect(source).toContainText('梦核进度');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Fullscreen changes presentation without remounting the fixed-version citation reader.
  await source
    .locator('.live-source-reader')
    .evaluate((element) => element.setAttribute('data-retained-reader', 'yes'));
  await page.getByRole('button', { name: '全屏查看资料来源', exact: true }).click();
  const fullscreenSource = page.getByRole('dialog', { name: '资料来源', exact: true });
  await expect(fullscreenSource).toHaveAttribute('aria-modal', 'true');
  await expect(fullscreenSource).toHaveClass(/is-fullscreen/);
  await expect(fullscreenSource.getByRole('button', { name: '退出来源全屏', exact: true })).toBeFocused();
  // Tab and Shift+Tab wrap inside the reader instead of reaching shell navigation or tenant selection.
  for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    assert.equal(
      await fullscreenSource.evaluate((element) => element.contains(document.activeElement)),
      true,
    );
  }
  await page.locator('.access-tenant-picker select').evaluate((element) => (element as HTMLElement).focus());
  assert.equal(await fullscreenSource.evaluate((element) => element.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await expect(source).not.toHaveClass(/is-fullscreen/);
  await expect(page.getByRole('button', { name: '全屏查看资料来源', exact: true })).toBeFocused();
  await expect(page.locator('.access-sidebar')).not.toHaveAttribute('inert');
  await expect(source.locator('.live-source-reader')).toHaveAttribute('data-retained-reader', 'yes');
  await page.screenshot({ path: join(artifacts, 'conversation-source-desktop.png'), fullPage: true });
  const desktop = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByLabel('会话卡片切换', { exact: true });
  await expect(source).toBeVisible();
  await tabs.getByRole('button', { name: '对话', exact: true }).click();
  await expect(page.getByLabel('资料关键词', { exact: true })).toBeVisible();
  await expect(source).toBeHidden();
  await tabs.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '会话列表' })).toBeVisible();
  await tabs.getByRole('button', { name: '资料来源', exact: true }).click();
  await expect(source).toContainText('梦核进度');
  await expect(source.locator('.live-source-reader')).toHaveAttribute('data-retained-reader', 'yes');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'conversation-source-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '全屏查看资料来源', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '资料来源', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭资料来源', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '资料来源', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('资料关键词', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-sources button').first()).toBeFocused();
  await page.setViewportSize(desktop);
  await page.getByRole('button', { name: '收起会话列表', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '会话列表' })).toBeHidden();
  await page.getByRole('button', { name: '展开会话列表', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '会话列表' })).toBeVisible();
  await page.getByLabel('资料关键词', { exact: true }).fill('不存在的验收关键词');
  await page.getByRole('button', { name: '查找资料', exact: true }).click();
  await expect(page.locator('.conversation-turn')).toHaveCount(2);
  await expect(page.locator('.conversation-result').last()).toContainText('没有找到匹配', { timeout: 15000 });
  await page.getByLabel('资料关键词', { exact: true }).fill('保留未发送草稿');
  await page.reload();
  await expect(page.getByLabel('资料关键词', { exact: true })).toHaveValue('保留未发送草稿');
  await expect(page.locator('.conversation-turn')).toHaveCount(2);
  // A failing event permission check also removes the already-open source reader.
  await page.locator('.conversation-sources button').first().click();
  await expect(page.getByRole('region', { name: '资料来源', exact: true })).toContainText('梦核进度');
  await page.route('**/conversations/*/events?*', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ contractVersion: '1.0', code: 'CONVERSATION_NOT_FOUND' }),
    }),
  );
  await expect(page.locator('.conversation-turn')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole('region', { name: '资料来源', exact: true })).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.conversation-turn')).toHaveCount(2);
  assert.equal(
    await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).__conversationInjected)),
    false,
  );
  await page.getByRole('button', { name: '返回检索', exact: true }).click();
  await expect(page.locator('.conversation-sources button').first()).toBeFocused();
  await page.screenshot({ path: join(artifacts, 'conversations-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'conversations-mobile.png'), fullPage: true });
  // Read-only shared membership is enough to start a task; administrator still cannot read it.
  const shared = await memberContext.request.post(root, {
    headers: await csrf(),
    data: { requestId: randomUUID(), workspaceId: space, prompt: '共享范围验收', mode: 'SOURCE_LOOKUP' },
  });
  assert.equal(shared.status(), 202);
  const sharedId = (await shared.json()).conversation.id;
  assert.equal((await adminContext.request.get(`${root}/${sharedId}`)).status(), 404);
  const blockedPage = await memberContext.newPage();
  await blockedPage.goto(href);
  await blockDraftWrites(blockedPage, 'dreamcore:composer:');
  await blockedPage.getByLabel('资料关键词', { exact: true }).fill('无本地存储的请求');
  let blockedRequestId = '';
  await blockedPage.route('**/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    blockedRequestId = route.request().postDataJSON().requestId;
    assert.equal((await route.fetch()).status(), 202);
    await route.abort();
  });
  await blockedPage.getByRole('button', { name: '查找资料', exact: true }).click();
  await expect(blockedPage.getByRole('button', { name: '重试上次发送', exact: true })).toBeEnabled();
  await expect(
    blockedPage.getByRole('alert').filter({ hasText: '当前草稿尚未保存在浏览器中' }),
  ).toContainText('本页可重试同一次请求');
  const acceptedCount = (await (await memberContext.request.get(root)).json()).items.length;
  await blockedPage.unrouteAll();
  const retried = blockedPage.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/conversations'),
  );
  await blockedPage.getByRole('button', { name: '重试上次发送', exact: true }).click();
  assert.equal((await retried).postDataJSON().requestId, blockedRequestId);
  await expect(blockedPage).toHaveURL(/conversation=/);
  assert.equal((await (await memberContext.request.get(root)).json()).items.length, acceptedCount);
  await blockedPage.close();
  return async () => {
    await page.reload();
    await expect(page.locator('.conversation-turn')).toHaveCount(2);
    await expect(page.locator('.conversation-sources').first()).toContainText('会话验收.md · v1');
    await expect(page.getByLabel('资料关键词', { exact: true })).toHaveValue('保留未发送草稿');
    const persisted = await (await memberContext.request.get(`${root}/${id}`)).json();
    assert.deepEqual(
      persisted.tasks.map((t: { status: string }) => t.status),
      ['SUCCEEDED', 'SUCCEEDED'],
    );
    assert.deepEqual(errors, []);
    await page.close();
  };
}
