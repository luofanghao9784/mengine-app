/** Full effective departure through the integrated real application. Synthetic owned data only. */
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
import { departureJourney } from './departure-journey.ts';
import { managementConfigurationJourney } from './management-configuration-journey.ts';
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

async function verifyDeparture(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  artifacts: string,
  restart: () => Promise<void>,
) {
  const browser = platform.context().browser()!,
    suffix = randomUUID().slice(0, 8),
    password = `synthetic-${randomUUID()}`;
  const origin = new URL(platform.url()).origin;
  const ctx = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }),
    page = await ctx.newPage();
  const employeeContext = await browser.newContext({ baseURL: origin }),
    exportContext = await browser.newContext({ baseURL: origin }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const email = `departure-owner-${suffix}@example.test`,
      employeeEmail = `departure-member-${suffix}@example.test`;
    const created = await post(
      platform.context().request,
      '/api/platform-admin/v1/tenants',
      {
        requestId: randomUUID(),
        name: `退出实际旅程 ${suffix}`,
        adminEmail: email,
        designateAuthorizationOwner: true,
      },
      201,
    );
    const tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`,
      admin = `/api/tenant-admin/v1/tenants/${tenant}`;
    await post(ctx.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '退出验收负责人',
      password,
    });
    await page.goto(`/tenant-admin/#tenant=${tenant}`);
    await login(page, email, password);
    const me = await (await ctx.request.get('/api/v1/me')).json(),
      actor = me.account.id;
    let governance = await (await ctx.request.get(root + '/governance')).json();
    await post(ctx.request, root + '/governance/accept-initial-responsibility', {
      requestId: randomUUID(),
      expectedVersion: governance.revision,
    });
    for (const capability of ['MEMBER_OFFBOARD', 'TENANT_EXIT', 'BULK_EXPORT']) {
      governance = await (await ctx.request.get(root + '/governance')).json();
      await post(ctx.request, root + '/governance/capabilities', {
        requestId: randomUUID(),
        expectedVersion: governance.revision,
        accountId: actor,
        workspaceId: null,
        capability,
        enabled: true,
      });
    }
    const invited = await post(
      ctx.request,
      admin + '/invitations',
      { requestId: randomUUID(), email: employeeEmail },
      201,
    );
    await post(employeeContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(invited.id),
      displayName: '离职验收合成员工',
      password,
    });
    await post(employeeContext.request, '/api/v1/auth/login', { email: employeeEmail, password });
    const employee = (await (await employeeContext.request.get('/api/v1/me')).json()).account.id;
    const workspace = await post(
      ctx.request,
      admin + '/workspaces',
      { requestId: randomUUID(), name: '获权共享迁出资料' },
      201,
    );
    await post(ctx.request, admin + `/workspaces/${workspace.id}/members/${actor}`, {
      requestId: randomUUID(),
      expectedVersion: 0,
      enabled: true,
    });
    await post(ctx.request, admin + `/workspaces/${workspace.id}/members/${actor}/maintenance`, {
      requestId: randomUUID(),
      expectedVersion: 1,
      enabled: true,
    });
    const exportEmail = `departure-exporter-${suffix}@example.test`;
    const exportInvitation = await post(
      ctx.request,
      admin + '/invitations',
      { requestId: randomUUID(), email: exportEmail },
      201,
    );
    await post(exportContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(exportInvitation.id),
      displayName: '受限迁出负责人',
      password,
    });
    await post(exportContext.request, '/api/v1/auth/login', { email: exportEmail, password });
    const exporter = (await (await exportContext.request.get('/api/v1/me')).json()).account.id;
    await post(ctx.request, admin + `/workspaces/${workspace.id}/members/${exporter}`, {
      requestId: randomUUID(),
      expectedVersion: 2,
      enabled: true,
    });
    governance = await (await ctx.request.get(root + '/governance')).json();
    await post(ctx.request, root + '/governance/capabilities', {
      requestId: randomUUID(),
      expectedVersion: governance.revision,
      accountId: exporter,
      workspaceId: workspace.id,
      capability: 'BULK_EXPORT',
      enabled: true,
    });
    const csrf = await (await ctx.request.get('/api/v1/auth/csrf')).json();
    const uploaded = await ctx.request.post(root + `/workspaces/${workspace.id}/materials`, {
      headers: { [csrf.headerName]: csrf.token },
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), folderId: null })),
        },
        file: {
          name: 'exit-synthetic-original.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('真实迁出字节：仅合成验收数据'),
        },
      },
    });
    assert.equal(uploaded.status(), 201, await uploaded.text());
    const management = await managementConfigurationJourney(
      page,
      ctx.request,
      tenant,
      workspace.id,
      artifacts,
      `/tenant-admin/#tenant=${tenant}&manage=sources`,
      `/tenant-admin/#tenant=${tenant}&manage=configuration`,
    );
    if (process.argv.includes('--management-only')) return { tenant, ...management };
    await page.setViewportSize({ width: 1440, height: 1000 });
    const result = await departureJourney(
      page,
      ctx.request,
      tenant,
      employee,
      workspace.id,
      artifacts,
      `/tenant-admin/#tenant=${tenant}&manage=retention`,
      exporter,
    );
    await expect(page.locator('.departure-status')).toContainText('普通业务已停止');
    await page.getByRole('button', { name: '查看迁出与清理记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '离职与企业退出', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/view=departure/);
    const exportPage = await exportContext.newPage();
    exportPage.on('pageerror', (e) => errors.push(e.message));
    await exportPage.goto(`/workspace/#tenant=${tenant}`);
    await exportPage.getByRole('button', { name: '查看迁出与清理记录', exact: true }).click();
    await expect(exportPage.getByRole('heading', { name: '离职与企业退出', exact: true })).toBeVisible();
    await expect(exportPage.getByRole('button', { name: '办理企业退出', exact: true })).toHaveCount(0);
    await expect(exportPage.getByRole('button', { name: '办理员工离职', exact: true })).toHaveCount(0);
    const exportRecords = await (await exportContext.request.get(root + '/departures')).json();
    assert.equal(exportRecords.items.length, 1);
    assert.equal(
      (await exportContext.request.get(root + `/departure-exports/parts/${result.partId}`)).status(),
      404,
    );
    assert.equal((await exportContext.request.get(admin + '/overview')).status(), 403);
    await exportPage.screenshot({ path: join(artifacts, 'departure-designated-member.png'), fullPage: true });
    await restart();
    await page.goto(`/workspace/#tenant=${tenant}&view=departure`);
    await expect(page.locator('.departure-status')).toContainText('普通业务已停止');
    await expect(page.getByText('受限迁出期', { exact: true })).toBeVisible();
    const ps = await platform.context().request.get(`/api/v1/platform/tenants/${tenant}/departure-status`);
    assert.equal(ps.status(), 200);
    assert.equal((await ps.json()).canExport, false);
    assert.equal((await ps.json()).businessEnabled, false);
    await platform.goto('/platform-admin/');
    await platform.getByRole('button', { name: `查看企业 退出实际旅程 ${suffix}`, exact: true }).click();
    await expect(platform.getByRole('dialog').locator('.departure-status')).toContainText('普通业务已停止');
    await expect(
      platform.getByRole('dialog').getByRole('button', { name: '查看迁出与清理记录', exact: true }),
    ).toHaveCount(0);
    await platform.screenshot({ path: join(artifacts, 'departure-platform-state.png'), fullPage: true });

    assert.equal((await platform.context().request.get(root + '/departures')).status(), 403);
    const pctx = await (await ctx.request.get(root + '/context')).json();
    assert.deepEqual(
      pctx.workspaces.map((w: { id: string }) => w.id),
      [workspace.id],
    );
    assert.equal((await ctx.request.get(root + '/conversations')).status(), 403);
    assert.deepEqual(errors, []);
    return {
      tenant,
      ...result,
      restartVerified: true,
      clientHistoryEntry: true,
      designatedMemberEntry: true,
      privateReadsDenied: true,
    };
  } catch (e) {
    await page.screenshot({ path: join(artifacts, 'departure-failure.png'), fullPage: true }).catch(() => {});
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 7000),
    );
    throw e;
  } finally {
    await ctx.close();
    await employeeContext.close();
    await exportContext.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-departure-'));
  const artifacts = join(cwd, '.local/departure');
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
    const result = await verifyDeparture(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      artifacts,
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
