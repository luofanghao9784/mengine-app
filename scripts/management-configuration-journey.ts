/** Read-only smoke against actual enterprise management routes. Caller provides two entry URLs
 * with the new components mounted, an authenticated synthetic member and a current shared scope.
 * It neither configures a model nor creates a continuous plan. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { runtimePresentation, effectiveMethodPresentation } from '../src/governance/work-configuration.ts';
export async function managementConfigurationJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
  sourceUrl: string,
  configurationUrl: string,
) {
  for (const url of [sourceUrl, configurationUrl])
    assert.match(url, /^\/tenant-admin\//, 'Real tenant admin route required');
  const context = await request.get(`/api/v1/tenants/${tenant}/context`);
  assert.equal(context.status(), 200);
  const shared = (await context.json()).workspaces.filter((s: { kind: string }) => s.kind === 'SHARED');
  assert.ok(shared.some((s: { id: string }) => s.id === workspace));
  const mutations: string[] = [];
  const onRequest = (r: import('@playwright/test').Request) => {
    if (r.method() === 'POST' && !r.url().includes('/auth/')) mutations.push(r.url());
  };
  page.on('request', onRequest);
  try {
    await page.goto(sourceUrl);
    await page.getByLabel('来源所属空间', { exact: true }).selectOption(workspace);
    const selected = await page
      .getByLabel('来源所属空间', { exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    assert.deepEqual(selected.sort(), shared.map((s: { id: string }) => s.id).sort());
    await page.getByRole('button', { name: '管理该空间的数据来源', exact: true }).click();
    await expect(page.getByRole('region', { name: '人工持续来源管理' })).toBeVisible();
    const list = await request.get(
      `/api/v1/tenants/${tenant}/workspaces/${workspace}/sources?offset=0&limit=20`,
    );
    assert.equal(list.status(), 200);
    for (const source of (await list.json()).items)
      await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'management-business-sources.png'), fullPage: true });
    await page.goto(configurationUrl);
    await expect(page.getByRole('region', { name: '当前 AI 工作配置' })).toBeVisible();
    const runtime = await request.get('/api/v1/system/info');
    if (runtime.ok()) {
      const actual = runtimePresentation(await runtime.json());
      await expect(page.getByText(actual.title, { exact: true })).toBeVisible();
    } else
      await expect(page.getByText('当前能力未知，未自动使用演示状态代替。', { exact: true })).toBeVisible();
    await page.getByLabel('查看方法生效范围', { exact: true }).selectOption(workspace);
    const method = await request.get(`/api/v1/tenants/${tenant}/methods/selection?workspace=${workspace}`);
    assert.equal(method.status(), 200);
    const actual = effectiveMethodPresentation(await method.json());
    await expect(page.getByText(actual.source, { exact: true }).first()).toBeVisible();
    await page.getByText('有效配置的版本依据', { exact: true }).click();
    await expect(page.getByText(actual.configurationSha, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '我的档案与偏好', exact: true })).toHaveAttribute(
      'href',
      `/workspace/#tenant=${tenant}&view=profiles`,
    );
    await expect(page.getByText('查看我的持续计划', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(artifacts, 'management-work-configuration.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(artifacts, 'management-work-configuration-mobile.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    assert.deepEqual(mutations, []);
    return {
      actualSourceScopes: shared.length,
      effectiveMethodSource: actual.source,
      noBusinessWrites: true,
    };
  } finally {
    page.off('request', onRequest);
  }
}
