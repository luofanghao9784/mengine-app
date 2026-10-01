/** Real experience UI + service. Caller owns isolated DB, authenticated personal workspace and runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function experienceJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}/experiences`,
    title = '离线经验闭环 ' + randomUUID().slice(0, 8);
  async function post(path: string, body: unknown) {
    const token = await (await request.get('/api/v1/auth/csrf')).json();
    return request.post(root + path, { headers: { [token.headerName]: token.token }, data: body });
  }
  await page.goto(`/workspace/#tenant=${tenant}&view=experiences&scope=${workspace}`);
  await expect(
    page.locator('.experience-library').getByRole('heading', { name: '经验库', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '整理经验', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill(title);
  await page.getByLabel('摘要', { exact: true }).fill('用于验证授权、候选发布和确切使用记录的人工方法。');
  await page.getByLabel('可复用方法与检查步骤').fill('1. 核对本次资料日期。\n2. 区分事实、缺口与假设。');
  await page.getByLabel('适用条件', { exact: true }).fill('有获准的计划和实际记录。');
  await page.getByLabel('不适用与反例').fill('不得从历史案例推断当前项目延期。');
  await page
    .getByLabel('依据、实际核对范围与未知事项')
    .fill('合成验收中的人工方法参考；尚未评测，无真实成功证据。');
  const probe: { keys: string[]; status: number | null; receipt: any; error?: unknown } = {
    keys: [],
    status: null,
    receipt: null,
  };
  const routePattern = '**' + root;
  await page.route(routePattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      probe.keys.push(route.request().postDataJSON().requestId);
      const response = await route.fetch();
      if (probe.keys.length === 1) {
        probe.status = response.status();
        probe.receipt = await response.json();
        await route.abort('failed');
      } else await route.fulfill({ response });
    } catch (error) {
      probe.error = error;
      await route.abort('failed').catch(() => {});
    }
  });
  let entry: any;
  try {
    await page.getByRole('button', { name: '保存候选', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('同一次请求');
    assert.equal(probe.error, undefined);
    assert.equal(probe.status, 201, JSON.stringify(probe.receipt));
    await expect(page.getByRole('button', { name: '整理经验', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '重试同次保存', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    assert.equal(probe.keys.length, 2);
    assert.equal(probe.keys[0], probe.keys[1]);
    entry = probe.receipt;
  } finally {
    await page.unroute(routePattern);
  }
  const before = await (await request.get(root + '?query=' + encodeURIComponent(title))).json();
  assert.equal(before.items.length, 0);
  await page.getByRole('checkbox', { name: /我确认此处手工填写的经验正文/ }).check();
  await page.getByRole('button', { name: '发布此版本 v1', exact: true }).click();
  await expect(page.locator('.experience-detail-meta')).toContainText('此版本当前生效');
  const available = await (await request.get(root + '?query=' + encodeURIComponent(title))).json();
  assert.equal(available.items.length, 1);
  assert.equal(available.items[0].versionId, entry.version.id);
  await page.getByRole('button', { name: '判断适用并记录', exact: true }).click();
  await page.getByLabel('本次工作或案例标识').fill('journey-case-1');
  await page.getByLabel('适用判断', { exact: true }).selectOption('NOT_APPLICABLE');
  await page.getByLabel('本次条件及判断依据').fill('当前缺实际进度，不应直接套用历史方法。');
  await page.getByRole('button', { name: '保存我的使用判断', exact: true }).click();
  await expect(page.locator('.experience-use-card')).toContainText('未采用');
  await page.getByRole('button', { name: '查看 / 补充后续结果', exact: true }).click();
  await page.getByLabel('后续结果', { exact: true }).selectOption('CORRECTED');
  await page
    .getByLabel('结果依据、人工贡献与待观察事项')
    .fill('补充资料后人工纠正；此反馈没有改写方法正文。');
  await page.getByRole('button', { name: '补充后续记录', exact: true }).click();
  await expect(page.locator('.experience-feedback-list')).toContainText('经人工纠正');
  const uses = await (await request.get(root + `/${entry.id}/uses`)).json();
  assert.equal(uses.items.length, 1);
  assert.equal(uses.items[0].versionId, entry.version.id);
  assert.equal(uses.items[0].adopted, false);
  await page.getByRole('button', { name: '整理新版本', exact: true }).click();
  await page.getByLabel('可复用方法与检查步骤').fill('1. 先核对最新日期。\n2. 保留资料缺口与人工修正。');
  await page.getByRole('button', { name: '保存候选', exact: true }).click();
  await expect(page.locator('.experience-detail')).toContainText('当前查看 v2');
  const updated = await (await request.get(root + `/${entry.id}`)).json();
  assert.equal(updated.version.number, 2);
  assert.equal(updated.publishedVersion, entry.version.id);
  const other = await post(`/${entry.id}/publish`, {
    requestId: randomUUID(),
    expectedRevision: updated.revision,
    versionId: updated.version.id,
    independentCopyConfirmed: true,
  });
  assert.equal(other.status(), 200, await other.text());
  await page.getByRole('checkbox', { name: /我确认此处手工填写的经验正文/ }).check();
  await page.getByRole('button', { name: '发布此版本 v2', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('其他维护者已更新');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('.experience-detail-meta')).toContainText('此版本当前生效');
  await page.getByRole('button', { name: '版本与发布记录', exact: true }).click();
  await expect(page.locator('.experience-history')).toContainText('查看 v1');
  await expect(page.locator('.experience-history')).toContainText('查看 v2');
  await page.screenshot({ path: join(artifacts, 'experience-history-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'experience-history-mobile.png'), fullPage: true });
  assert.ok(await page.locator('.experience-library').evaluate((e) => e.scrollWidth <= e.clientWidth));
  await page.getByRole('button', { name: '撤回当前生效版本', exact: true }).click();
  await expect(page.locator('.experience-detail-meta')).toContainText('当前生效版本：无');
  assert.equal(
    (await (await request.get(root + '?query=' + encodeURIComponent(title))).json()).items.length,
    0,
  );
  assert.equal((await (await request.get(root + `/${entry.id}/uses`)).json()).items.length, 1);
  const historical = await request.get(root + `/${entry.id}?version=${entry.version.id}`);
  assert.equal(historical.status(), 200);
  assert.equal(
    (await historical.json()).version.content.body,
    '1. 核对本次资料日期。\n2. 区分事实、缺口与假设。',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
}

export async function experienceSeedJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}/experiences`;
  await page.goto(`/workspace/#tenant=${tenant}&view=experiences&scope=${workspace}`);
  await expect(page.getByRole('heading', { name: '可选的起步方法', exact: true })).toBeVisible();
  const before = await (await request.get(root + '?maintenance=true')).json();
  await page.getByRole('button', { name: '汇报前的资料核对', exact: true }).click();
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('汇报前的资料核对');
  await expect(page.getByLabel('依据、实际核对范围与未知事项', { exact: true })).toContainText(
    'reporting-source-check',
  );
  await expect(page.getByLabel('可复用方法与检查步骤', { exact: true })).toContainText('区分已证实事实');
  const saved = page.waitForResponse((r) => r.url().endsWith(root) && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存候选', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 201);
  const entry = await response.json();
  assert.equal(entry.status, 'CANDIDATE');
  assert.equal(entry.version.content.kind, 'METHOD');
  assert.equal(entry.version.evaluation, 'NOT_EVALUATED');
  assert.deepEqual(entry.version.evidence, []);
  assert.ok(entry.version.content.basis.includes('v1.0'));
  assert.ok(entry.version.content.excluded.includes('不替代专业审计'));
  assert.equal(
    (await (await request.get(root + '?maintenance=true')).json()).items.length,
    before.items.length + 1,
  );
  assert.ok(!(await (await request.get(root)).json()).items.some((v: any) => v.id === entry.id));
  await page.reload();
  await page.goto(`/workspace/#tenant=${tenant}&view=experiences&scope=${workspace}&experience=${entry.id}`);
  await expect(
    page.locator('.experience-detail').getByRole('heading', { name: '汇报前的资料核对', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'experience-seed-candidate.png'), fullPage: true });
  return {
    entryId: entry.id,
    state: entry.status,
    evaluation: entry.version.evaluation,
    seed: 'reporting-source-check-v1.0',
  };
}
