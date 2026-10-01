/** Real object lifecycle journey. All model calls stay off. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
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

export async function feedbackAdjustmentJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
  seedSyntheticResult: (tenant: string, shared: string, author: string, task: string) => Promise<void>,
  restart?: () => Promise<void>,
) {
  const origin = new URL(platform.url()).origin,
    browser = platform.context().browser()!,
    suffix = randomUUID().slice(0, 8),
    password = `synthetic-${randomUUID()}`;
  const authorContext = await browser.newContext({ baseURL: origin }),
    readerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const authorPage = await authorContext.newPage(),
    page = await readerContext.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const email = `publication-author-${suffix}@example.test`,
      readerEmail = `publication-reader-${suffix}@example.test`;
    const created = await post(
        platform.context().request,
        '/api/platform-admin/v1/tenants',
        { requestId: randomUUID(), name: `共享副本反馈 ${suffix}`, adminEmail: email },
        201,
      ),
      tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`,
      adminRoot = `/api/tenant-admin/v1/tenants/${tenant}`;
    await post(authorContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '合成发布作者',
      password,
    });
    await authorPage.goto(`/tenant-admin/#tenant=${tenant}`);
    await login(authorPage, email, password);
    const author = (await (await authorContext.request.get('/api/v1/me')).json()).account.id;
    const context = await (await authorContext.request.get(root + '/context')).json(),
      personal = context.workspaces.find((w: any) => w.kind === 'PERSONAL').id;
    const space = await post(
      authorContext.request,
      adminRoot + '/workspaces',
      { requestId: randomUUID(), name: '共享交付副本' },
      201,
    );
    const taskReceipt = await post(
        authorContext.request,
        root + '/conversations',
        {
          requestId: randomUUID(),
          workspaceId: personal,
          prompt: '共享反馈合成验证成果',
          mode: 'AGENT',
          originals: [],
        },
        202,
      ),
      task = taskReceipt.tasks.at(-1).id;
    assert.equal(taskReceipt.tasks.at(-1).status, 'WAITING_CAPABILITY');
    // This bounded fixture creates only synthetic delivery bytes; it does not prove a model ran.
    await seedSyntheticResult(tenant, space.id, author, task);
    const document = await post(authorContext.request, root + '/documents', {
      requestId: randomUUID(),
      conversationId: taskReceipt.conversation.id,
      taskId: task,
      artifactId: null,
    });
    const published = await post(
      authorContext.request,
      root + `/documents/${document.document.id}/versions/1/publications`,
      { requestId: randomUUID(), workspaceId: space.id, format: 'docx', acknowledgeIndependentCopy: true },
    );
    const invite = await post(
      authorContext.request,
      adminRoot + '/invitations',
      { requestId: randomUUID(), email: readerEmail },
      201,
    );
    await post(readerContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(invite.id),
      displayName: '只读反馈成员',
      password,
    });
    await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await login(page, readerEmail, password);
    const reader = (await (await readerContext.request.get('/api/v1/me')).json()).account.id;
    const grant = await (await authorContext.request.get(adminRoot + `/workspaces/${space.id}`)).json();
    await post(authorContext.request, adminRoot + `/workspaces/${space.id}/members/${reader}`, {
      requestId: randomUUID(),
      expectedVersion: grant.version,
      enabled: true,
    });
    await page.reload();
    await page.getByLabel('画报视图', { exact: true }).selectOption('RECOMMENDED');
    const card = page
      .locator('.recommendation-card')
      .filter({ has: page.locator('[data-feedback-kind="PUBLICATION"]') });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('独立企业副本');
    const panel = card.locator('.feedback-panel');
    await panel.getByRole('button', { name: '评价 / 建议', exact: true }).click();
    const list = await (await readerContext.request.get(root + '/recommendations')).json(),
      target = list.items[0].feedbackTarget;
    assert.equal(target.kind, 'PUBLICATION');
    assert.equal(target.taskId, undefined);
    assert.equal(target.materialVersionId, published.materialVersionId);
    const query = new URLSearchParams(
      Object.fromEntries(
        Object.entries(target)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      ),
    );
    const lookup = async () =>
      (await (await readerContext.request.get(root + '/feedback?' + query)).json()).feedback;
    assert.equal(await lookup(), null);
    await panel.getByRole('button', { name: '没用', exact: true }).click();
    await panel.getByRole('button', { name: '告诉 AI 如何优化 / 继续调整会话', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '这张画报的独立调整会话' });
    const adjustments = async () =>
      await (await readerContext.request.get(root + '/feedback-adjustments?' + query)).json();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('尚无可读取的调整消息');
    assert.equal(await lookup(), null);
    assert.equal((await adjustments()).threadId, null);
    await dialog.getByLabel('本次画报评价', { exact: true }).selectOption('USEFUL');
    let dropFirstReceipt = true;
    const sendKeys: string[] = [];
    await page.route('**/feedback-adjustments', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      sendKeys.push(route.request().postDataJSON().requestId);
      if (dropFirstReceipt) {
        dropFirstReceipt = false;
        const accepted = await route.fetch();
        assert.equal(accepted.status(), 201, await accepted.text());
        await route.abort('failed');
      } else await route.continue();
    });
    await dialog.getByLabel('具体改进建议（发送后才记录）').fill('本卡先说明报告期间，保留确切来源。');
    assert.equal(await lookup(), null);
    await dialog.getByRole('button', { name: '发送建议并调整', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '重试同次发送', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '关闭调整会话', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重试同次发送', exact: true }).click();
    await expect(dialog).toContainText('已创建真实调整任务');
    assert.equal(sendKeys.length, 2);
    assert.equal(sendKeys[0], sendKeys[1]);
    await expect(dialog.locator('.adjustment-message')).toHaveCount(1);
    await expect(dialog.locator('.adjustment-message')).toContainText('当前未接入模型');
    const first = await adjustments();
    assert.equal(first.items[0].status, 'WAITING_CAPABILITY');
    assert.equal(first.items[0].reading.target.materialVersionId, published.materialVersionId);
    assert.equal(first.items[0].historyTaskIds.length, 0);
    assert.equal((await lookup()).revision, 1);
    assert.equal((await lookup()).assessment.rating, 'USEFUL');
    await dialog.getByRole('button', { name: '停止这条调整任务', exact: true }).click();
    await expect(dialog.locator('.adjustment-message')).toContainText('已停止');
    await dialog
      .getByLabel('具体改进建议（发送后才记录）')
      .fill('继续这张卡：结论后列清缺少的依据，不改长期偏好。');
    await dialog.getByRole('button', { name: '发送建议并调整', exact: true }).click();
    await expect(dialog.locator('.adjustment-message')).toHaveCount(2);
    const second = await adjustments();
    assert.equal(second.threadId, first.threadId);
    assert.equal(second.conversationId, first.conversationId);
    assert.equal(second.items[0].request, '本卡先说明报告期间，保留确切来源。');
    assert.deepEqual(second.items[1].historyTaskIds, [first.items[0].taskId]);
    assert.equal(second.items[1].status, 'WAITING_CAPABILITY');
    assert.equal((await lookup()).revision, 2);
    const ordinary = await (await readerContext.request.get(root + '/conversations')).json();
    assert.ok(!ordinary.items.some((c: any) => c.id === first.conversationId));
    const prefs = await (await readerContext.request.get(root + '/feedback/preferences')).json();
    assert.ok(prefs.items.every((p: any) => p.status === 'UNSET'));
    await screenshot(page, 'feedback-adjustment-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('button', { name: '发送建议并调整', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: '发送建议并调整', exact: true })).toBeInViewport();
    await screenshot(page, 'feedback-adjustment-mobile.png');
    await dialog.getByRole('button', { name: '关闭调整会话', exact: true }).click();
    await expect(panel).toContainText('评价修订 2');
    if (restart) {
      await restart();
      await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
      await page.reload();
      if (await page.getByLabel('邮箱', { exact: true }).isVisible())
        await login(page, readerEmail, password);
      await page.getByLabel('画报视图', { exact: true }).selectOption('RECOMMENDED');
      await expect(panel).toContainText('评价修订 2');
      await panel.getByRole('button', { name: '我的评价：有用', exact: true }).click();
      await panel.getByRole('button', { name: '没用', exact: true }).click();
      await panel.getByRole('button', { name: '告诉 AI 如何优化 / 继续调整会话', exact: true }).click();
      await expect(dialog.locator('.adjustment-message')).toHaveCount(2);
      assert.equal((await adjustments()).threadId, first.threadId);
      await dialog.getByRole('button', { name: '关闭调整会话', exact: true }).click();
    }
    const authorCards = await (await authorContext.request.get(root + '/recommendations')).json();
    const authorTarget = authorCards.items.find((i: any) => i.content.kind === 'PUBLICATION').feedbackTarget;
    const authorQuery = new URLSearchParams(
      Object.entries(authorTarget)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    );
    const authorView = await (
      await authorContext.request.get(root + '/feedback-adjustments?' + authorQuery)
    ).json();
    assert.equal(authorView.threadId, null);
    assert.equal(authorView.items.length, 0);
    assert.equal(
      (await platform.context().request.get(root + '/feedback-adjustments?' + query)).status(),
      403,
    );
    const info = await (await authorContext.request.get(adminRoot + `/workspaces/${space.id}`)).json();
    await post(authorContext.request, adminRoot + `/workspaces/${space.id}/members/${reader}`, {
      requestId: randomUUID(),
      expectedVersion: info.version,
      enabled: false,
    });
    assert.ok(
      [403, 404].includes(
        (await readerContext.request.get(root + '/feedback-adjustments?' + query)).status(),
      ),
    );
    await page.reload();
    await page.getByLabel('画报视图', { exact: true }).selectOption('RECOMMENDED');
    await expect(page.locator('[data-feedback-kind="PUBLICATION"]')).toHaveCount(0);
    assert.deepEqual(errors, []);
    return {
      tenant,
      thread: first.threadId,
      history: 2,
      feedbackRevision: 2,
      model: 'off',
      fixture: 'explicit synthetic published result',
      restart: !!restart,
      privateThread: true,
      sourceRevocation: true,
    };
  } catch (e) {
    await screenshot(page, 'feedback-adjustment-failure.png');
    throw e;
  } finally {
    await authorContext.close();
    await readerContext.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-feedback-adjustment-'));
  const artifacts = join(cwd, '.local/feedback-adjustment');
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
    const result = await feedbackAdjustmentJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
      async (tenant, shared, author, task) => {
        const settings = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
        assert.equal(settings.workspace, cwd.replace(/\/$/, ''));
        assert.ok(directory.startsWith(join(tmpdir(), 'dreamcore-feedback-adjustment-')));
        for (const value of [tenant, shared, author, task]) assert.match(value, /^[0-9a-f-]{36}$/);
        const credentials = JSON.parse(await readFile(join(directory, 'database.json'), 'utf8'));
        const seeded = spawnSync(
          process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, 'psql') : 'psql',
          [
            '-X',
            '-h',
            '127.0.0.1',
            '-p',
            String(settings.ports.database),
            '-U',
            'dreamcore_trial',
            '-d',
            'dreamcore_trial',
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            `BEGIN; INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES ('${tenant}','${shared}','${author}',true); UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,attempt=1,reply='合成发布正文，仅用于离线反馈流程验证，不是真实模型输出。',execution_class='verification',wait_reason=NULL,finished_at=now() WHERE id='${task}' AND tenant_id='${tenant}' AND requested_by='${author}' AND status='WAITING_CAPABILITY'; COMMIT;`,
          ],
          { env: { ...process.env, PGPASSWORD: credentials.password }, encoding: 'utf8' },
        );
        assert.equal(seeded.status, 0, 'Owned synthetic fixture failed');
      },
      restart,
    );
    console.log(JSON.stringify({ passed: true, ...result }));
  } finally {
    for (const name of ['supervisor.log', 'api.log', 'engine.log'])
      try {
        await copyFile(join(directory, name), join(artifacts, name));
      } catch {}
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
