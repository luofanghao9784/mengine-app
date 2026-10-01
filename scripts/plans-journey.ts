/** Real personal delegation journey. SOURCE_LOOKUP uses the running engine; model execution stays off. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { browserType } from './browser-target.ts';
async function post(api: APIRequestContext, path: string, data: unknown, status = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const response = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function login(page: Page, email: string, password: string) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.access-shell')).toBeVisible();
}
export async function plansJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
  restart?: () => Promise<void>,
) {
  const browser = platform.context().browser()!,
    origin = new URL(platform.url()).origin,
    suffix = randomUUID().slice(0, 8),
    email = `plans-${suffix}@example.test`,
    password = `synthetic-${randomUUID()}`;
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const created = await post(
        platform.context().request,
        '/api/platform-admin/v1/tenants',
        { requestId: randomUUID(), name: `计划旅程 ${suffix}`, adminEmail: email },
        201,
      ),
      tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`;
    await post(context.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '计划合成用户',
      password,
    });
    await page.goto(`/workspace/#tenant=${tenant}&view=plans`);
    await login(page, email, password);
    await expect(page.getByRole('heading', { name: '我的持续计划', exact: true })).toBeVisible();
    const spaces = await (await context.request.get(`/api/v1/tenants/${tenant}/context`)).json(),
      space = spaces.workspaces.find((s: { kind: string }) => s.kind === 'PERSONAL').id;
    const csrf = await (await context.request.get('/api/v1/auth/csrf')).json();
    const upload = await context.request.post(root + `/workspaces/${space}/materials`, {
      headers: { [csrf.headerName]: csrf.token },
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(
            JSON.stringify({ requestId: randomUUID(), folderId: null, expectedVersion: null }),
          ),
        },
        file: {
          name: 'plan-progress.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('项目进度：第一阶段已经整理资料，第二阶段需要确认交付日期。\n'),
        },
      },
    });
    assert.equal(upload.status(), 201, await upload.text());
    const material = await upload.json();
    const details = await (
      await context.request.get(root + `/workspaces/${space}/materials/${material.id}`)
    ).json();
    const version = details.versions[0].id;
    await expect
      .poll(
        async () => {
          const r = await context.request.get(
            root + `/workspaces/${space}/materials/${material.id}/versions/${version}/analysis`,
          );
          return (await r.json()).status;
        },
        { timeout: 45000 },
      )
      .toBe('READY');
    async function createPlan(goal: string, mode: string) {
      await page.getByRole('button', { name: '新建计划', exact: true }).click();
      await page.getByLabel('持续目标', { exact: true }).fill(goal);
      await page.getByLabel('用途与边界', { exact: true }).fill('仅本人检索项目进度，不向其他成员发布');
      await page.getByLabel('资料范围', { exact: true }).selectOption(space);
      await page.getByLabel('执行行为', { exact: true }).selectOption(mode);
      await page.getByLabel('检查内容', { exact: true }).fill('进度');
      await page.getByLabel('最短间隔（分钟）', { exact: true }).fill('1');
      const saved = page.waitForResponse(
        (r) => r.url().endsWith(root + '/plans') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '保存委托草案', exact: true }).click();
      const result = await (await saved).json();
      assert.equal(result.status, 'DRAFT');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: '查看委托并启用', exact: true }).click();
      const confirm = page.getByRole('button', { name: '启用持续委托', exact: true });
      await expect(confirm).toBeDisabled();
      await page
        .getByRole('checkbox', { name: '我确认以上范围、用途、行为、次数与结束条件', exact: true })
        .check();
      await confirm.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      return result.id as string;
    }
    const lookup = await createPlan('真实进度依据检查', 'SOURCE_LOOKUP');
    await page.close(); // No page or client timer remains alive; the service must still dispatch and finish.
    await expect
      .poll(
        async () => {
          const runs = await (await context.request.get(root + `/plans/${lookup}/runs`)).json();
          return runs.items[0]?.status;
        },
        { timeout: 45000 },
      )
      .toBe('SUCCEEDED');
    const history = await (await context.request.get(root + `/plans/${lookup}/runs`)).json();
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].sourceVersions[0].versionId, version);
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/workspace/#tenant=${tenant}&view=plans&plan=${lookup}`);
    await expect(page.locator('.plans-runs')).toContainText('检查完成');
    await page.getByRole('link', { name: '查看原任务', exact: true }).click();
    await expect.poll(() => page.url()).toContain(`conversation=${history.items[0].conversationId}`);
    await expect(page.locator('body')).toContainText('进度');
    await page.goto(`/workspace/#tenant=${tenant}&view=plans&plan=${lookup}`);
    await page.getByRole('button', { name: '查看委托版本', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('真实进度依据检查');
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await screenshot(page, 'plans-running-desktop.png');
    await page.getByRole('button', { name: '关闭提醒', exact: true }).click();
    const mutePattern = '**' + root + `/plans/${lookup}/actions`;
    const muteKeys: string[] = [];
    let muteLost = true;
    await page.route(mutePattern, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      muteKeys.push(route.request().postDataJSON().requestId);
      const response = await route.fetch();
      if (muteLost) {
        muteLost = false;
        assert.equal(response.status(), 200);
        await route.abort('failed');
      } else await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '关闭一般提醒', exact: true }).click();
    const muteDialog = page.getByRole('dialog');
    await expect(muteDialog.getByRole('button', { name: '重试相同请求', exact: true })).toBeEnabled();
    await expect(muteDialog.getByRole('button', { name: '返回', exact: true })).toBeDisabled();
    await muteDialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await expect(muteDialog).toBeVisible();
    await muteDialog.getByRole('button', { name: '重试相同请求', exact: true }).click();
    await expect.poll(() => muteKeys.length).toBe(2);
    assert.equal(muteKeys[0], muteKeys[1]);
    await page.unroute(mutePattern);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    let current = await (await context.request.get(root + `/plans/${lookup}`)).json();
    assert.equal(current.status, 'ACTIVE');
    assert.equal(current.configuration.notificationsEnabled, false);
    await page.getByRole('button', { name: '暂停计划', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '暂停计划', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '核对并恢复计划', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '核对并恢复计划', exact: true }).click();
    await page
      .getByRole('checkbox', { name: '我确认以上范围、用途、行为、次数与结束条件', exact: true })
      .check();
    await page.getByRole('button', { name: '恢复持续委托', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '停止计划', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '停止计划', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const waiting = await createPlan('等待模型的进度分析', 'ANALYZE');
    await expect
      .poll(
        async () => {
          const r = await context.request.get(root + `/plans/${waiting}`);
          return (await r.json()).runtimeState;
        },
        { timeout: 20000 },
      )
      .toBe('WAITING_CAPABILITY');
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect(page.getByRole('article', { name: '计划详情' })).toContainText('未消耗运行次数');
    assert.equal((await (await context.request.get(root + `/plans/${waiting}/runs`)).json()).items.length, 0);
    assert.equal((await platform.context().request.get(root + `/plans/${waiting}`)).status(), 403);
    assert.equal((await (await context.request.get(root + '/plans/attention')).json()).items.length, 0);
    if (restart) {
      await restart();
      await page.goto(`/workspace/#tenant=${tenant}&view=plans&plan=${waiting}`);
      await expect(page.getByRole('heading', { name: '我的持续计划', exact: true })).toBeVisible();
      await expect
        .poll(
          async () => {
            const p = await (await context.request.get(root + `/plans/${waiting}`)).json();
            return p.runtimeState;
          },
          { timeout: 20000 },
        )
        .toBe('WAITING_CAPABILITY');
      assert.equal(
        (await (await context.request.get(root + `/plans/${waiting}/runs`)).json()).items.length,
        0,
      );
      assert.equal(
        (await (await context.request.get(root + `/plans/${lookup}/runs`)).json()).items.length,
        1,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'plans-waiting-mobile.png');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    return {
      tenant,
      waiting,
      restartVerified: Boolean(restart),
      checks:
        'real lookup with page closed, exact trigger versions, private owner, explicit activation, pause/resume/stop, notifications independent, model-off waiting with zero runs, mobile layout',
    };
  } catch (error) {
    await screenshot(page, 'plans-failure.png').catch(() => {});
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 3500),
    );
    throw error;
  } finally {
    await context.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-plans-'));
  const artifacts = join(cwd, '.local/plans');
  await mkdir(artifacts, { recursive: true });
  let child = spawn('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
    cwd,
    stdio: 'ignore',
  });
  let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
  try {
    let base = '';
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw Error('Owned trial startup failed');
      try {
        const r = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
        if (r.state === 'ready') {
          base = r.webUrl;
          break;
        }
      } catch {}
      await delay(200);
    }
    assert(base, 'Owned trial not ready');
    assert.equal(new URL(base).hostname, '127.0.0.1');
    const account = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8')).platform;
    browser = await browserType.launch();
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    await page.goto('/platform-admin/');
    await login(page, account.email, account.password);
    const restart = async () => {
      const previous = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8')).runId;
      const stop = spawn('python3', ['scripts/local/trial.py', 'stop', '--directory', directory], {
        cwd,
        stdio: 'ignore',
      });
      await new Promise<void>((resolve) => stop.once('exit', () => resolve()));
      if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child = spawn('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
        cwd,
        stdio: 'ignore',
      });
      for (let i = 0; i < 300; i++) {
        if (child.exitCode !== null) throw Error('Owned trial restart failed');
        try {
          const r = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
          if (r.state === 'ready' && r.runId !== previous) return;
        } catch {}
        await delay(200);
      }
      throw Error('Owned trial restart timed out');
    };
    const result = await plansJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
      restart,
    );
    console.log(JSON.stringify({ passed: true, ...result }));
  } finally {
    await browser?.close();
    const stop = spawn('python3', ['scripts/local/trial.py', 'stop', '--directory', directory], {
      cwd,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => stop.once('exit', () => resolve()));
    if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await standalone();
