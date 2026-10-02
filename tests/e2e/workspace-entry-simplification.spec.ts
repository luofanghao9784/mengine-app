import { test, expect, type Page } from '@playwright/test';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  other = uid(2),
  account = uid(3),
  personal = uid(4),
  shared = uid(5);
const library = `/workspace/#tenant=${tenant}&view=library&scope=personal`;
async function fixture(page: Page, options: { multi?: boolean; admin?: boolean } = {}) {
  const activity: URL[] = [];
  const requests: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let signedIn = true;
  await page.context().route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    requests.push(url);
    const t = path.includes(other) ? other : tenant;
    const admin = options.multi ? t === other : options.admin !== false;
    const memberships = [
      { tenantId: tenant, tenantName: '合成企业甲', role: 'MEMBER' },
      ...(options.multi ? [{ tenantId: other, tenantName: '合成企业乙', role: 'MEMBER' }] : []),
    ];
    let json: unknown;
    if (path === '/api/v1/me' && !signedIn)
      return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
    if (path === '/api/v1/auth/csrf')
      return route.fulfill({ json: { token: 'synthetic', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/v1/auth/logout') {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/v1/me')
      json = {
        account: { id: account, email: null, phone: '+8619900009001', displayName: '合成成员' },
        platformAdmin: false,
        memberships,
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/governance'))
      json = {
        tenantId: t,
        ownerId: null,
        revision: 0,
        owner: false,
        canConfigure: admin,
        canEnterManagement: admin,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: t, name: t === tenant ? '合成企业甲' : '合成企业乙', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [
          { id: personal, name: '个人空间', kind: 'PERSONAL' },
          { id: shared, name: '合成业务空间', kind: 'SHARED' },
        ],
      };
    else if (path.endsWith('/business-status'))
      json = {
        tenantId: t,
        businessEnabled: true,
        canExport: false,
        exitState: null,
        exportDeadline: null,
      };
    else if (path.endsWith('/conversations'))
      json = {
        tenantId: t,
        enabled: true,
        agentMode: 'off',
        publicWebEnabled: false,
        items: [],
        hasMore: false,
      };
    else if (path.endsWith('/library'))
      json = {
        tenantId: t,
        workspaceId: path.match(/workspaces\/([^/]+)/)?.[1] || null,
        folderId: null,
        canMaintain: true,
        maxUploadBytes: 10000,
        trail: [],
        items: [],
        hasMore: false,
      };
    else if (path.endsWith('/activity')) {
      activity.push(url);
      json = { tenantId: t, workspaceId: url.searchParams.get('workspace'), items: [], nextCursor: null };
    } else if (path.endsWith('/overview'))
      json = {
        tenantId: t,
        name: '合成企业甲',
        version: 1,
        activeMemberCount: 1,
        disabledMemberCount: 0,
        sharedWorkspaceCount: 1,
        invitationDelivery: 'DISABLED',
      };
    else if (path.endsWith('/members')) json = [];
    else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    return route.fulfill({ json });
  });
  return { activity, errors, requests };
}

async function expectCurrentEnterprise(page: Page, name: string) {
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '个人设置与账号' }).getByRole('button', { name: new RegExp(name) })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
}

for (const width of [1280, 390]) {
  test(`主线路与企业管理往返保留检索位置，菜单可键盘关闭（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { activity, errors } = await fixture(page);
    await page.goto(library);
    await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link')).toHaveCount(
      3,
    );
    await expect(page.getByRole('button', { name: '更多工作与管理' })).toHaveCount(0);
    await page.getByLabel('搜索资料名称或正文', { exact: true }).fill('保留的检索');
    await page.getByRole('button', { name: '搜索资料', exact: true }).click();
    const trigger = page.getByRole('button', { name: '个人设置与账号', exact: true });
    await trigger.click();
    const menu = page.getByRole('dialog', { name: '个人设置与账号', exact: true });
    const management = menu.getByRole('link', { name: '切换到企业管理端', exact: true });
    expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.local/entry-menu-${width}.png` });
    await management.click();
    await expect(page.getByRole('heading', { name: '企业管理', level: 1, exact: true })).toBeVisible();
    await page.getByRole('link', { name: '返回原工作', exact: true }).click();
    await expect(page.getByLabel('搜索资料名称或正文', { exact: true })).toHaveValue('保留的检索');
    expect(activity).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test('当前企业的管理权限独立判断，切换企业后关闭菜单', async ({ page }) => {
  await fixture(page, { multi: true });
  await page.goto(library);
  await page.getByRole('button', { name: '个人设置与账号' }).click();
  const menu = page.getByRole('dialog', { name: '个人设置与账号' });
  await expect(menu.getByRole('link', { name: '切换到企业管理端' })).toHaveCount(0);
  await menu.getByRole('button', { name: '合成企业乙', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`tenant=${other}`));
  await page.getByRole('button', { name: '个人设置与账号' }).click();
  await expect(menu.getByRole('link', { name: '切换到企业管理端' })).toHaveAttribute(
    'href',
    new RegExp(`tenant=${other}`),
  );
  await menu.getByRole('button', { name: '合成企业甲', exact: true }).click();
  await page.getByRole('button', { name: '个人设置与账号' }).click();
  await expect(menu.getByRole('link', { name: '切换到企业管理端' })).toHaveCount(0);
});

test('旧空间链接进入资料库，资料动态仅按需读取并使用当前共享空间', async ({ page }) => {
  const { activity, errors } = await fixture(page, { admin: false });
  await page.goto(`/workspace/#tenant=${tenant}&view=spaces`);
  await expect(page).toHaveURL(new RegExp(`view=library&scope=enterprise$`));
  await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^当前企业：/ })).toHaveCount(0);
  expect(activity).toHaveLength(0);
  await page.getByRole('button', { name: '资料操作', exact: true }).click();
  await page.getByRole('button', { name: '资料动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无可见动态', exact: true })).toBeVisible();
  expect(activity.at(-1)?.searchParams.has('workspace')).toBe(false);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.goto(`/workspace/#tenant=${tenant}&view=spaces&space=${shared}`);
  await expect(page).toHaveURL(new RegExp(`view=library&scope=${shared}$`));
  await page.getByRole('button', { name: '资料操作', exact: true }).click();
  await page.getByRole('button', { name: '资料动态', exact: true }).click();
  await expect(page.getByRole('heading', { name: '暂无可见动态', exact: true })).toBeVisible();
  expect(activity.at(-1)?.searchParams.get('workspace')).toBe(shared);
  await expect(page.getByRole('combobox', { name: '动态空间范围' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.goto(library);
  await page.getByRole('button', { name: '资料操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '资料动态', exact: true })).toHaveCount(0);
  await page.goto(`/workspace/#tenant=${tenant}&view=spaces&space=${uid(99)}`);
  await expect(page.getByRole('heading', { name: '此位置暂不可用', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 834]) {
  test(`窄屏从资料库切换管理端再回会话，保留未发送草稿（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page);
    await page.goto(library);
    await page.getByRole('link', { name: '会话', exact: true }).click();
    const editor = page.getByLabel('工作要求', { exact: true });
    await editor.fill('尚未发送的合成工作');
    await page.getByRole('link', { name: '资料库', exact: true }).click();
    const trigger = page.getByRole('button', { name: '个人设置与账号' });
    await trigger.click();
    await page
      .getByRole('dialog', { name: '个人设置与账号' })
      .getByRole('link', { name: '切换到企业管理端', exact: true })
      .click();
    await page.getByRole('link', { name: '返回原工作', exact: true }).click();
    await page.getByRole('link', { name: '会话', exact: true }).click();
    await expect(editor).toHaveValue('尚未发送的合成工作');
  });
}

for (const admin of [true, false]) {
  test(`客户端不挂载来源和全局治理面板，旧来源链接也不展开管理功能（${admin ? '管理员' : '普通成员'}）`, async ({
    page,
  }) => {
    const { requests, errors } = await fixture(page, { admin });
    await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=${shared}&source=${uid(9)}`);
    await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '上传资料', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '资料操作', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建文件夹', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '维护与回收站', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '数据来源', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '内容回收与清理', exact: true })).toHaveCount(0);
    expect(requests.filter((u) => /\/(sources|object-lifecycle)(\/|$)/.test(u.pathname))).toHaveLength(0);
    await page.keyboard.press('Escape');
    if (admin) {
      await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
      await page.getByRole('link', { name: '切换到企业管理端', exact: true }).click();
      await expect(page).toHaveURL(/\/tenant-admin\//);
      await expect(page.getByLabel('企业数据来源', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await page.getByRole('button', { name: '内容回收与清理', exact: true }).click();
      await expect(page.getByRole('heading', { name: '内容回收与清理', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('link', { name: '切换到企业管理端' })).toHaveCount(0);
      await page.goto(`/tenant-admin/#tenant=${tenant}`);
      await expect(page.getByRole('heading', { name: '没有访问权限', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '管理工作区' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('迁出旧链接只展示获权记录，办理与撤销操作只在管理端提供', async ({ page }) => {
  const { errors } = await fixture(page);
  const execution = {
    id: uid(10),
    tenantId: tenant,
    kind: 'MEMBER_OFFBOARD',
    targetAccountId: account,
    state: 'ISOLATED',
    revision: 1,
    effectiveAt: '2026-10-01T00:00:00Z',
    deadline: '2027-10-01T00:00:00Z',
    completedAt: null,
    errorCode: null,
  };
  let optionsReads = 0;
  await page.route('**/departures**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/business-status')) return route.fallback();
    if (path.endsWith('/options')) {
      optionsReads++;
      return route.fulfill({
        json: {
          tenantRevision: 1,
          members: [],
          membersHaveMore: false,
          responsibilities: [],
          responsibilitiesHaveMore: false,
          canOffboard: true,
          canExit: true,
        },
      });
    }
    if (path.endsWith('/departures')) return route.fulfill({ json: { items: [execution], hasMore: false } });
    if (path.endsWith(execution.id))
      return route.fulfill({
        json: {
          execution,
          targetName: '合成员工',
          reason: '合成离职记录',
          policyKey: 'OFFBOARD_ISOLATION',
          policyRevision: 1,
          stopComplete: true,
          isolationComplete: true,
          materialsComplete: false,
          objectsComplete: false,
          cancelledAt: null,
          workerAttempts: 0,
          backupState: 'PENDING_VERIFICATION',
          canCancel: true,
          canRetry: true,
          exportGrants: [],
          materialProgress: null,
          coverage: [],
        },
      });
    return route.fallback();
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=departure`);
  await expect(page.getByRole('heading', { name: '迁出与清理记录', level: 2, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /员工离职.*隔离期内/ }).click();
  await expect(page.getByText('合成离职记录', { exact: true })).toBeVisible();
  for (const name of ['办理员工离职', '办理企业退出', '撤销离职并恢复未清理私人内容', '重试执行检查'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(optionsReads).toBe(0);
  await page.goto(`/tenant-admin/#tenant=${tenant}&manage=retention`);
  await expect(page.getByRole('button', { name: '办理员工离职', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '办理企业退出', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /员工离职.*隔离期内/ }).click();
  await expect(page.getByRole('button', { name: '撤销离职并恢复未清理私人内容', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试执行检查', exact: true })).toBeVisible();
  expect(optionsReads).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('两端可另页打开，检索与草稿互不覆盖，管理端也可另页打开客户端', async ({ page }) => {
  await fixture(page);
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await page.getByLabel('工作要求', { exact: true }).fill('客户端独立的未发送草稿');
  await page.getByRole('link', { name: '资料库', exact: true }).click();
  await page.getByLabel('搜索资料名称或正文', { exact: true }).fill('客户端检索');
  await page.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  const open = page.getByRole('link', { name: '在新标签页打开企业管理端', exact: true });
  await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  const [management] = await Promise.all([page.context().waitForEvent('page'), open.click()]);
  await expect(management.getByRole('heading', { name: '企业管理', level: 1, exact: true })).toBeVisible();
  expect(await management.evaluate(() => window.opener === null)).toBe(true);
  await expect(page).toHaveURL(new RegExp('/workspace/.*view=library'));
  await expect(page.getByLabel('搜索资料名称或正文', { exact: true })).toHaveValue('客户端检索');
  await management.getByLabel('搜索姓名或手机号', { exact: true }).fill('管理端未提交检索');
  const [secondClient] = await Promise.all([
    page.context().waitForEvent('page'),
    management.getByRole('link', { name: '在新标签页打开客户端', exact: true }).click(),
  ]);
  await expect(secondClient.getByLabel('搜索资料名称或正文', { exact: true })).toHaveValue('');
  await secondClient.getByLabel('搜索资料名称或正文', { exact: true }).fill('另一标签页检索');
  await management.bringToFront();
  await expect(management.getByLabel('搜索姓名或手机号', { exact: true })).toHaveValue('管理端未提交检索');
  await page.bringToFront();
  await expect(page.getByLabel('搜索资料名称或正文', { exact: true })).toHaveValue('客户端检索');
  await management.getByRole('button', { name: '企业设置', exact: true }).click();
  await management.getByRole('button', { name: '修改名称', exact: true }).click();
  await management.getByLabel('企业名称', { exact: true }).fill('管理端尚未保存的名称');
  await page.bringToFront();
  await page.getByRole('link', { name: '会话', exact: true }).click();
  await expect(page.getByLabel('工作要求', { exact: true })).toHaveValue('客户端独立的未发送草稿');
  await management.bringToFront();
  await expect(management.getByLabel('企业名称', { exact: true })).toHaveValue('管理端尚未保存的名称');
  await management.close();
  await secondClient.close();
});

test('最近企业按端和标签页保存，另一端切换企业不改变无企业参数的原页面', async ({ page }) => {
  await fixture(page, { multi: true });
  await page.goto(library);
  const management = await page.context().newPage();
  await management.goto(`/tenant-admin/#tenant=${other}`);
  await expect(management.getByRole('heading', { name: '企业管理', level: 1, exact: true })).toBeVisible();
  await page.goto('/workspace/#view=library');
  await expectCurrentEnterprise(page, '合成企业甲');
  await page.goto(`/tenant-admin/#tenant=${other}`);
  await expect(page.getByRole('heading', { name: '企业管理', level: 1, exact: true })).toBeVisible();
  await page.goto('/workspace/#view=library');
  await expectCurrentEnterprise(page, '合成企业甲');
  await management.goto(`/workspace/#tenant=${other}&view=library`);
  await page.reload();
  await expectCurrentEnterprise(page, '合成企业甲');
  await expectCurrentEnterprise(management, '合成企业乙');
  await management.close();
});

test('共用登录状态，一端退出后其他标签页同步退出', async ({ page }) => {
  await fixture(page);
  await page.goto(library);
  const management = await page.context().newPage();
  await management.goto(`/tenant-admin/#tenant=${tenant}`);
  await expect(management.getByRole('heading', { name: '企业管理', level: 1, exact: true })).toBeVisible();
  await management.getByRole('button', { name: '个人设置与账号', exact: true }).click();
  await management.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(management.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录梦擎工作空间', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toHaveCount(0);
  await management.close();
});
