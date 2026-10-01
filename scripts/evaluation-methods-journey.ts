/** Real evaluation, issue, method publication and scope-adoption journey. All model calls stay off. */
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
import { retentionJourney } from './retention-journey.ts';
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

export async function evaluationMethodsJourney(
  platform: Page,
  invitation: (id: string) => Promise<string>,
  screenshot: (page: Page, name: string) => Promise<void>,
  restart?: () => Promise<void>,
  retentionArtifacts?: string,
) {
  const origin = new URL(platform.url()).origin,
    browser = platform.context().browser()!,
    suffix = randomUUID().slice(0, 8),
    email = `evaluation-${suffix}@example.test`,
    password = `synthetic-${randomUUID()}`;
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  platform.on('pageerror', (e) => errors.push(e.message));
  try {
    await platform.getByRole('button', { name: '方法版本', exact: true }).click();
    await expect(platform.getByRole('heading', { name: '通用方法维护', exact: true })).toBeVisible();
    await platform.getByRole('button', { name: '建立排序校验样例', exact: true }).click();
    const suiteTitle = `近期优先合成检查 ${suffix}`;
    await platform.getByLabel('检查组名称', { exact: true }).fill(suiteTitle);
    await platform.getByRole('button', { name: '保存合成标准与样例', exact: true }).click();
    await expect(platform.getByRole('dialog')).toHaveCount(0);
    await platform.getByRole('button', { name: '新建方法候选', exact: true }).click();
    await platform.getByLabel('方法名称', { exact: true }).fill(`近期优先 ${suffix}`);
    await platform.getByLabel('相关度权重', { exact: true }).fill('0');
    await platform.getByLabel('新鲜度权重', { exact: true }).fill('1');
    await platform.getByLabel('业务重要度权重', { exact: true }).fill('0');
    await platform
      .getByLabel('适用条件与修改理由', { exact: true })
      .fill('只检验近期条目优先的合成机制，业务价值未验证');
    const saved = platform.waitForResponse(
      (r) => r.url().endsWith('/api/platform-admin/v1/methods') && r.request().method() === 'POST',
    );
    await platform.getByRole('button', { name: '保存方法候选', exact: true }).click();
    const family = await (await saved).json();
    await expect(platform.getByRole('dialog')).toHaveCount(0);
    await platform.getByRole('button', { name: '比较当前候选', exact: true }).click();
    await platform
      .getByLabel('固定排序标准', { exact: true })
      .selectOption({ label: suiteTitle + ' · 标准' });
    await platform.getByRole('checkbox', { name: suiteTitle + ' · 样例', exact: true }).check();
    await platform.getByRole('button', { name: '运行合成比较', exact: true }).click();
    await expect(platform.getByRole('dialog')).toHaveCount(0);
    await expect(platform.getByText('基准符合 0/1；候选符合 1/1', { exact: true })).toBeVisible();
    await platform.getByRole('button', { name: '检查并发布此版本', exact: true }).click();
    await platform.getByRole('button', { name: '发布当前版本', exact: true }).click();
    await expect(platform.getByRole('dialog')).toHaveCount(0);
    await screenshot(platform, 'method-comparison-platform.png');
    const created = await post(
        platform.context().request,
        '/api/platform-admin/v1/tenants',
        {
          requestId: randomUUID(),
          name: `评价旅程 ${suffix}`,
          adminEmail: email,
          designateAuthorizationOwner: true,
        },
        201,
      ),
      tenant = created.tenant.id,
      root = `/api/v1/tenants/${tenant}`;
    await post(context.request, '/api/v1/auth/invitations/accept', {
      token: await invitation(created.invitation.id),
      displayName: '评价合成用户',
      password,
    });
    await page.goto(`/tenant-admin/#tenant=${tenant}`);
    await login(page, email, password);
    const spaces = await (await context.request.get(root + '/context')).json(),
      space = spaces.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id;
    await page.getByRole('button', { name: '方法版本', exact: true }).click();
    await page.getByLabel('方法生效范围', { exact: true }).selectOption(space);
    await expect(page.getByRole('article', { name: '当前采用' })).toContainText('内建默认');
    await page.getByRole('button', { name: '查看版本与比较', exact: true }).click();
    await page.getByRole('button', { name: '在本范围采用版本 1', exact: true }).click();
    await page.getByRole('checkbox', { name: '我确认本范围与合成验证的限制', exact: true }).check();
    await page.getByRole('button', { name: '采用此版本', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('article', { name: '当前采用' })).toContainText('空间采用');
    const selection = await (
      await context.request.get(root + `/methods/selection?workspace=${space}`)
    ).json();
    assert.equal(selection.effective.versionId, family.headVersion);
    const original = await post(
        context.request,
        root + '/conversations',
        {
          requestId: randomUUID(),
          workspaceId: space,
          prompt: '核对当前交付缺口，资料不足如实等待',
          mode: 'AGENT',
          publicQuery: null,
          originals: [],
        },
        202,
      ),
      task = original.tasks.at(-1);
    assert.equal(task.status, 'WAITING_CAPABILITY');
    await page.getByRole('button', { name: '评估与问题', exact: true }).click();
    await page.getByLabel('评价范围', { exact: true }).selectOption(space);
    await page.getByRole('button', { name: '新建标准', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('执行事实与用户作用分开');
    await page.getByLabel('适用范围与依据', { exact: true }).fill('仅检查本人任务是否完成，帮助程度保留未知');
    await page.getByLabel('判断维度 1').selectOption('RUNTIME');
    await page.getByLabel('检查方式 1').selectOption('TASK_SUCCEEDED');
    await page.getByLabel('要求 1', { exact: true }).fill('如实核对原任务状态');
    await page.getByRole('button', { name: '添加检查项', exact: true }).click();
    await page.getByLabel('判断维度 2').selectOption('USER_EFFECT');
    await page.getByLabel('要求 2', { exact: true }).fill('实际是否有帮助需另有依据');
    await page.getByRole('button', { name: '保存不可变版本', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '新建样例', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('实际等待任务样例');
    await page.getByLabel('适用范围与依据', { exact: true }).fill('关联本人的真实任务版本，不复制成功结论');
    await page.getByLabel('样例输入与场景', { exact: true }).fill('模型关闭时任务仍未执行');
    await page.getByLabel('选择确切对象版本', { exact: true }).selectOption(task.id);
    await page.getByRole('button', { name: '保存不可变版本', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page
      .getByRole('article')
      .filter({ has: page.getByText('实际等待任务样例', { exact: true }) })
      .getByRole('button', { name: '内容与版本', exact: true })
      .click();
    await expect(page.getByText('此尝试没有计量记录；不补成零用量或零费用。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '评价记录', exact: true }).click();
    await page.getByRole('button', { name: '发起评价', exact: true }).click();
    await page.getByLabel('评价标准', { exact: true }).selectOption({ label: '执行事实与用户作用分开 · v1' });
    await page.getByRole('checkbox', { name: /实际等待任务样例/ }).check();
    // Keep the real request pending once, proving parent navigation cannot discard its idempotency key.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      '**/evaluation/runs',
      async (route) => {
        if (route.request().method() === 'POST') {
          await held;
          await route.continue();
        } else await route.continue();
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: '保存评价记录', exact: true }).click();
    await expect(page.getByRole('button', { name: '方法版本', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('符合 0 / 不符合 1 / 未知 0', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '记录复核判断', exact: true }).click();
    await page.getByLabel('判断依据', { exact: true }).fill('任务尚未执行，无法判定用户作用');
    await page.getByRole('button', { name: '保存评价记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('已有复核', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '问题处理', exact: true }).click();
    await page.getByRole('button', { name: '登记问题', exact: true }).click();
    await page.getByLabel('问题标题', { exact: true }).fill('模型关闭的交付边界核对');
    await page.getByLabel('问题分类', { exact: true }).selectOption('TECHNICAL');
    await page.getByLabel('实际影响', { exact: true }).fill('本次不能取得分析结果');
    await page.getByLabel('需要的下一步', { exact: true }).fill('记录当前限制，保持原任务等待');
    await page.getByRole('button', { name: '保存处理记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '处理或转交', exact: true }).click();
    await page.getByLabel('处理进度', { exact: true }).selectOption('IN_PROGRESS');
    await page.getByRole('checkbox', { name: '由本人接手', exact: true }).check();
    await page.getByLabel('处理依据与仍有影响', { exact: true }).fill('核对部署模式为off，未伪造完成');
    await page.getByRole('button', { name: '保存处理记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '处理或转交', exact: true }).click();
    await page.getByLabel('处理进度', { exact: true }).selectOption('CLOSED');
    await page.getByLabel('结束原因', { exact: true }).selectOption('ACCEPTED_TRADEOFF');
    await page.getByLabel('处理依据与仍有影响', { exact: true }).fill('接受离线验证边界；分析工作仍未完成');
    await page.getByRole('button', { name: '保存处理记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('已结束', { exact: true })).toBeVisible();
    const after = await (
      await context.request.get(root + `/conversations/${original.conversation.id}`)
    ).json();
    assert.equal(after.tasks.find((t: { id: string }) => t.id === task.id).status, 'WAITING_CAPABILITY');
    const samples = await (
      await context.request.get(root + `/evaluation/assets?workspace=${space}&kind=SAMPLE`)
    ).json();
    assert.equal(
      (await platform.context().request.get(root + `/evaluation/assets/${samples.items[0].id}`)).status(),
      403,
    );
    await screenshot(page, 'evaluation-issues-tenant.png');
    if (restart) {
      await restart();
      await page.goto(`/tenant-admin/#tenant=${tenant}`);
      await page.getByRole('button', { name: '方法版本', exact: true }).click();
      await page.getByLabel('方法生效范围', { exact: true }).selectOption(space);
      await expect(page.getByRole('article', { name: '当前采用' })).toContainText('空间采用');
    } else await page.getByRole('button', { name: '方法版本', exact: true }).click();
    if (!restart) await page.getByLabel('方法生效范围', { exact: true }).selectOption(space);
    await page.getByRole('button', { name: '停止本范围采用', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '停止本范围采用', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('article', { name: '当前采用' })).toContainText('内建默认');
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'methods-mobile.png');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // A scoped maintainer enters the same maintenance components without enterprise configuration.
    const governanceRoot = root + '/governance';
    let governance = await (await context.request.get(governanceRoot)).json();
    if (governance.canAcceptInitialResponsibility)
      governance = await post(context.request, governanceRoot + '/accept-initial-responsibility', {
        requestId: randomUUID(),
        expectedVersion: governance.revision,
      });
    const memberEmail = `evaluation-member-${suffix}@example.test`;
    const invited = await post(
      context.request,
      `/api/tenant-admin/v1/tenants/${tenant}/invitations`,
      { requestId: randomUUID(), email: memberEmail },
      201,
    );
    const memberContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await post(memberContext.request, '/api/v1/auth/invitations/accept', {
        token: await invitation(invited.id),
        displayName: '范围评价维护者',
        password,
      });
      await post(memberContext.request, '/api/v1/auth/login', { email: memberEmail, password });
      const memberId = (await (await memberContext.request.get('/api/v1/me')).json()).account.id;
      const shared = await post(
        context.request,
        `/api/tenant-admin/v1/tenants/${tenant}/workspaces`,
        { requestId: randomUUID(), name: '范围评价空间' },
        201,
      );
      await post(
        context.request,
        `/api/tenant-admin/v1/tenants/${tenant}/workspaces/${shared.id}/members/${memberId}`,
        { requestId: randomUUID(), expectedVersion: 0, enabled: true },
      );
      for (const capability of ['EVALUATION_MAINTAIN', 'METHOD_ADOPT']) {
        governance = await (await context.request.get(governanceRoot)).json();
        await post(context.request, governanceRoot + '/capabilities', {
          requestId: randomUUID(),
          expectedVersion: governance.revision,
          accountId: memberId,
          workspaceId: shared.id,
          capability,
          enabled: true,
        });
      }
      const member = await memberContext.newPage();
      member.on('pageerror', (e) => errors.push(e.message));
      await member.goto(`/tenant-admin/#tenant=${tenant}`);
      await expect(member.getByRole('button', { name: '企业配置', exact: true })).toHaveCount(0);
      await member.getByRole('button', { name: '评估与问题', exact: true }).click();
      await expect(member.getByRole('heading', { name: '评价与问题处理', exact: true })).toBeVisible();
      await member.getByLabel('评价范围', { exact: true }).selectOption(shared.id);
      await expect(member.getByRole('button', { name: '新建标准', exact: true })).toBeVisible();
      await member.getByRole('button', { name: '方法版本', exact: true }).click();
      await member.getByLabel('方法生效范围', { exact: true }).selectOption(shared.id);
      await expect(member.getByRole('heading', { name: '方法采用与回退', exact: true })).toBeVisible();
      assert.equal(
        (await memberContext.request.get(`/api/tenant-admin/v1/tenants/${tenant}/overview`)).status(),
        403,
      );
      await screenshot(member, 'evaluation-scoped-maintainer.png');
    } finally {
      await memberContext.close();
    }
    if (retentionArtifacts) {
      const actor = (await (await context.request.get('/api/v1/me')).json()).account.id;
      governance = await (await context.request.get(governanceRoot)).json();
      await post(context.request, governanceRoot + '/capabilities', {
        requestId: randomUUID(),
        expectedVersion: governance.revision,
        accountId: actor,
        workspaceId: null,
        capability: 'TENANT_EXIT',
        enabled: true,
      });
      const shared = await post(
        context.request,
        `/api/tenant-admin/v1/tenants/${tenant}/workspaces`,
        {
          requestId: randomUUID(),
          name: '退出准备合成空间',
        },
        201,
      );
      await post(
        context.request,
        `/api/tenant-admin/v1/tenants/${tenant}/workspaces/${shared.id}/members/${actor}`,
        {
          requestId: randomUUID(),
          expectedVersion: 0,
          enabled: true,
        },
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await retentionJourney(
        page,
        context.request,
        tenant,
        shared.id,
        retentionArtifacts,
        `/tenant-admin/#tenant=${tenant}&manage=retention`,
      );
    }
    assert.deepEqual(errors, []);
    return {
      tenant,
      methodVersion: family.headVersion,
      restartVerified: Boolean(restart),
      checks:
        'real synthetic comparison and release; private real waiting task evidence; separate facts/manual review; issue ownership and explicit outcome; scope adoption/stop; pending navigation guard; platform denied customer evidence',
    };
  } catch (error) {
    await screenshot(page, 'evaluation-failure.png').catch(() => {});
    await screenshot(platform, 'method-failure.png').catch(() => {});
    console.error(
      (
        await page
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 4000),
    );
    console.error(
      (
        await platform
          .locator('body')
          .innerText()
          .catch(() => '')
      ).slice(0, 4000),
    );
    throw error;
  } finally {
    await context.close();
  }
}
// Optional standalone verifier owns a fresh local trial; it never reads another project's credentials.
async function standalone() {
  const cwd = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(join(tmpdir(), 'dreamcore-evaluation-'));
  const artifacts = join(cwd, '.local/evaluation');
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
    const result = await evaluationMethodsJourney(
      page,
      async (id) => JSON.parse(await readFile(join(directory, 'invitations', id + '.json'), 'utf8')).token,
      async (page, name) => {
        await page.screenshot({ path: join(artifacts, name), fullPage: true });
      },
      restart,
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
