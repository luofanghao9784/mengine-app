/** Real persistent focus layout and recommendation packing journey. Model transport stays off. */
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

export async function focusLayoutJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
  seed: (tenant: string, shared: string, author: string, task: string) => Promise<void>,
  restart?: () => Promise<void>,
) {
  const browser = platform.context().browser()!,
    origin = new URL(platform.url()).origin;
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage();
  const email = `layout-${randomUUID()}@example.test`,
    password = `synthetic-${randomUUID()}`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const created = await post(
      platform.context().request,
      '/api/platform-admin/v1/tenants',
      { requestId: randomUUID(), name: '关注布局合成验收', adminEmail: email },
      201,
    );
    const tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`,
      briefing = root + '/briefing';
    await post(context.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '合成布局成员',
      password,
    });
    await page.goto(`/workspace/#tenant=${tenant}`);
    await login(page, email, password);
    const actor = (await (await context.request.get('/api/v1/me')).json()).account.id;
    const personal = (await (await context.request.get(root + '/context')).json()).workspaces.find(
      (w: any) => w.kind === 'PERSONAL',
    ).id;
    const shared = await post(
      context.request,
      `/api/tenant-admin/v1/tenants/${tenant}/workspaces`,
      { requestId: randomUUID(), name: '合成fixture范围' },
      201,
    );
    const ids: string[] = [];
    for (const label of ['甲', '乙', '丙']) {
      const receipt = await post(
        context.request,
        root + '/conversations',
        {
          requestId: randomUUID(),
          workspaceId: personal,
          prompt: `关注布局 ${label}`,
          mode: 'AGENT',
          originals: [],
        },
        202,
      );
      assert.equal(receipt.tasks.at(-1).status, 'WAITING_CAPABILITY');
      await seed(tenant, shared.id, actor, receipt.tasks.at(-1).id);
      ids.push(receipt.conversation.id);
      await post(context.request, briefing + '/' + receipt.conversation.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        pinned: true,
        hidden: false,
        size: label === '乙' ? 'WIDE' : 'STANDARD',
      });
    }
    const initialLatest = (await (await context.request.get(briefing)).json()).items;
    const focused = async () =>
      (await (await context.request.get(briefing + '?view=FOCUSED')).json()).items.map(
        (c: any) => c.conversationId,
      );
    assert.deepEqual(await focused(), ids);
    await page.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await page.getByRole('tab', { name: '关注', exact: true }).click();
    const cards = page.locator('.live-briefing-card');
    await expect(cards).toHaveCount(3);
    const card = (id: string) => page.locator(`.live-briefing-card[data-conversation-id="${id}"]`);
    let armed = true;
    const keys: string[] = [];
    await page.route('**' + briefing + '/layout', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().postDataJSON().requestId);
      const response = await route.fetch();
      if (armed) {
        armed = false;
        assert.equal(response.status(), 200);
        return route.abort('failed');
      }
      await route.fulfill({ response });
    });
    await card(ids[2]).hover();
    await card(ids[2]).getByRole('button', { name: '移动此卡', exact: true }).click();
    await card(ids[0]).hover();
    await card(ids[0]).getByRole('button', { name: '移到此卡前', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试本次布局', exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const previous = page.url();
    await page.evaluate(() => {
      location.hash = '#view=conversations';
    });
    await expect(page).toHaveURL(previous);
    await page.getByRole('button', { name: '重试本次布局', exact: true }).click();
    await expect(page.getByLabel('关注布局', { exact: true })).toContainText('关注布局已保存');
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.deepEqual(await focused(), [ids[2], ids[0], ids[1]]);
    assert.deepEqual((await (await context.request.get(briefing)).json()).items, initialLatest);
    await expect(cards.first()).toHaveAttribute('data-conversation-id', ids[2]);
    await page.setViewportSize({ width: 1440, height: 2200 });
    await card(ids[1]).hover();
    await card(ids[1]).getByRole('button', { name: '移动此卡', exact: true }).dragTo(card(ids[2]));
    await expect.poll(focused).toEqual([ids[1], ids[2], ids[0]]);
    await card(ids[1]).hover();
    await card(ids[1]).getByRole('button', { name: '移动此卡', exact: true }).click();
    await card(ids[0]).hover();
    await card(ids[0]).getByRole('button', { name: '移到此卡后', exact: true }).click();
    await expect.poll(focused).toEqual([ids[2], ids[0], ids[1]]);
    await screenshot(page, 'focus-layout-desktop.png');
    await page.reload();
    await page.getByRole('tab', { name: '关注', exact: true }).click();
    await expect(cards.first()).toHaveAttribute('data-conversation-id', ids[2]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card(ids[1])).toHaveClass(/wide/);
    await card(ids[2]).scrollIntoViewIfNeeded();
    await screenshot(page, 'focus-layout-mobile.png');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (restart) {
      await restart();
      await page.reload();
      await page.getByRole('tab', { name: '关注', exact: true }).click();
      await expect(cards.first()).toHaveAttribute('data-conversation-id', ids[2]);
    }
    for (const label of ['丁', '戊', '己']) {
      const receipt = await post(
        context.request,
        root + '/conversations',
        {
          requestId: randomUUID(),
          workspaceId: personal,
          prompt: `推荐补空 ${label}`,
          mode: 'AGENT',
          originals: [],
        },
        202,
      );
      await seed(tenant, shared.id, actor, receipt.tasks.at(-1).id);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('tab', { name: '推荐', exact: true }).click();
    const recommendations = page.locator('.recommendation-card');
    await expect(recommendations).toHaveCount(6);
    await expect(page.locator('.recommendation-grid')).toHaveAttribute('data-packed', 'true');
    const rectangles = await recommendations.evaluateAll((cards) =>
      cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left };
      }),
    );
    for (let n = 1; n < rectangles.length; n++)
      assert.ok(rectangles[n].top >= rectangles[n - 1].top - 1, 'Packing must preserve priority order');
    assert.ok(
      rectangles.slice(3).some((r) => r.top < Math.max(...rectangles.slice(0, 3).map((r) => r.bottom))),
      'Later cards fill earlier column gaps',
    );
    await screenshot(page, 'recommendation-packing-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(
        async () =>
          await recommendations.evaluateAll((cards) =>
            cards.every(
              (card, index) =>
                index === 0 ||
                card.getBoundingClientRect().top >= cards[index - 1].getBoundingClientRect().bottom,
            ),
          ),
      )
      .toBe(true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await recommendations.first().scrollIntoViewIfNeeded();
    await screenshot(page, 'recommendation-packing-mobile.png');
    assert.deepEqual(errors, []);
    return {
      tenant,
      manualOrder: true,
      pointerDrag: true,
      recommendationPacking: true,
      mobile: true,
      sameKeyRetry: true,
      restart: !!restart,
      latestUnchanged: true,
      model: 'off',
      fixture: 'explicit synthetic results',
    };
  } catch (e) {
    await screenshot(page, 'focus-layout-failure.png');
    throw e;
  } finally {
    await context.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-focus-layout-'));
  const artifacts = join(cwd, '.local/focus-layout');
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
    const result = await focusLayoutJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
      async (tenant, shared, author, task) => {
        const settings = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
        assert.equal(settings.workspace, cwd.replace(/\/$/, ''));
        assert.ok(directory.startsWith(join(tmpdir(), 'dreamcore-focus-layout-')));
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
            `BEGIN; INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES ('${tenant}','${shared}','${author}',true) ON CONFLICT DO NOTHING; UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,attempt=1,reply=prompt||'：合成排版正文，不是真实模型输出。'||repeat('合成排版段落；',CASE WHEN prompt LIKE '%丁' OR prompt LIKE '%甲' THEN 45 WHEN prompt LIKE '%己' THEN 5 ELSE 1 END),execution_class='verification',engine_version='0.8.0',wait_reason=NULL,finished_at=now() WHERE id='${task}' AND tenant_id='${tenant}' AND requested_by='${author}' AND status='WAITING_CAPABILITY'; COMMIT;`,
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
