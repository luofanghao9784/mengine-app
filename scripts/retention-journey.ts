/** Requires an isolated synthetic tenant with explicit TENANT_EXIT, an authorized shared scope,
 * authenticated real page/API contexts and RetentionPanel mounted on its actual management route.
 * This only creates/cancels preparation records. It never suspends tenants or deletes content. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { RetentionCase } from '../contracts/public-api/retention.ts';
export async function retentionJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
  entryUrl: string,
) {
  assert.match(
    entryUrl,
    /^\/(tenant-admin|workspace)(\/|\?)/,
    'Use the actual management route, not a fixture or Demo',
  );
  const root = `/api/v1/tenants/${tenant}/retention`,
    options = await request.get(root + '/options?kind=TENANT_EXIT&limit=50');
  assert.equal(options.status(), 200);
  const chosen = (await options.json()).spaces.find((s: { id: string }) => s.id === workspace);
  assert.ok(chosen, 'Fixture must include a currently authorized shared workspace');
  const capture: {
    armed: boolean;
    suffix: string;
    keys: string[];
    status: number | null;
    receipt: RetentionCase | null;
  } = {
    armed: false,
    suffix: '/retention/cases',
    keys: [],
    status: null,
    receipt: null,
  };
  const pattern = '**' + root + '/cases**';
  await page.route(pattern, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || !new URL(req.url()).pathname.endsWith(capture.suffix))
      return route.continue();
    capture.keys.push(req.postDataJSON().requestId);
    const response = await route.fetch();
    if (capture.armed) {
      capture.armed = false;
      capture.status = response.status();
      capture.receipt = await response.json();
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  const arm = async (suffix: string) => {
      Object.assign(capture, { armed: true, suffix, keys: [], status: null, receipt: null });
    },
    probe = async () => ({ keys: capture.keys, status: capture.status, receipt: capture.receipt });
  const csrf = async () => {
    const r = await request.get('/api/v1/auth/csrf');
    assert.equal(r.status(), 200);
    const c = await r.json();
    return { [c.headerName]: c.token };
  };
  let caseId: string | undefined;
  try {
    await page.goto(entryUrl);
    const panel = page.locator(`.retention-panel[data-retention-tenant="${tenant}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('region', { name: '任务通知清理状态' })).toContainText('已清理通知');
    const operational = await request.get(`/api/v1/tenants/${tenant}/retention/operation-cleanup`);
    assert.equal(operational.status(), 200);
    assert.equal(typeof (await operational.json()).removedEvents, 'number');
    await panel.getByRole('button', { name: '离职与企业退出准备', exact: true }).click();
    await panel.getByRole('button', { name: '新建准备记录', exact: true }).click();
    await panel.getByLabel('准备类型', { exact: true }).selectOption('TENANT_EXIT');
    await panel.getByLabel('记录名称', { exact: true }).fill('合成退出准备旅程 ' + Date.now());
    await panel.getByRole('checkbox', { name: chosen.name, exact: true }).check();
    await arm('/retention/cases');
    await panel.getByRole('button', { name: '保存准备记录', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(page.getByRole('button', { name: '企业配置', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '收起新建', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('记录名称', { exact: true })).toBeDisabled();
    let p = await probe();
    assert.equal(p.status, 201);
    assert.equal(p.receipt?.executionState, 'PREPARATION_ONLY');
    caseId = p.receipt!.summary.id;
    await panel.getByRole('button', { name: '核对并重试原请求', exact: true }).click();
    await expect(panel.getByRole('region', { name: '准备记录详情', exact: true })).toBeVisible();
    p = await probe();
    assert.equal(p.keys.length, 2);
    assert.equal(p.keys[0], p.keys[1]);
    let current = await request.get(root + '/cases/' + caseId);
    assert.equal(current.status(), 200);
    assert.equal((await current.json()).summary.revision, 1);
    await panel.getByLabel('已核对共享责任移交；不转移私人空间', { exact: true }).selectOption('CONFIRMED');
    await panel.getByRole('button', { name: '保存人工核对', exact: true }).click();
    await expect(panel.getByRole('region', { name: '准备记录详情' })).toContainText(
      '查看版本 2 / 最新版本 2',
    );
    await arm('/retention/cases/' + caseId);
    await panel.getByRole('button', { name: '评估当前范围', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(panel.getByRole('button', { name: '新建准备记录', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '核对并重试原请求', exact: true }).click();
    await expect(panel.getByRole('region', { name: '退出范围评估' })).toContainText('尚不支持完整迁出');
    p = await probe();
    assert.equal(p.status, 200);
    assert.equal(p.keys.length, 2);
    assert.equal(p.keys[0], p.keys[1]);
    assert.equal(p.receipt!.assessment!.completeMigration, false);
    assert.equal(p.receipt!.assessment!.executionEnabled, false);
    assert.equal(p.receipt!.summary.revision, 3);
    const conflict = await request.post(root + '/cases/' + caseId, {
      headers: await csrf(),
      data: { requestId: crypto.randomUUID(), expectedRevision: 1, action: 'CANCEL' },
    });
    assert.equal(conflict.status(), 409);
    assert.equal((await conflict.json()).contractVersion, '1.0');
    const historical = await request.get(root + '/cases/' + caseId + '?revision=1');
    assert.equal(historical.status(), 200);
    assert.equal((await historical.json()).assessment, null);
    await page.screenshot({ path: join(artifacts, 'retention-preparation-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'retention-preparation-mobile.png'), fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    await panel.getByRole('button', { name: '取消准备记录', exact: true }).click();
    await expect(panel.getByRole('region', { name: '准备记录详情' })).toContainText('已取消准备');
    current = await request.get(root + '/cases/' + caseId);
    assert.equal((await current.json()).summary.state, 'CANCELLED');
    await expect(page.getByRole('button', { name: '企业配置', exact: true })).toBeEnabled();
  } finally {
    await page.unroute(pattern);
    if (caseId) {
      const response = await request.get(root + '/cases/' + caseId);
      if (response.status() === 200) {
        const c = (await response.json()) as RetentionCase;
        if (c.summary.state !== 'CANCELLED') {
          const cancelled = await request.post(root + '/cases/' + caseId, {
            headers: await csrf(),
            data: { requestId: crypto.randomUUID(), expectedRevision: c.summary.revision, action: 'CANCEL' },
          });
          assert.equal(cancelled.status(), 200);
        }
      }
    }
  }
}
