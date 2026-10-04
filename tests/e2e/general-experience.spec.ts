import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2),
  entry = id(3),
  version = id(4);
const method = {
  title: '核验实际执行记录',
  summary: '合成通用方法摘要',
  steps: ['查看工具回执，再核对业务依据。'],
  applicable: ['存在固定执行记录'],
  excluded: ['缺少依据时不能推断成功'],
  tags: ['核对'],
  basis: 'OBSERVED_EXECUTION',
};
async function fixture(context: BrowserContext, options: { canManage?: boolean; dropFirst?: boolean } = {}) {
  let enabled = true,
    revision = 0;
  const changes: Record<string, unknown>[] = [];
  let receipt: unknown;
  let revoked = false;
  const calls: string[] = [];
  const mutations: string[] = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    calls.push(path + url.search);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/auth/me'))
      return json({
        account: { id: actor, email: 'platform@synthetic.test', displayName: '合成平台人员' },
        platformAdmin: true,
        memberships: [],
      });
    if (path === '/api/v1/me')
      return json({
        account: { id: actor, email: 'customer@synthetic.test', displayName: '合成企业人员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: actor,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [],
      });
    if (path.endsWith('/experience-library') && path.startsWith('/api/v1/'))
      return json({ scopes: [], items: [], hasMore: false });
    if (path.endsWith('/usage')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        changes.push(body);
        if (changes.length === 1 || body.requestId !== changes[changes.length - 2].requestId) {
          enabled = body.enabled;
          revision++;
          receipt = { requestId: body.requestId, entryId: entry, versionId: version, enabled, revision };
        }
        if (options.dropFirst && changes.length === 1) return route.abort('failed');
        return json(receipt);
      }
      return revoked
        ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404)
        : json({
            entryId: entry,
            versionId: version,
            enabled,
            revision,
            canManage: options.canManage !== false,
          });
    }
    if (path.includes('experience-library') || path.includes('general-experiences')) {
      if (path.endsWith('/processing'))
        return json({
          enabled: false,
          counts: {
            WAITING: 3,
            PROCESSING: 1,
            RETRYING: 2,
            ADMITTED: 9,
            DUPLICATE: 4,
            NOT_ADMITTED: 2,
            UNAVAILABLE: 1,
            FAILED: 1,
            UNKNOWN: 2,
          },
          available: 1,
          stopped: 0,
          withdrawn: 1,
          checkedAt: '2026-10-04T00:00:00Z',
        });
      const state = url.searchParams.get('state') || 'AVAILABLE';
      const row = {
        id: entry,
        versionId: version,
        number: 1,
        status: path.includes('general-experiences') ? 'AVAILABLE' : state,
        updatedAt: '2026-10-04T00:00:00Z',
      };
      if (path.endsWith('/' + entry))
        return revoked
          ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404)
          : json({ ...row, method });
      return json({
        items:
          revoked || (path.includes('general-experiences') && (state === 'AVAILABLE') !== enabled)
            ? []
            : [{ ...row, title: method.title, summary: method.summary, tags: method.tags }],
        hasMore: url.searchParams.get('offset') !== '20',
      });
    }
    return json({ code: 'UNAVAILABLE' }, 404);
  });
  return {
    calls,
    mutations,
    changes,
    revoke: () => {
      revoked = true;
    },
  };
}
for (const realm of ['platform', 'tenant'] as const)
  test(`${realm} general library has fixed-version drawer, pagination, revocation and separate routes`, async ({
    page,
    context,
  }) => {
    const f = await fixture(context);
    await page.goto(
      realm === 'platform'
        ? '/platform-admin/#admin=experience'
        : `/tenant-admin/#tenant=${tenant}&admin=experience`,
    );
    if (realm === 'tenant') await page.getByLabel('经验来源').selectOption('general');
    await page.getByLabel('搜索通用经验').fill('核验');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('第 2 页')).toBeVisible();
    if (realm === 'platform')
      await page.screenshot({ path: 'test-results/general-platform-content.png', fullPage: true });
    await page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: method.title }) })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(method.steps[0])).toBeVisible();
    expect(f.calls.some((c) => c.includes(`/${entry}?version=${version}`))).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(method.steps[0]);
    await page.setViewportSize({ width: 360, height: 900 });
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/general-${realm}-drawer.png`, fullPage: true });
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await expect(page.getByText('第 2 页')).toBeVisible();
    await expect(page.getByLabel('搜索通用经验')).toHaveValue('核验');
    await page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: method.title }) })
      .click();
    await expect(dialog.getByText(method.steps[0])).toBeVisible();
    f.revoke();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByText(method.steps[0])).toHaveCount(0);
    await expect(dialog.getByText('暂时无法读取')).toBeVisible();
    expect(f.mutations).toEqual([]);
    if (realm === 'platform') {
      expect(f.calls.every((c) => c.startsWith('/api/platform-admin/'))).toBe(true);
      await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
    } else expect(f.calls.every((c) => !c.startsWith('/api/platform-admin/'))).toBe(true);
  });
test('platform accumulation shows processing totals separately from current assets with no review actions', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto('/platform-admin/#admin=experience');
  await page.getByRole('tab', { name: '积累与改进' }).click();
  await expect(page.getByText('自动上送尚未启用，以下保留已有处理记录。')).toBeVisible();
  await expect(
    page.getByText('以下按已登记的贡献来源计数；入库次数不等于当前经验数量，也不代表使用效果。'),
  ).toBeVisible();
  await expect(page.getByText('结果未确认', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /审核|批准|驳回|分派|人工处理/ })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 1100 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/general-platform-processing.png', fullPage: true });
  await page.getByRole('tab', { name: '经验内容' }).click();
  await expect(page.getByRole('heading', { name: method.title })).toBeVisible();
  expect(f.mutations).toEqual([]);
});

test('an enterprise experience deep link overrides a remembered general-library source', async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=experience`);
  await page.getByLabel('经验来源').selectOption('general');
  await expect(page.getByLabel('搜索通用经验')).toBeVisible();
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=experience&scope=${id(8)}&experience=${entry}`);
  await expect(page.getByLabel('经验来源')).toHaveValue('enterprise');
  await expect(page.getByRole('heading', { name: '经验详情', exact: true })).toBeVisible();
});

async function openTenantMethod(page: import('@playwright/test').Page) {
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=experience`);
  await page.getByLabel('经验来源').selectOption('general');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
}
test('enterprise stop and restore stay inside the fixed-version drawer and preserve scope', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await openTenantMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '停止本企业使用', exact: true }).click();
  await expect(
    dialog.getByText(
      '停止本企业后续检索与采用，正在引用此经验的任务需重新执行。已完成结果保留，其他企业不受影响。',
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '确认停用' }).click();
  await expect(dialog.getByText('本企业：已停止使用')).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByLabel('通用经验状态').selectOption('STOPPED');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
  await expect(dialog.getByRole('button', { name: '恢复本企业使用' })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 1000 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/general-tenant-use-control.png', fullPage: true });
  await dialog.getByRole('button', { name: '恢复本企业使用' }).click();
  await dialog.getByRole('button', { name: '确认恢复' }).click();
  await expect(dialog.getByText('本企业：可供引擎参考')).toBeVisible();
  expect(f.changes.map((c) => [c.enabled, c.expectedRevision, c.versionId])).toEqual([
    [false, 0, version],
    [true, 1, version],
  ]);
  expect(f.calls.every((c) => !c.startsWith('/api/platform-admin/'))).toBe(true);
});
test('lost response retains the original request and locks source and drawer navigation', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { dropFirst: true });
  await openTenantMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '停止本企业使用', exact: true }).click();
  await dialog.getByRole('button', { name: '确认停用' }).click();
  await expect(dialog.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await expect(page.getByLabel('经验来源')).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await dialog.getByRole('button', { name: '重试原请求' }).click();
  await expect(dialog.getByText('本企业：已停止使用')).toBeVisible();
  expect(f.changes).toHaveLength(2);
  expect(f.changes[0]).toEqual(f.changes[1]);
  await expect(page.getByLabel('经验来源')).toBeEnabled();
});
test('space maintainer sees enterprise use status without enterprise-wide mutation controls', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { canManage: false });
  await openTenantMethod(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('企业负责人或管理员可调整本企业使用状态。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /停止本企业使用|恢复本企业使用/ })).toHaveCount(0);
  expect(f.mutations).toEqual([]);
});
