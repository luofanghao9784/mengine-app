/** Real object lifecycle journey. All model calls stay off. */
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

export async function objectLifecycleJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
  restart?: () => Promise<void>,
) {
  const origin = new URL(platform.url()).origin,
    browser = platform.context().browser()!,
    suffix = randomUUID().slice(0, 8),
    email = `lifecycle-${suffix}@example.test`,
    password = `synthetic-${randomUUID()}`;
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const created = await post(
        platform.context().request,
        '/api/platform-admin/v1/tenants',
        { requestId: randomUUID(), name: `生命周期旅程 ${suffix}`, adminEmail: email },
        201,
      ),
      tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`;
    await post(context.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '生命周期合成用户',
      password,
    });
    await page.goto(`/tenant-admin/#tenant=${tenant}`);
    await login(page, email, password);
    const spaces = await (await context.request.get(root + '/context')).json(),
      space = spaces.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id;
    const original = await post(
        context.request,
        root + '/conversations',
        {
          requestId: randomUUID(),
          workspaceId: space,
          prompt: 'LIFECYCLE PRIVATE SECRET：模型关闭时保留未执行任务',
          mode: 'AGENT',
          publicQuery: null,
          originals: [],
        },
        202,
      ),
      task = original.tasks.at(-1);
    assert.equal(task.status, 'WAITING_CAPABILITY');
    const visit = async () => {
      await page.getByRole('button', { name: '内容回收与清理', exact: true }).click();
      await expect(page.getByRole('heading', { name: '内容回收与清理', exact: true })).toBeVisible();
      await page.getByLabel('维护范围', { exact: true }).selectOption(space);
      await page.getByLabel('对象类型', { exact: true }).selectOption('TASK');
    };
    await visit();
    const card = () => page.getByRole('article', { name: `私人任务 ${task.id}`, exact: true });
    const command = async (action: string, label: string, purge = false) => {
      await card().getByRole('button', { name: '查看维护动作', exact: true }).click();
      await page.getByLabel('维护动作', { exact: true }).selectOption(action);
      if (purge)
        await page
          .getByRole('checkbox', {
            name: '我确认在线正文不可恢复，独立发布副本和必要记录另按规则保留',
            exact: true,
          })
          .check();
      await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await command('TRASH', '移入回收站');
    await expect(card()).toContainText('回收期内');
    const hidden = await (
      await context.request.get(root + `/conversations/${original.conversation.id}`)
    ).json();
    assert(!JSON.stringify(hidden).includes('LIFECYCLE PRIVATE SECRET'));
    assert.equal(hidden.tasks.find((t: { id: string }) => t.id === task.id).sourcesUnavailable, true);
    await screenshot(page, 'object-trash.png');
    await command('RESTORE', '恢复为停用');
    await expect(card()).toContainText('已停用');
    await command('ENABLE', '明确重新启用');
    await expect(card()).toContainText('正常使用');
    const restored = await (
      await context.request.get(root + `/conversations/${original.conversation.id}`)
    ).json();
    assert.equal(restored.tasks.find((t: { id: string }) => t.id === task.id).status, 'WAITING_CAPABILITY');
    await card().getByRole('button', { name: '查看维护动作', exact: true }).click();
    await page.getByLabel('维护动作', { exact: true }).selectOption('PURGE');
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '永久清理在线正文', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('checkbox', {
        name: '我确认在线正文不可恢复，独立发布副本和必要记录另按规则保留',
        exact: true,
      })
      .check();
    await page.getByRole('dialog').getByRole('button', { name: '永久清理在线正文', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const r = await context.request.get(root + `/object-lifecycle/TASK/${task.id}`);
          assert.equal(r.status(), 200);
          return (await r.json()).object.state;
        },
        { timeout: 45000, intervals: [1000, 2000] },
      )
      .toBe('PURGED');
    await page.getByRole('button', { name: '刷新生命周期', exact: true }).click();
    await expect(card()).toContainText('在线正文已清理');
    await screenshot(page, 'object-purged.png');
    assert.equal(
      (await platform.context().request.get(root + `/object-lifecycle/TASK/${task.id}`)).status(),
      403,
    );
    if (restart) {
      await restart();
      await page.goto(`/tenant-admin/#tenant=${tenant}`);
      await visit();
      await expect(card()).toContainText('在线正文已清理');
    }
    await platform.getByRole('button', { name: '内容回收与清理', exact: true }).click();
    await expect(
      platform.getByRole('heading', { name: '通用评估资产与清理状态', exact: true }),
    ).toBeVisible();
    await expect(platform.getByRole('complementary', { name: '跨企业技术状态' })).toBeVisible();
    assert(!(await platform.locator('body').innerText()).includes(task.id));
    await screenshot(platform, 'object-platform-summary.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'object-mobile.png');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    return {
      tenant,
      task: task.id,
      restartVerified: Boolean(restart),
      checks:
        'real task trash/restore/explicit enable without restart; irreversible checkbox; real worker body erasure; no platform customer object access; persistent tombstone; bounded technical-only aggregate',
    };
  } catch (e) {
    await screenshot(page, 'object-failure.png').catch(() => {});
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 5000),
    );
    throw e;
  } finally {
    await context.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-object-lifecycle-'));
  const artifacts = join(cwd, '.local/object-lifecycle');
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
    const result = await objectLifecycleJourney(
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
