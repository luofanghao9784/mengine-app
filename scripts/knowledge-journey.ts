/** Real local parser, UI and persistent citations using synthetic files only. */
import assert from 'node:assert/strict';
import { expect, type BrowserContext } from '@playwright/test';
import { join } from 'node:path';
export async function knowledgeJourney({
  tenant,
  space,
  memberContext,
  adminContext,
  artifacts,
}: {
  tenant: string;
  space: string;
  memberContext: BrowserContext;
  adminContext: BrowserContext;
  artifacts: string;
}) {
  const page = await memberContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  const context = await (await memberContext.request.get(`/api/v1/tenants/${tenant}/context`)).json();
  const personal = context.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id;
  const base = `/api/v1/tenants/${tenant}/workspaces/${personal}`;
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal`);
  await page.getByRole('button', { name: '上传资料', exact: true }).click();
  await page
    .getByLabel(/^选择文件/)
    .setInputFiles({
      name: '梦核解析验收.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        '项目,金额\n梦核验收,00123.4500\n防注入,<script>window.__parserInjected=true</script>\n',
      ),
    });
  await page.getByRole('button', { name: '保存原文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const list = await (await memberContext.request.get(base + '/library')).json();
  const doc = list.items.find((x: { name: string }) => x.name === '梦核解析验收.csv');
  const detail = await (await memberContext.request.get(base + `/materials/${doc.id}`)).json();
  const version = detail.versions[0].id;
  const analysisPath = base + `/materials/${doc.id}/versions/${version}/analysis`;
  await expect
    .poll(async () => (await (await memberContext.request.get(analysisPath)).json()).status, {
      timeout: 30000,
    })
    .toBe('READY');
  await page.locator('.material-entry').filter({ hasText: '梦核解析验收.csv' }).click();
  await page.getByRole('button', { name: '查看 v1 解析', exact: true }).click();
  await expect(page.getByLabel('版本解析内容')).toContainText('00123.4500');
  await expect(page.getByLabel('版本解析内容')).toContainText(
    '<script>window.__parserInjected=true</script>',
  );
  assert.equal(
    await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).__parserInjected)),
    false,
  );
  await page.screenshot({ path: join(artifacts, 'analysis-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '重新解析', exact: true }).click();
  await expect
    .poll(async () => (await (await memberContext.request.get(analysisPath)).json()).generation)
    .toBe(2);
  await expect
    .poll(async () => (await (await memberContext.request.get(analysisPath)).json()).status, {
      timeout: 30000,
    })
    .toBe('READY');
  await expect(page.getByLabel('版本解析内容')).toContainText('00123.4500');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '搜索内容', exact: true }).click();
  await page.getByLabel('内容关键词').fill('00123.4500');
  await page.getByRole('button', { name: '检索', exact: true }).click();
  await expect(page.locator('.knowledge-result')).toHaveCount(1);
  await page.locator('.knowledge-result').click();
  await expect(page.locator('.knowledge-fragment')).toContainText('00123.4500');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'citation-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const analysis = await (await memberContext.request.get(analysisPath)).json();
  const citation = analysis.chunks[1].id;
  const citationPath = `/api/v1/tenants/${tenant}/knowledge/chunks/${citation}`;
  assert.equal((await adminContext.request.get(citationPath)).status(), 404);
  assert.equal(
    (
      await (
        await memberContext.request.get(`/api/v1/tenants/${tenant}/knowledge/search?q=00123.4500`)
      ).json()
    ).items.length,
    0,
  );
  // A blocked/failed source read clears previously displayed derived text.
  await page.route('**/knowledge/chunks/*', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ contractVersion: '1.0', code: 'KNOWLEDGE_NOT_FOUND' }),
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.knowledge-fragment')).toHaveCount(0);
  await page.unrouteAll();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '上传资料', exact: true }).click();
  await page
    .getByLabel(/^选择文件/)
    .setInputFiles({
      name: '暂不支持.pptx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic unsupported'),
    });
  await page.getByRole('button', { name: '保存原文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.material-entry').filter({ hasText: '暂不支持.pptx' }).click();
  await page.getByRole('button', { name: '查看 v1 解析', exact: true }).click();
  await expect(page.getByLabel('版本解析内容')).toContainText('暂不支持此格式', { timeout: 30000 });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  // Shared source may have been cancelled by the earlier permission journey; explicit maintenance permits retry.
  const sharedBase = `/api/v1/tenants/${tenant}/workspaces/${space}`;
  const shared = await (await memberContext.request.get(sharedBase + '/library')).json();
  const sharedDoc = shared.items.find((x: { kind: string }) => x.kind === 'DOCUMENT');
  if (sharedDoc) {
    const v = (await (await memberContext.request.get(sharedBase + `/materials/${sharedDoc.id}`)).json())
      .versions[0].id;
    const path = sharedBase + `/materials/${sharedDoc.id}/versions/${v}/analysis`;
    const state = await (await memberContext.request.get(path)).json();
    if (state.status === 'CANCELLED') {
      const csrf = await (await memberContext.request.get('/api/v1/auth/csrf')).json();
      await memberContext.request.post(path, {
        data: { requestId: crypto.randomUUID(), expectedGeneration: state.generation },
        headers: { [csrf.headerName]: csrf.token },
      });
    }
  }
  assert.deepEqual(errors, []);
  return async () => {
    const result = await memberContext.request.get(citationPath);
    assert.equal(result.status(), 200);
    assert.ok((await result.json()).content.includes('00123.4500'));
    await page.close();
  };
}
