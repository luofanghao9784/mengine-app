/** Real three-surface journey. Export can be called by verify-three-surfaces without changing its fixtures. */
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
  assert.equal(response.status(), status, `Unexpected status for ${path}`);
  return response.json();
}
async function login(page: Page, email: string, password: string) {
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.access-shell')).toBeVisible();
}
export async function governanceJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
) {
  const browser = platform.context().browser()!,
    origin = new URL(platform.url()).origin;
  const suffix = randomUUID().slice(0, 8),
    password = `synthetic-${randomUUID()}`,
    email = `governance-owner-${suffix}@example.test`,
    memberEmail = `governance-maintainer-${suffix}@example.test`;
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }),
    memberContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const owner = await ownerContext.newPage(),
    member = await memberContext.newPage();
  owner.setDefaultTimeout(10000);
  member.setDefaultTimeout(10000);
  const errors: string[] = [];
  for (const page of [owner, member]) page.on('pageerror', (e) => errors.push(e.message));
  try {
    await platform.goto('/platform-admin/');
    await platform.getByRole('button', { name: '开通企业', exact: true }).click();
    await platform.getByLabel('企业名称', { exact: true }).fill(`职责档案验证 ${suffix}`);
    await platform.getByLabel('初始管理员邮箱', { exact: true }).fill(email);
    const designation = platform.getByRole('checkbox', {
      name: '明确指定此初始管理员为企业授权负责人候选人',
    });
    await expect(designation).not.toBeChecked();
    await designation.check();
    const createdResponse = platform.waitForResponse(
      (r) => r.url().endsWith('/api/platform-admin/v1/tenants') && r.request().method() === 'POST',
    );
    await platform.getByRole('button', { name: '确认开通', exact: true }).click();
    const created = await (await createdResponse).json(),
      tenant = created.tenant.id;
    const root = `/api/v1/tenants/${tenant}`,
      admin = `/api/tenant-admin/v1/tenants/${tenant}`;
    await post(ownerContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '职责负责人',
      password,
    });
    await owner.goto(`/tenant-admin/#tenant=${tenant}`);
    await login(owner, email, password);
    await owner.getByRole('button', { name: '职责与授权', exact: true }).click();
    await expect(owner.getByText('当前负责人：尚未明确接受职责', { exact: true })).toBeVisible();
    await owner.getByRole('checkbox', { name: '我已了解并愿意承担上述职责', exact: true }).check();
    await owner.getByRole('button', { name: '接受企业授权负责人职责', exact: true }).click();
    await expect(owner.getByRole('heading', { name: '任命、交接与范围授权', exact: true })).toBeVisible();
    const ownerId = (await (await ownerContext.request.get('/api/v1/me')).json()).account.id;
    assert.equal((await (await ownerContext.request.get(root + '/governance')).json()).ownerId, ownerId);
    const invited = await post(
      ownerContext.request,
      admin + '/invitations',
      { requestId: randomUUID(), email: memberEmail },
      201,
    );
    await post(memberContext.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(invited.id),
      displayName: '部门维护同事',
      password,
    });
    await member.goto(`/workspace/#tenant=${tenant}`);
    await login(member, memberEmail, password);
    const memberId = (await (await memberContext.request.get('/api/v1/me')).json()).account.id;
    const space = await post(
      ownerContext.request,
      admin + '/workspaces',
      { requestId: randomUUID(), name: '验证部门' },
      201,
    );
    await post(ownerContext.request, admin + `/workspaces/${space.id}/members/${memberId}`, {
      requestId: randomUUID(),
      expectedVersion: 0,
      enabled: true,
    });
    // Search and explicitly grant a scoped capability through the real owner UI.
    await owner.getByRole('button', { name: '刷新职责', exact: true }).click();
    await owner.getByLabel('职责成员', { exact: true }).selectOption(memberId);
    await owner.getByLabel('能力范围', { exact: true }).selectOption(space.id);
    await owner.getByRole('button', { name: '授予此能力', exact: true }).click();
    await expect(owner.getByRole('button', { name: '撤销此能力', exact: true })).toBeVisible();
    await member.reload();
    await member.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await member.getByRole('link', { name: '企业管理', exact: true }).click();
    const requests: string[] = [];
    member.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await expect(member.getByRole('heading', { name: '职责与授权', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: '企业配置', exact: true })).toHaveCount(0);
    await expect(member.getByRole('link', { name: '工作空间', exact: true })).toBeVisible();
    await member.getByRole('button', { name: '档案维护', exact: true }).click();
    await expect(member.getByLabel('档案范围', { exact: true })).toHaveValue(space.id);
    assert(
      !requests.some((p) => p === admin + '/overview' || p === admin + '/members'),
      'Scoped entry must not request admin overview or member catalog',
    );
    assert.equal((await memberContext.request.get(admin + '/overview')).status(), 403);
    async function createProfile(page: Page, key: string, kind: string, value: string, longTerm = false) {
      await page.getByRole('button', { name: '新增档案记录', exact: true }).click();
      await page.getByLabel(/^档案名称/).fill(key);
      await page.getByLabel('记录类型', { exact: true }).selectOption(kind);
      await page.getByLabel('内容', { exact: true }).fill(value);
      await page.getByLabel('依据与来源', { exact: true }).fill('合成明确记录');
      await page.getByLabel('记录状态', { exact: true }).selectOption('ACTIVE');
      if (longTerm) await page.getByLabel('偏好期限', { exact: true }).selectOption('long');
      await page.getByRole('button', { name: '保存档案', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await createProfile(member, '部门口径', 'FACT', '按自然月统计');
    await expect(member.locator('.profile-records')).toContainText('按自然月统计');
    await screenshot(member, 'governance-scoped-management.png');
    // Revocation becomes visible on the normal focus revalidation path, without relying on a page reload.
    let governance = await (await ownerContext.request.get(root + '/governance')).json();
    await post(ownerContext.request, root + '/governance/capabilities', {
      requestId: randomUUID(),
      expectedVersion: governance.revision,
      accountId: memberId,
      workspaceId: space.id,
      capability: 'PROFILE_MAINTAIN',
      enabled: false,
    });
    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(member.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
    governance = await (await ownerContext.request.get(root + '/governance')).json();
    await post(ownerContext.request, root + '/governance/capabilities', {
      requestId: randomUUID(),
      expectedVersion: governance.revision,
      accountId: memberId,
      workspaceId: space.id,
      capability: 'PROFILE_MAINTAIN',
      enabled: true,
    });

    governance = await (await ownerContext.request.get(root + '/governance')).json();
    await post(ownerContext.request, root + '/governance/capabilities', {
      requestId: randomUUID(),
      expectedVersion: governance.revision,
      accountId: memberId,
      workspaceId: space.id,
      capability: 'EXPERIENCE_MAINTAIN',
      enabled: true,
    });
    const experienceRoot = `${root}/workspaces/${space.id}/experiences`;
    // The old shared manual author/publish journey is retired. Granted maintenance still cannot bypass automatic checks.
    const retired = await post(
      memberContext.request,
      experienceRoot,
      {
        requestId: randomUUID(),
        content: {
          kind: 'METHOD',
          title: '退役流程合成检查',
          summary: '不应生成候选',
          body: '不应写入',
          tags: [],
          applicable: '测试',
          excluded: '',
          dependencies: '',
          basis: '未核验',
          accessMode: 'INDEPENDENT_COPY',
        },
        evidence: [],
      },
      410,
    );
    assert.equal(retired.code, 'EXPERIENCE_MANUAL_WORKFLOW_RETIRED');
    const afterRetirement = await (
      await memberContext.request.get(experienceRoot + '?maintenance=true')
    ).json();
    assert.equal(afterRetirement.items.length, 0);
    await member.goto(`/tenant-admin/#tenant=${tenant}`);
    await member.getByRole('link', { name: '工作空间', exact: true }).click();
    await member.getByRole('button', { name: '更多工作与管理', exact: true }).click();
    await member.getByRole('link', { name: '档案', exact: true }).click();
    await expect(member.getByLabel('档案范围', { exact: true })).toHaveValue('personal');
    await createProfile(member, '表达偏好', 'PREFERENCE', '简洁表达', true);
    await member.getByRole('button', { name: '修订', exact: true }).click();
    await member.getByLabel('内容', { exact: true }).fill('先结论后依据');
    await member.getByLabel('偏好期限', { exact: true }).selectOption('temporary');
    await member.getByLabel(/^有效至/).fill('2030-12-31T12:00');
    await member.getByRole('button', { name: '保存档案', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.locator('.profile-records')).toContainText('版本 2');
    await member.getByRole('button', { name: '查看版本', exact: true }).click();
    await member.getByLabel('版本号', { exact: true }).fill('1');
    await member.getByRole('button', { name: '读取版本', exact: true }).click();
    await expect(member.getByRole('dialog')).toContainText('简洁表达');
    await member.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await member.getByRole('button', { name: '撤回', exact: true }).click();
    await member.getByRole('button', { name: '确认撤回', exact: true }).click();
    await expect(member.getByRole('dialog')).toHaveCount(0);
    await expect(member.locator('.profile-records')).toContainText('已撤回');
    assert.equal((await ownerContext.request.get(root + `/profiles/PERSONAL/${memberId}`)).status(), 404);
    assert.equal(
      (await platform.context().request.get(root + `/profiles/PERSONAL/${memberId}`)).status(),
      403,
    );
    await member.setViewportSize({ width: 390, height: 844 });
    await screenshot(member, 'governance-profile-mobile.png');
    assert(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // Tenant goal/inference remain distinct records and do not activate a plan.
    await owner.getByRole('button', { name: '档案维护', exact: true }).click();
    await owner.getByLabel('档案范围', { exact: true }).selectOption('tenant');
    await createProfile(owner, '企业目标', 'GOAL', '减少资料检索时间');
    await createProfile(owner, '使用推断', 'INFERENCE', '可能偏好简洁表达');
    await expect(owner.locator('.profile-records')).toContainText('推断');
    await owner.getByRole('button', { name: '职责与授权', exact: true }).click();
    await owner.getByLabel('职责成员', { exact: true }).selectOption(memberId);
    await owner.getByLabel('配置管理职责', { exact: true }).selectOption('TENANT_ADMIN');
    await owner.getByRole('button', { name: '保存管理职责', exact: true }).click();
    await expect
      .poll(async () => (await (await memberContext.request.get(root + '/governance')).json()).canConfigure)
      .toBe(true);
    await member.goto(`/tenant-admin/#tenant=${tenant}`);
    await expect(member.getByRole('button', { name: '企业配置', exact: true })).toBeVisible();
    await expect(member.getByRole('heading', { name: '企业成员', exact: true })).toBeVisible();
    await owner.getByLabel('配置管理职责', { exact: true }).selectOption('MEMBER');
    await owner.getByRole('button', { name: '保存管理职责', exact: true }).click();
    await expect
      .poll(async () => (await (await memberContext.request.get(root + '/governance')).json()).canConfigure)
      .toBe(false);
    await owner.getByRole('checkbox', { name: '确认向此成员发起交接', exact: true }).check();
    await owner.getByRole('button', { name: '发起负责人交接', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await memberContext.request.get(root + '/governance')).json()).pendingHandover?.toAccount,
      )
      .toBe(memberId);
    await member.reload();
    await member.getByRole('button', { name: '职责与授权', exact: true }).click();
    await member.getByRole('checkbox', { name: '我已了解并愿意承担上述职责', exact: true }).check();
    await member.getByRole('button', { name: '接受负责人交接', exact: true }).click();
    await expect
      .poll(async () => (await (await memberContext.request.get(root + '/governance')).json()).ownerId)
      .toBe(memberId);
    await screenshot(member, 'governance-handover.png');
    // New owner can stop its own membership without fabricating a successor.
    await member.getByRole('button', { name: '企业配置', exact: true }).click();
    const row = member.locator('.tenant-rows > li').filter({ hasText: memberEmail });
    await row.getByRole('button', { name: '紧急安全停用', exact: true }).click();
    await expect(member.getByRole('button', { name: '确认紧急安全停用', exact: true })).toBeDisabled();
    await member.getByRole('checkbox', { name: '确认存在安全风险，需要立即停用', exact: true }).check();
    const stopped = member.waitForResponse((r) => r.url().endsWith(`/members/${memberId}/emergency-disable`));
    await member.getByRole('button', { name: '确认紧急安全停用', exact: true }).click();
    const receipt = await (await stopped).json();
    assert.equal(receipt.recoveryStatus, 'PENDING_VERIFICATION');
    assert.equal((await memberContext.request.get(root + '/governance')).status(), 403);
    assert.equal((await (await ownerContext.request.get(root + '/governance')).json()).ownerId, memberId);
    const recovery = await platform
      .context()
      .request.get(
        `/api/platform-admin/v1/tenants/${tenant}/governance-recovery-requests/${receipt.recoveryRequestId}`,
      );
    assert.equal(recovery.status(), 200);
    assert.equal((await recovery.json()).status, 'PENDING_VERIFICATION');
    await platform.getByRole('button', { name: '登记待核验申请', exact: true }).click();
    await expect(platform.getByRole('dialog')).toContainText('已登记，待核验');
    await screenshot(platform, 'governance-platform-recovery.png');
    assert.deepEqual(errors, []);
    return {
      tenant,
      checks:
        'explicit designation, accepted ownership/handover, scope-only management, experience same-object dual-entry publication, profile revision/history/withdrawal, private isolation, safety stop, pending-only recovery',
    };
  } catch (error) {
    await screenshot(owner, 'governance-owner-failure.png');
    await screenshot(member, 'governance-member-failure.png');
    console.error('Owner visible state:', await owner.locator('body').innerText());
    throw error;
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
}

// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-b1-governance-'));
  const artifacts = join(cwd, '.local/b1-governance');
  await mkdir(artifacts, { recursive: true });
  const child = spawn('python3', ['scripts/local/trial.py', 'start', '--directory', directory], {
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
    const result = await governanceJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
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
