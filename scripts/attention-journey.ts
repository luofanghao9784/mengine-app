/** Real data needs in the briefing; only source creation and explicit source maintenance change business state. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function attentionJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}`,
    sourceBase = `${root}/workspaces/${workspace}/sources`;
  const actor = (await (await request.get('/api/v1/me')).json()).account.id;
  const csrf = await (await request.get('/api/v1/auth/csrf')).json();
  const headers = { [csrf.headerName]: csrf.token };
  const created: any[] = [];
  for (let n = 0; n < 9; n++) {
    const result = await request.post(sourceBase, {
      headers,
      data: {
        requestId: randomUUID(),
        settings: {
          name: `折叠验收来源 ${n + 1}`,
          description: '本地合成待办',
          responsibleId: actor,
          cadenceHours: 24,
          expectedFrom: '2026-09-01',
          expectedThrough: '2026-09-30',
          status: 'ACTIVE',
        },
      },
    });
    assert.equal(result.status(), 201, await result.text());
    created.push(await result.json());
  }
  const before = await (await request.get(root + '/attention')).json();
  assert.ok(before.total >= 9);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
  const section = page.getByRole('region', { name: '我的待办' });
  await expect(section.locator('.attention-card')).toHaveCount(6);
  const rows = await section
    .locator('.attention-card')
    .evaluateAll((items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size);
  assert.equal(rows, 2);
  await page.screenshot({ path: join(artifacts, 'attention-two-rows-desktop.png'), fullPage: true });
  await section.getByRole('button', { name: '完全展开', exact: true }).click();
  await expect(section.locator('.attention-card')).toHaveCount(before.total);
  await section.getByRole('button', { name: '完全收起', exact: true }).click();
  await expect(section.locator('.attention-card')).toHaveCount(0);
  await expect(section.locator('.badge')).toContainText(String(before.total));
  assert.equal((await (await request.get(root + '/attention')).json()).total, before.total);
  await page.reload();
  await expect(section.locator('.attention-card')).toHaveCount(0);
  await section.getByRole('button', { name: '完全展开', exact: true }).click();
  await section.getByRole('button', { name: '两排概览', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(section.locator('.attention-card')).toHaveCount(2);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'attention-two-rows-mobile.png'), fullPage: true });
  await section.getByRole('button', { name: '完全展开', exact: true }).click();
  const target = section
    .locator('.attention-card')
    .filter({ has: page.getByRole('heading', { name: '折叠验收来源 1', exact: true }) });
  await target.getByRole('link', { name: '补交并核对覆盖' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: '折叠验收来源 1', exact: true }),
  ).toBeVisible();
  const original = created[0];
  const changed = await request.post(sourceBase + '/' + original.id, {
    headers,
    data: {
      requestId: randomUUID(),
      expectedRevision: original.revision,
      settings: {
        name: original.name,
        description: original.description,
        responsibleId: actor,
        cadenceHours: 24,
        expectedFrom: original.expectedFrom,
        expectedThrough: original.expectedThrough,
        status: 'PAUSED',
      },
    },
  });
  assert.equal(changed.status(), 200, await changed.text());
  await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
  await expect(section.locator('.attention-card')).toHaveCount(before.total - 1);
  await expect(section.getByRole('heading', { name: '折叠验收来源 1', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
}

export async function taskAttentionJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}`,
    csrf = await (await request.get('/api/v1/auth/csrf')).json();
  const response = await request.post(root + '/conversations', {
    headers: { [csrf.headerName]: csrf.token },
    data: {
      requestId: randomUUID(),
      workspaceId: workspace,
      mode: 'AGENT',
      prompt: 'ATTENTION_INPUT 合成截止日期核对',
    },
  });
  assert.equal(response.status(), 202);
  const created = await response.json(),
    task = created.tasks[0].id,
    conversation = created.conversation.id;
  await expect
    .poll(
      async () => {
        const r = await request.get(root + `/conversations/${conversation}/tasks/${task}`);
        assert.equal(r.status(), 200);
        return (await r.json()).tasks[0].status;
      },
      { timeout: 30000 },
    )
    .toBe('WAITING_INPUT');
  await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
  const section = page.getByRole('region', { name: '我的待办' }),
    card = section.locator('.attention-card').filter({ hasText: 'ATTENTION_INPUT 合成截止日期核对' });
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: '补充条件', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`conversation=${conversation}.*task=${task}`));
  await expect(page.locator('.conversation-result')).toContainText('等待补充信息');
  await page.getByLabel('补充本任务（可选）', { exact: true }).fill('补充到周五');
  const actionPattern = '**' + root + `/conversations/${conversation}/tasks/${task}`;
  const keys: string[] = [];
  let lost = true;
  await page.route(actionPattern, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().postDataJSON().requestId);
    const response = await route.fetch();
    if (lost) {
      lost = false;
      assert.equal(response.status(), 200);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '提交补充并继续', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次操作', exact: true })).toBeEnabled();
  await expect(page.getByLabel('补充本任务（可选）', { exact: true })).toBeDisabled();
  const focused = page.url();
  await page.evaluate(() => {
    location.hash = '#view=briefing';
  });
  await expect(page).toHaveURL(focused);
  await page.getByRole('button', { name: '重试本次操作', exact: true }).click();
  await expect.poll(() => keys.length).toBe(2);
  assert.equal(keys[0], keys[1]);
  await page.unroute(actionPattern);

  await expect(page.locator('.conversation-reply')).toContainText('已依据补充到周五完成合成核对', {
    timeout: 30000,
  });
  await page.screenshot({ path: join(artifacts, 'attention-task-resumed.png'), fullPage: true });
  const attempts = await (
    await request.get(root + `/conversations/${conversation}/tasks/${task}/attempts`)
  ).json();
  assert.deepEqual(
    attempts.items.map((a: any) => a.status),
    ['SUCCEEDED', 'WAITING_INPUT'],
  );
  await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
  await expect(card).toHaveCount(0);
  assert.ok(!(await (await request.get(root + '/attention')).json()).items.some((i: any) => i.id === task));
  return { taskId: task, attempts: 2, originalWait: 'WAITING_INPUT', resumed: 'SUCCEEDED' };
}
