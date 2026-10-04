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
async function fixture(
  context: BrowserContext,
  options: {
    canManage?: boolean;
    dropFirst?: boolean;
    dropPlatformFirst?: boolean;
    denyPlatformMutation?: boolean;
    dropSuggestionFirst?: boolean;
    dropAdjustmentFirst?: boolean;
    denyAdjustment?: boolean;
    noSuggestionScope?: boolean;
  } = {},
) {
  let enabled = true,
    revision = 0;
  const changes: Record<string, unknown>[] = [];
  let receipt: unknown;
  let globalStatus = 'AVAILABLE',
    globalRevision = 1,
    globalReason: string | null = null;
  const globalChanges: Record<string, unknown>[] = [];
  const globalRecords: unknown[] = [];
  let globalReceipt: unknown;
  let revoked = false;
  const suggestionChanges: Record<string, unknown>[] = [];
  const adjustmentChanges: Record<string, unknown>[] = [],
    adjustments: Record<string, unknown>[] = [];
  let currentVersion = version;
  const suggestions: Record<string, unknown>[] = [];
  let suggestionScope = !options.noSuggestionScope;
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
    if (path === '/api/platform-admin/v1/records') return json(globalRecords);
    if (path.endsWith('/availability')) {
      if (route.request().method() === 'POST') {
        if (options.denyPlatformMutation) return json({ contractVersion: '1.0', code: 'ACCESS_DENIED' }, 403);
        const body = route.request().postDataJSON();
        globalChanges.push(body);
        if (
          globalChanges.length === 1 ||
          body.requestId !== globalChanges[globalChanges.length - 2].requestId
        ) {
          globalStatus = body.status;
          globalReason = body.reason;
          globalRevision++;
          globalReceipt = {
            requestId: body.requestId,
            entryId: entry,
            versionId: currentVersion,
            status: globalStatus,
            revision: globalRevision,
          };
          globalRecords.unshift({
            id: globalRevision,
            category: 'EXPERIENCE',
            action: globalStatus === 'STOPPED' ? 'GENERAL_EXPERIENCE_STOP' : 'GENERAL_EXPERIENCE_RESTORE',
            outcome: 'SUCCESS',
            actorId: actor,
            actorName: '合成平台人员',
            targetId: id(50 + globalRevision),
            targetName: method.title + ' · v1',
            tenantId: null,
            tenantName: null,
            createdAt: '2026-10-04T00:00:00Z',
            internalReason: body.reason,
            publicReason: null,
          });
        }
        if (options.dropPlatformFirst && globalChanges.length === 1) return route.abort('failed');
        return json(globalReceipt);
      }
      return revoked
        ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404)
        : json({
            entryId: entry,
            versionId: currentVersion,
            status: globalStatus,
            revision: globalRevision,
            reason: globalReason,
            changedAt: '2026-10-04T00:00:00Z',
          });
    }
    if (path.includes('/platform-admin/') && path.endsWith('/adjustments')) {
      if (revoked || (options.denyAdjustment && route.request().method() === 'POST'))
        return json({ code: 'ACCESS_DENIED' }, 403);
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        adjustmentChanges.push(body);
        if (!adjustments.length)
          adjustments.push({
            id: id(60),
            versionId: body.versionId,
            state: 'QUEUED',
            resultVersionId: null,
            createdAt: '2026-10-04T00:00:00Z',
          });
        if (options.dropAdjustmentFirst && adjustmentChanges.length === 1) return route.abort('failed');
        return json(adjustments[0]);
      }
      return json({
        enabled: true,
        canSubmit:
          globalStatus === 'AVAILABLE' &&
          url.searchParams.get('version') === currentVersion &&
          adjustments.every((a) => a.state === 'ADMITTED'),
        revision: globalRevision,
        currentVersionId: currentVersion,
        items: adjustments,
      });
    }
    if (path.endsWith('/suggestions')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        suggestionChanges.push(body);
        if (!suggestions.length)
          suggestions.push({
            id: id(30),
            versionId: body.versionId,
            workspaceId: body.workspaceId,
            intent: body.intent,
            state: 'WAITING',
            resultEntryId: null,
            resultVersionId: null,
            createdAt: '2026-10-04T00:00:00Z',
          });
        if (options.dropSuggestionFirst && suggestionChanges.length === 1) return route.abort('failed');
        return json(suggestions[0]);
      }
      return json({
        enabled: true,
        canSubmit: enabled && suggestionScope,
        scopes: suggestionScope ? [{ id: id(20), name: '合成业务空间' }] : [],
        items: suggestions,
      });
    }
    if (path.endsWith('/general-references'))
      return json({
        entryId: id(31),
        versionId: id(32),
        canReference: enabled,
        items: [
          {
            entryId: entry,
            versionId: version,
            number: 1,
            title: method.title,
            current: true,
            useState: enabled ? 'AVAILABLE' : 'TENANT_STOPPED',
          },
        ],
        hasMore: false,
      });
    if (path.includes('/experiences/')) {
      if (path.endsWith('/adjustments')) return json({ enabled: true, items: [] });
      if (path.endsWith('/history'))
        return json({
          items: [
            {
              id: id(32),
              number: 1,
              origin: 'AUTOMATIC',
              evaluation: 'AUTOMATIC_CHECKED',
              createdAt: '2026-10-04T00:00:00Z',
              current: true,
            },
          ],
          hasMore: false,
        });
      return json({
        id: id(31),
        tenantId: tenant,
        workspaceId: id(20),
        revision: 2,
        status: 'PUBLISHED',
        latestNumber: 1,
        publishedVersion: id(32),
        canMaintain: true,
        canRestore: false,
        version: {
          id: id(32),
          number: 1,
          schemaVersion: 1,
          content: {
            kind: 'METHOD',
            title: '企业核对补充',
            summary: '合成企业补充摘要',
            body: '合成企业专用方法',
            tags: ['核对'],
            applicable: '有依据',
            excluded: '无依据不使用',
            dependencies: '',
            basis: '自动核验',
            accessMode: 'SOURCE_BOUND',
          },
          evidence: [],
          origin: 'AUTOMATIC',
          evaluation: 'AUTOMATIC_CHECKED',
          createdBy: actor,
          createdAt: '2026-10-04T00:00:00Z',
        },
      });
    }
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
        versionId: currentVersion,
        number: currentVersion === version ? 1 : 2,
        status: globalStatus,
        updatedAt: '2026-10-04T00:00:00Z',
      };
      if (path.endsWith('/' + entry))
        return revoked || (path.includes('general-experiences') && globalStatus === 'STOPPED')
          ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404)
          : json({ ...row, method });
      return json({
        items:
          revoked ||
          (path.includes('general-experiences')
            ? globalStatus === 'STOPPED' || (state === 'AVAILABLE') !== enabled
            : state !== globalStatus)
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
    globalChanges,
    suggestionChanges,
    adjustmentChanges,
    admitAdjustment: () => {
      currentVersion = id(61);
      globalRevision++;
      Object.assign(adjustments[0], { state: 'ADMITTED', resultVersionId: currentVersion });
    },
    loseSuggestionScope: () => {
      suggestionScope = false;
    },
    admitSuggestion: () => {
      if (suggestions.length)
        Object.assign(suggestions[0], { state: 'ADMITTED', resultEntryId: id(31), resultVersionId: id(32) });
    },
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

async function openPlatformMethod(page: import('@playwright/test').Page) {
  await page.goto('/platform-admin/#admin=experience');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
}
test('platform stop and restore require reason, retain fixed version and appear in platform records', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '停用通用经验', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确认停用' })).toBeDisabled();
  await expect(
    dialog.getByText('停止所有企业后续检索与采用，正在引用此经验的任务需重新执行。已完成结果保留。'),
  ).toBeVisible();
  await dialog.getByLabel('操作原因').fill('合成适用范围需要收敛');
  await page.setViewportSize({ width: 360, height: 1000 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/general-platform-stop.png', fullPage: true });
  await dialog.getByRole('button', { name: '确认停用' }).click();
  await expect(dialog.getByRole('button', { name: '恢复通用经验', exact: true })).toBeVisible();
  await expect(dialog.getByText('最近操作原因：合成适用范围需要收敛')).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByLabel('通用经验状态').selectOption('STOPPED');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
  await dialog.getByRole('button', { name: '恢复通用经验', exact: true }).click();
  await expect(
    dialog.getByText('恢复当前发布版本供后续任务参考。企业自行停用的状态保持，旧任务不会自动恢复。'),
  ).toBeVisible();
  await dialog.getByLabel('操作原因').fill('合成验证已完成');
  await dialog.getByRole('button', { name: '确认恢复' }).click();
  await expect(dialog.getByRole('button', { name: '停用通用经验', exact: true })).toBeVisible();
  expect(f.globalChanges.map((c) => [c.status, c.expectedRevision, c.versionId])).toEqual([
    ['STOPPED', 1, version],
    ['AVAILABLE', 2, version],
  ]);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('合成验证已完成');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.goto('/platform-admin/#admin=settings&section=records');
  await page.getByLabel('操作类别').selectOption('EXPERIENCE');
  await expect(page.getByText(method.title + ' · v1')).toHaveCount(2);
  await expect(page.getByText('内部备注：合成适用范围需要收敛')).toBeVisible();
  await expect(page.getByText('内部备注：合成验证已完成')).toBeVisible();
  expect(f.calls.every((c) => c.startsWith('/api/platform-admin/'))).toBe(true);
});
test('platform lost response retains exact reason and disables tabs until original request is reconciled', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { dropPlatformFirst: true });
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '停用通用经验', exact: true }).click();
  await dialog.getByLabel('操作原因').fill('合成原始原因');
  await dialog.getByRole('button', { name: '确认停用' }).click();
  await expect(dialog.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await expect(dialog.getByLabel('操作原因')).toBeDisabled();
  await expect(page.getByRole('tab', { name: '积累与改进' })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await dialog.getByRole('button', { name: '重试原请求' }).click();
  await expect(dialog.getByRole('button', { name: '恢复通用经验', exact: true })).toBeVisible();
  expect(f.globalChanges).toHaveLength(2);
  expect(f.globalChanges[0]).toEqual(f.globalChanges[1]);
  await expect(page.getByRole('tab', { name: '积累与改进' })).toBeEnabled();
});
test('platform permission loss during mutation removes method and reason form from the drawer', async ({
  page,
  context,
}) => {
  await fixture(context, { denyPlatformMutation: true });
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '停用通用经验', exact: true }).click();
  await dialog.getByLabel('操作原因').fill('合成暂存原因');
  await dialog.getByRole('button', { name: '确认停用' }).click();
  await expect(dialog.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(dialog.getByText(method.steps[0])).toHaveCount(0);
  await expect(dialog.getByLabel('操作原因')).toHaveCount(0);
});

test('enterprise supplement submits a fixed private input, locks an uncertain request and opens the qualified local version', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { dropSuggestionFirst: true });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=experience`);
  await page.getByLabel('经验来源').selectOption('general');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
  await page.getByRole('button', { name: '补充或反馈', exact: true }).click();
  await expect(page.getByLabel('目标空间')).toHaveValue('');
  await page.getByLabel('目标空间').selectOption(id(20));
  await page.getByLabel('内容与依据').fill('private-human-proposal 核对覆盖期间');
  await page.setViewportSize({ width: 360, height: 980 });
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/general-enterprise-suggestion.png', fullPage: true });
  await page.getByRole('button', { name: '提交自动处理', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试原请求', exact: true })).toBeVisible();
  await expect(page.getByLabel('内容与依据')).toBeDisabled();
  await expect(page.getByLabel('经验来源')).toBeDisabled();
  await expect(page.getByRole('button', { name: '停止本企业使用', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '重试原请求', exact: true }).click();
  await expect(page.getByText('等待处理', { exact: true })).toBeVisible();
  expect(f.suggestionChanges).toHaveLength(2);
  expect(f.suggestionChanges[0]).toEqual(f.suggestionChanges[1]);
  expect(f.suggestionChanges[0]).toMatchObject({
    versionId: version,
    workspaceId: id(20),
    intent: 'ADAPTATION',
  });
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('private-human-proposal');
  f.admitSuggestion();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: '查看企业经验', exact: true }).click();
  await expect(page.getByLabel('经验来源')).toHaveValue('enterprise');
  await expect(page.getByText('合成企业专用方法', { exact: true })).toBeVisible();
  expect(f.calls.some((c) => c.includes(`/experiences/${id(31)}?version=${id(32)}`))).toBe(true);
});
test('workspace permission removal clears the unsent proposal and platform never shows enterprise submission controls', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=experience`);
  await page.getByLabel('经验来源').selectOption('general');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
  await page.getByRole('button', { name: '补充或反馈', exact: true }).click();
  await page.getByLabel('目标空间').selectOption(id(20));
  await page.getByLabel('内容与依据').fill('待提交的私有补充');
  f.loseSuggestionScope();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('内容与依据')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '补充或反馈', exact: true })).toHaveCount(0);
  expect(f.suggestionChanges).toHaveLength(0);
  await page.goto('/platform-admin/#admin=experience');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: method.title }) })
    .click();
  await expect(page.getByText(method.steps[0], { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '企业补充与反馈' })).toHaveCount(0);
});

test('platform correction stays in the drawer and only a published result opens a new fixed version', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '提出内容调整' }).click();
  await dialog.getByLabel('调整建议与依据').fill('私有调整建议示例：增加适用范围核对。');
  await page.setViewportSize({ width: 360, height: 1000 });
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/platform-experience-adjustment-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: '提交自动核验' }).click();
  await expect(dialog.getByText('等待核验', { exact: true })).toBeVisible();
  expect(f.adjustmentChanges).toHaveLength(1);
  expect(f.adjustmentChanges[0].versionId).toBe(version);
  expect(f.adjustmentChanges[0].expectedRevision).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(
    '私有调整建议示例',
  );
  f.admitAdjustment();
  await dialog.getByRole('button', { name: '刷新调整状态' }).click();
  await expect(dialog.getByText('v2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('已发布新版本', { exact: true })).toBeVisible();
  expect(f.calls).toContain(`/api/platform-admin/v1/experience-library/${entry}?version=${id(61)}`);
  expect(f.calls.some((p) => p.startsWith('/api/v1/'))).toBe(false);
});
test('platform correction lost response retains original key and locks sibling controls until resolved', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { dropAdjustmentFirst: true });
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '提出内容调整' }).click();
  await dialog.getByLabel('调整建议与依据').fill('合成需要核验的调整');
  await dialog.getByRole('button', { name: '提交自动核验' }).click();
  await expect(dialog.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await expect(dialog.getByLabel('调整建议与依据')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '刷新调整状态' })).toBeDisabled();
  await expect(dialog.getByRole('region', { name: '总库使用状态' }).getByRole('button')).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '重试原请求' }).click();
  await expect(dialog.getByText('等待核验', { exact: true })).toBeVisible();
  expect(f.adjustmentChanges).toHaveLength(2);
  expect(f.adjustmentChanges[0]).toEqual(f.adjustmentChanges[1]);
});
test('loss of platform rights clears adjustment form and cleaned method content', async ({
  page,
  context,
}) => {
  await fixture(context, { denyAdjustment: true });
  await openPlatformMethod(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '提出内容调整' }).click();
  await dialog.getByLabel('调整建议与依据').fill('失权后不可保留的调整');
  await dialog.getByRole('button', { name: '提交自动核验' }).click();
  await expect(dialog.getByLabel('调整建议与依据')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: method.title })).toHaveCount(0);
});
