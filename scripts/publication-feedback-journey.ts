import { forwardingJourney } from './forwarding-journey.ts';
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

export async function publicationFeedbackJourney(
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
    await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const card = page.locator(`.recommendation-card[data-content-id="${published.materialVersionId}"]`);
    const readerDialog = page.locator('dialog.live-reading-dialog');
    const panel = readerDialog.locator('.feedback-panel[data-feedback-kind="PUBLICATION"]');
    const openFeedback = async () => {
      await expect(card).toHaveCount(1);
      await card.locator('.live-briefing-body').click();
      await expect(readerDialog).toContainText('企业发布的独立副本');
      await readerDialog.getByRole('button', { name: '评价 / 建议', exact: true }).click();
      await expect(panel).toBeVisible();
    };
    await expect(card).toContainText('企业副本');
    await openFeedback();
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
    await panel.getByRole('button', { name: '有用', exact: true }).click();
    await expect(panel.locator('.feedback-notice')).toContainText('评价已保存');
    let f = await lookup();
    assert.equal(f.revision, 1);
    assert.equal(f.assessment.rating, 'USEFUL');
    assert.equal((await authorContext.request.get(root + '/feedback/' + f.id)).status(), 404);
    assert.equal((await platform.context().request.get(root + '/feedback/' + f.id)).status(), 403);
    await panel.getByRole('button', { name: '没用', exact: true }).click();
    assert.equal((await lookup()).revision, 1);
    await panel.getByRole('button', { name: '内容不准确或已过时', exact: true }).click();
    await expect(panel).toContainText('评价修订 2');
    await panel.getByRole('button', { name: '告诉 AI 如何优化 / 继续调整会话', exact: true }).click();
    const adjustment = page.getByRole('dialog', { name: '这张画报的独立调整会话' });
    await adjustment.getByLabel('具体改进建议（发送后才记录）').fill('合成建议：日期请保留来源说明');
    assert.equal((await lookup()).revision, 2);
    await adjustment.getByRole('button', { name: '发送建议并调整', exact: true }).click();
    await expect(adjustment).toContainText('已创建真实调整任务');
    await adjustment.getByRole('button', { name: '关闭调整会话', exact: true }).click();
    await expect(panel).toContainText('评价修订 3');
    await panel.getByRole('button', { name: '撤回评价', exact: true }).click();
    await expect(panel).toContainText('评价已撤回');
    f = await lookup();
    assert.equal(f.status, 'WITHDRAWN');
    assert.equal(f.revision, 4);
    await panel.getByRole('button', { name: '有用', exact: true }).click();
    await expect(panel).toContainText('评价修订 5');
    assert.equal((await lookup()).status, 'ACTIVE');
    await panel.getByRole('button', { name: '创建本次纠正任务', exact: true }).click();
    await panel.getByLabel('明确的本次纠正要求').fill('请核对副本中的日期，仅作为本人私人纠正任务。');
    await panel.locator('.feedback-confirm input').check();
    await panel.getByRole('button', { name: '确认并执行所选动作', exact: true }).click();
    await expect(panel.locator('.feedback-receipts')).toContainText('等待模型或执行能力');
    const actions = await (await readerContext.request.get(root + '/feedback/' + f.id + '/actions')).json();
    const correction = actions.items.find((a: any) => a.kind === 'CORRECTION');
    assert.ok(correction.targetWorkspaceId);
    assert.notEqual(correction.targetWorkspaceId, space.id);
    await panel.getByRole('button', { name: '查看纠正会话', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`conversation=${correction.conversationId}`));
    await expect(page.locator('.conversation-reader')).toBeVisible();
    await expect(page.locator('.conversation-reader')).toContainText('等待');
    await expect(readerDialog).toHaveCount(0);
    await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await openFeedback();
    await expect(panel).toContainText('评价修订 5');
    await screenshot(page, 'publication-feedback-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    await screenshot(page, 'publication-feedback-mobile.png');
    if (restart) {
      await restart();
      // The URL is already this hash route; force a fresh document to verify persisted state.
      await page.reload();
      if (await page.getByLabel('邮箱', { exact: true }).isVisible())
        await login(page, readerEmail, password);
      await openFeedback();
      await expect(panel).toContainText('评价修订 5');
      assert.equal((await lookup()).revision, 5);
    }
    const forwarding = await forwardingJourney({
      tenant,
      publicationId: published.id,
      materialVersionId: published.materialVersionId,
      recipientId: reader,
      senderContext: authorContext,
      recipientContext: readerContext,
      artifacts: join(fileURLToPath(new URL('../', import.meta.url)), '.local/publication-feedback'),
      revokeRecipient: async () => {
        const info = await (await authorContext.request.get(adminRoot + `/workspaces/${space.id}`)).json();
        await post(authorContext.request, adminRoot + `/workspaces/${space.id}/members/${reader}`, {
          requestId: randomUUID(),
          expectedVersion: info.version,
          enabled: false,
        });
      },
    });
    assert.equal((await readerContext.request.get(root + '/feedback/' + f.id)).status(), 404);
    await page.reload();
    await expect(page.getByRole('tab', { name: '推荐', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-feedback-kind="PUBLICATION"]')).toHaveCount(0);
    assert.deepEqual(errors, []);
    return {
      tenant,
      publication: published.id,
      feedback: f.id,
      finalRevision: 5,
      model: 'off',
      fixture: 'explicit synthetic result',
      restart: !!restart,
      readOnlyReader: true,
      privateOpinions: true,
      forwarding,
    };
  } catch (e) {
    await screenshot(page, 'publication-feedback-failure.png');
    throw e;
  } finally {
    await authorContext.close();
    await readerContext.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-publication-feedback-'));
  const artifacts = join(cwd, '.local/publication-feedback');
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
    const result = await publicationFeedbackJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
      async (tenant, shared, author, task) => {
        const settings = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
        assert.equal(settings.workspace, cwd.replace(/\/$/, ''));
        assert.ok(directory.startsWith(join(tmpdir(), 'dreamcore-publication-feedback-')));
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
