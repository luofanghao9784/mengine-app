/** Real V42 historical-version maintenance only. Own synthetic trial; no model or external delivery. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { browserType } from './browser-target.ts';
import type { ProfileValue, ProfileHistory } from '../contracts/public-api/profile.ts';
import type { MethodFamily } from '../contracts/public-api/methods.ts';

async function post(api: APIRequestContext, path: string, data: unknown, expected = 200) {
  const csrf = await (await api.get('/api/v1/auth/csrf')).json();
  const result = await api.post(path, { data, headers: { [csrf.headerName]: csrf.token } });
  assert.equal(result.status(), expected, await result.text());
  return result.json();
}
async function login(page: Page, email: string, password: string) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.access-shell')).toBeVisible();
}
type ProbeWindow = Window & { __historyLoss?: { armed: boolean; keys: string[]; accepted: number | null } };
async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const native = fetch.bind(window);
    (window as ProbeWindow).__historyLoss = { armed: false, keys: [], accepted: null };
    window.fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      ).pathname;
      const p = (window as ProbeWindow).__historyLoss!;
      if (init?.method !== 'POST' || !path.includes('/object-lifecycle/') || !path.endsWith('/actions'))
        return native(input, init);
      p.keys.push(JSON.parse(String(init.body)).requestId);
      const result = await native(input, init);
      if (p.armed && result.ok) {
        p.armed = false;
        p.accepted = (await result.clone().json()).acceptedRevision;
        throw new TypeError('Synthetic loss after actual accepted HTTP response');
      }
      return result;
    };
  });
}
async function act(detail: Locator, action: string, label: string) {
  await detail.getByLabel('维护动作', { exact: true }).selectOption(action);
  if (action === 'PURGE') await detail.getByRole('checkbox', { name: /我确认在线正文不可恢复/ }).check();
  await detail.getByRole('button', { name: label, exact: true }).click();
}
async function state(detail: Locator, label: string) {
  await expect(detail.getByText(new RegExp(`当前状态：${label}`))).toBeVisible();
}
async function waitPurged(api: APIRequestContext, path: string, detail: Locator) {
  await expect
    .poll(
      async () => {
        const response = await api.get(path);
        assert.equal(response.status(), 200);
        return (await response.json()).object.state;
      },
      { timeout: 65000, intervals: [500, 1000, 2000] },
    )
    .toBe('PURGED');
  await detail.getByRole('button', { name: '刷新当前状态', exact: true }).click();
  await state(detail, '在线正文已清理');
}

/** Optional integration hook uses an existing platform session and invitation sink, creating only its own synthetic tenant. */
export async function historyLifecycleJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  artifacts: string,
) {
  await mkdir(artifacts, { recursive: true });
  const origin = new URL(platform.url()).origin,
    suffix = randomUUID().slice(0, 8),
    email = `history-${suffix}@example.test`,
    password = `synthetic-${randomUUID()}`;
  const context = await platform
    .context()
    .browser()!
    .newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(),
    errors: string[] = [];
  const recordError = (error: Error) => errors.push(error.message);
  page.on('pageerror', recordError);
  platform.on('pageerror', recordError);
  try {
    const created = await post(
        platform.context().request,
        '/api/platform-admin/v1/tenants',
        {
          requestId: randomUUID(),
          name: `历史维护合成企业 ${suffix}`,
          adminEmail: email,
          designateAuthorizationOwner: true,
        },
        201,
      ),
      tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`;
    await post(context.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '历史维护合成用户',
      password,
    });
    await installProbe(page);
    await page.goto(`/workspace/#tenant=${tenant}&view=profiles`);
    await login(page, email, password);
    const meResponse = await context.request.get('/api/v1/me');
    assert.equal(meResponse.status(), 200, await meResponse.text());
    const me = await meResponse.json(),
      actor = me.account.id;
    const first: ProfileValue = await post(context.request, root + `/profiles/PERSONAL/${actor}`, {
      requestId: randomUUID(),
      key: `历史维护偏好${suffix}`,
      kind: 'PREFERENCE',
      value: '合成旧版本正文，不应在清理后读取',
      provenance: '本人手工记录的合成数据',
      status: 'ACTIVE',
      expiresAt: null,
    });
    const second: ProfileValue = await post(
      context.request,
      root + `/profiles/entries/${first.id}/versions`,
      {
        requestId: randomUUID(),
        expectedRevision: 1,
        value: '合成当前版本',
        provenance: '本人修订',
        status: 'ACTIVE',
        expiresAt: null,
      },
    );
    await page.reload();
    await page.getByRole('button', { name: '查看版本', exact: true }).click();
    let dialog = page.getByRole('dialog'),
      detail = dialog.locator('.object-lifecycle-detail');
    await dialog.getByRole('button', { name: '维护版本 2', exact: true }).click();
    await expect(detail).toContainText('当前有效档案版本仍在使用');
    assert.equal(await detail.locator('option[value="PURGE"]').count(), 0);
    await detail.getByRole('button', { name: '返回版本记录', exact: true }).click();
    await dialog.getByRole('button', { name: '维护版本 1', exact: true }).click();
    const beforeTrashResponse = await context.request.get(
      root + `/object-lifecycle/PROFILE_VERSION/${first.versionId}`,
    );
    assert.equal(beforeTrashResponse.status(), 200, await beforeTrashResponse.text());
    const beforeTrashRevision = (await beforeTrashResponse.json()).object.revision;
    await page.evaluate(() => {
      (window as ProbeWindow).__historyLoss!.armed = true;
    });
    await act(detail, 'TRASH', '移入回收站');
    await expect(detail.getByRole('button', { name: '用原请求核对结果', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('档案范围', { exact: true })).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(detail.getByRole('button', { name: '用原请求核对结果', exact: true })).toBeVisible();
    await detail.getByRole('button', { name: '用原请求核对结果', exact: true }).click();
    await state(detail, '回收期内');
    const probe = await page.evaluate(() => (window as ProbeWindow).__historyLoss!);
    assert.equal(probe.keys.length, 2);
    assert.equal(probe.keys[0], probe.keys[1]);
    assert.equal(probe.accepted, beforeTrashRevision + 1);
    const events = await (
      await context.request.get(root + `/object-lifecycle/PROFILE_VERSION/${first.versionId}/history`)
    ).json();
    assert.equal(events.items.filter((e: { action: string }) => e.action === 'TRASH').length, 1);
    await act(detail, 'RESTORE', '恢复为停用');
    await state(detail, '已停用');
    assert.equal((await context.request.get(root + `/profiles/entries/${first.id}?version=1`)).status(), 404);
    await act(detail, 'ENABLE', '明确重新启用');
    await state(detail, '正常使用');
    assert.equal((await context.request.get(root + `/profiles/entries/${first.id}?version=1`)).status(), 200);
    await act(detail, 'PURGE', '永久清理在线正文');
    await waitPurged(context.request, root + `/object-lifecycle/PROFILE_VERSION/${first.versionId}`, detail);
    assert.equal((await context.request.get(root + `/profiles/entries/${first.id}?version=1`)).status(), 404);
    await page.screenshot({ path: join(artifacts, 'profile-history-purged-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, 'profile-history-purged-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    const withdrawn: ProfileValue = await post(
      context.request,
      root + `/profiles/entries/${first.id}/withdraw`,
      { requestId: randomUUID(), expectedRevision: second.revision },
    );
    await page.reload();
    await page.getByRole('button', { name: '查看版本', exact: true }).click();
    await dialog.getByRole('button', { name: `维护版本 ${withdrawn.revision}`, exact: true }).click();
    await act(detail, 'TRASH', '移入回收站');
    await state(detail, '回收期内');
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.reload();
    await expect(page.locator('.profile-records')).toContainText('正文不可用');
    await page.getByRole('button', { name: '查看版本', exact: true }).click();
    await dialog.getByRole('button', { name: `维护版本 ${withdrawn.revision}`, exact: true }).click();
    await state(detail, '回收期内');
    await act(detail, 'PURGE', '永久清理在线正文');
    await waitPurged(
      context.request,
      root + `/object-lifecycle/PROFILE_VERSION/${withdrawn.versionId}`,
      detail,
    );
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '填写新版本', exact: true }).click();
    await expect(dialog.getByLabel('内容', { exact: true })).toHaveValue('');
    await expect(dialog.getByLabel('依据与来源', { exact: true })).toHaveValue('');
    await dialog.getByLabel('内容', { exact: true }).fill('清理后本人重新填写的新偏好');
    await dialog.getByLabel('依据与来源', { exact: true }).fill('本次明确重新输入，不复原旧正文');
    await dialog.getByLabel('偏好期限', { exact: true }).selectOption('long');
    await dialog.getByRole('button', { name: '保存档案', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.profile-records')).toContainText('版本 4');
    assert.equal((await context.request.get(root + `/profiles/entries/${first.id}?version=3`)).status(), 404);
    const history: ProfileHistory = await (
      await context.request.get(root + `/profiles/entries/${first.id}/versions`)
    ).json();
    assert.equal(history.items.find((v) => v.revision === 1)?.bodyAvailable, false);
    assert.equal(history.items.find((v) => v.revision === 3)?.bodyAvailable, false);
    assert.equal(history.items.find((v) => v.revision === 4)?.bodyAvailable, true);

    const methods = '/api/platform-admin/v1/methods';
    const family: MethodFamily = await post(
      platform.context().request,
      methods,
      {
        requestId: randomUUID(),
        title: `无采用历史方法 ${suffix}`,
        configuration: { relevanceWeight: 1, recencyWeight: 0, importanceWeight: 0 },
        rationale: '合成旧方法，无发布或采用',
      },
      201,
    );
    const old = family.versions[0];
    await post(platform.context().request, methods + `/${family.id}/candidates`, {
      requestId: randomUUID(),
      expectedRevision: family.revision,
      configuration: { relevanceWeight: 0, recencyWeight: 1, importanceWeight: 0 },
      rationale: '新的合成候选，使旧版本不再是当前候选',
    });
    await platform.getByRole('button', { name: '方法版本', exact: true }).click();
    await platform
      .locator('.evaluation-card')
      .filter({ hasText: family.title })
      .getByRole('button', { name: '查看版本与比较', exact: true })
      .click();
    await platform.getByRole('button', { name: '维护方法版本 2', exact: true }).click();
    detail = platform.getByRole('dialog').locator('.object-lifecycle-detail');
    await expect(detail).toContainText('当前候选或当前发布版本');
    assert.equal(await detail.locator('option[value="TRASH"]').count(), 0);
    await platform.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await platform.getByRole('button', { name: '维护方法版本 1', exact: true }).click();
    await act(detail, 'TRASH', '移入回收站');
    await state(detail, '回收期内');
    await act(detail, 'RESTORE', '恢复为停用');
    await state(detail, '已停用');
    await act(detail, 'ENABLE', '明确重新启用');
    await state(detail, '正常使用');
    await act(detail, 'PURGE', '永久清理在线正文');
    await waitPurged(
      platform.context().request,
      `/api/platform-admin/v1/object-lifecycle/METHOD_VERSION/${old.id}`,
      detail,
    );
    await platform.screenshot({ path: join(artifacts, 'method-history-purged.png'), fullPage: true });
    await platform.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await expect(platform.getByRole('article', { name: '方法版本 1', exact: true })).toContainText(
      '此版本正文已停用、回收或清理',
    );
    const returned: MethodFamily = (await (await platform.context().request.get(methods)).json()).items.find(
      (f: MethodFamily) => f.id === family.id,
    );
    assert.equal(returned.versions.find((v) => v.id === old.id)?.configuration, null);
    assert.equal(returned.versions.find((v) => v.id === old.id)?.rationale, '');
    assert.deepEqual(errors, []);
    return {
      tenant,
      profileId: first.id,
      methodFamily: family.id,
      sameKeyRetry: true,
      refreshedRecoveryEntry: true,
      newVersionAfterPurge: true,
      realOnlineErasure: true,
      modelCalls: 0,
    };
  } catch (error) {
    await page
      .screenshot({ path: join(artifacts, 'history-profile-failure.png'), fullPage: true })
      .catch(() => {});
    await platform
      .screenshot({ path: join(artifacts, 'history-method-failure.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    platform.off('pageerror', recordError);
    await context.close();
  }
}

async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-history-lifecycle-'));
  const artifacts = join(cwd, '.local/history-lifecycle');
  const child = spawn('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
    cwd,
    stdio: 'ignore',
  });
  let browser: Awaited<ReturnType<typeof browserType.launch>> | undefined;
  try {
    let base = '';
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw Error('Owned history trial startup failed');
      try {
        const runtime = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
        if (runtime.state === 'ready') {
          base = runtime.webUrl;
          break;
        }
      } catch {}
      await delay(200);
    }
    assert(base, 'Owned history trial did not become ready');
    assert.equal(new URL(base).hostname, '127.0.0.1');
    const account = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8')).platform;
    browser = await browserType.launch();
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } }),
      platform = await context.newPage();
    await platform.goto('/platform-admin/');
    await login(platform, account.email, account.password);
    const result = await historyLifecycleJourney(
      platform,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      artifacts,
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
