/** Real workspace source lifecycle; caller owns disposable database, identities and runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function sourceJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const base = `/api/v1/tenants/${tenant}/workspaces/${workspace}`;
  async function csrf() {
    const value = await (await request.get('/api/v1/auth/csrf')).json();
    return { [value.headerName]: value.token };
  }
  async function upload(material?: string) {
    const response = await request.post(base + '/materials' + (material ? `/${material}/versions` : ''), {
      headers: await csrf(),
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(
            JSON.stringify({
              requestId: randomUUID(),
              ...(material ? { expectedVersion: 1 } : { folderId: null }),
            }),
          ),
        },
        file: {
          name: '人工来源月份报表.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from(material ? '后半月合成报表' : '前半月合成报表'),
        },
      },
    });
    assert.equal(response.status(), 201);
    return await response.json();
  }
  const first = await upload(),
    second = await upload(first.id);
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=${workspace}`);
  await page.getByRole('button', { name: '资料操作', exact: true }).click();
  await page.getByRole('button', { name: '数据来源', exact: true }).click();
  await page.getByRole('button', { name: '登记人工来源', exact: true }).click();
  await page.getByLabel('来源名称', { exact: true }).fill('每月人工业务报表');
  await page.getByLabel('来源说明', { exact: true }).fill('由本人从既有系统导出，人工核对后补交。');
  await page.getByLabel('补交周期（小时）', { exact: true }).fill('168');
  await page.getByLabel('预计覆盖起日', { exact: true }).fill('2026-01-01');
  await page.getByLabel('预计覆盖止日', { exact: true }).fill('2026-01-31');
  const keys: string[] = [];
  let lost = false;
  let interceptedStatus: number | undefined;
  let interceptionFailed = false;
  await page.route('**/sources', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    keys.push(route.request().postDataJSON().requestId);
    if (!lost) {
      lost = true;
      try {
        const result = await route.fetch();
        interceptedStatus = result.status();
        await route.abort();
      } catch {
        interceptionFailed = true;
        await route.abort().catch(() => {});
      }
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次来源保存', exact: true })).toBeVisible();
  assert.equal(interceptionFailed, false);
  assert.equal(interceptedStatus, 201);
  await page.getByRole('button', { name: '重试本次来源保存', exact: true }).click();
  await expect(page.locator('.source-facts')).toContainText('尚缺资料');
  assert.deepEqual(keys, [keys[0], keys[0]]);
  await page.unrouteAll();
  const index = await (await request.get(base + '/sources')).json();
  const sources = index.items.filter((s: { name: string }) => s.name === '每月人工业务报表');
  assert.equal(sources.length, 1);
  const source = sources[0];
  const submit = async (from: string, through: string, version: number) => {
    await page.getByRole('button', { name: '登记补交', exact: true }).click();
    await page.getByLabel('本次覆盖起日', { exact: true }).fill(from);
    await page.getByLabel('本次覆盖止日', { exact: true }).fill(through);
    await page
      .locator('.source-picker-list > li')
      .filter({ hasText: '人工来源月份报表.txt' })
      .getByRole('button')
      .click();
    await page
      .locator('.source-version-choice')
      .filter({ hasText: `· v${version}` })
      .getByRole('checkbox')
      .check();
    await page.getByRole('button', { name: '确认补交声明', exact: true }).click();
    await expect(page.getByRole('heading', { name: '补交历史', exact: true })).toBeVisible();
  };
  await submit('2026-01-01', '2026-01-15', 1);
  await expect(page.locator('.source-facts')).toContainText('覆盖仍有缺口');
  let history = await (await request.get(base + `/sources/${source.id}/submissions`)).json();
  assert.equal(history.items[0].versions[0].versionId, first.acceptedVersion.id);
  await submit('2026-01-16', '2026-01-31', 2);
  await expect(page.locator('.source-facts')).toContainText('已声明覆盖');
  await expect(page.locator('.source-intro')).toContainText('不代表资料已解析或内容质量已验证');
  history = await (await request.get(base + `/sources/${source.id}/submissions`)).json();
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].versions[0].versionId, second.acceptedVersion.id);
  await page.screenshot({ path: join(artifacts, 'sources-history-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'sources-history-mobile.png'), fullPage: true });
  assert.ok(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth));
  await page
    .locator('.source-history-item')
    .filter({ hasText: '2026-01-01 至 2026-01-15' })
    .getByRole('button', { name: '撤回此声明', exact: true })
    .click();
  await page.getByRole('button', { name: '确认撤回声明', exact: true }).click();
  await expect(page.locator('.source-facts')).toContainText('覆盖仍有缺口');
  await expect(
    page.locator('.source-history-item').filter({ hasText: '2026-01-01 至 2026-01-15' }),
  ).toContainText('已撤回');
  const download = await request.get(
    base + `/materials/${first.id}/versions/${first.acceptedVersion.id}/download`,
  );
  assert.equal(download.status(), 200);
  assert.equal(await download.text(), '前半月合成报表');
  await page.getByRole('button', { name: '编辑来源', exact: true }).click();
  await page.getByLabel('来源状态', { exact: true }).selectOption('PAUSED');
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(page.getByRole('button', { name: '登记补交', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '编辑来源', exact: true }).click();
  await page.getByLabel('来源状态', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: '保存来源', exact: true }).click();
  await expect(page.getByRole('button', { name: '登记补交', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '查看配置历史', exact: true }).click();
  await expect(page.locator('.source-config-history .source-history-item')).toHaveCount(3);
  const config = await (await request.get(base + `/sources/${source.id}/versions`)).json();
  assert.deepEqual(
    config.items.map((item: { settings: { status: string } }) => item.settings.status),
    ['ACTIVE', 'PAUSED', 'ACTIVE'],
  );
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { sourceId: source.id, firstVersionId: first.acceptedVersion.id };
}
