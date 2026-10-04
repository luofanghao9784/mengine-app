import { test, expect, type BrowserContext } from '@playwright/test';
import type { CompanyChange, CompanyInformation } from '../../src/profile/company-client';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  date = '2026-10-04T00:00:00Z';
async function fixture(
  context: BrowserContext,
  options: { limited?: boolean; reader?: boolean; lost?: boolean } = {},
) {
  let revoked = false,
    sequence = 10;
  const posts: CompanyChange[] = [];
  const receipts = new Map<string, unknown>();
  const info: CompanyInformation = {
    tenantId: tenant,
    canMaintain: !options.reader,
    groups: ['NAME', 'INDUSTRY', 'BUSINESS', 'TERM'].map((field) => ({
      field: field as CompanyChange['field'],
      revision: field === 'BUSINESS' ? 1 : 0,
      manuallyCleared: false,
      tags:
        field === 'BUSINESS'
          ? [
              {
                id: id(9),
                revision: 1,
                label: '合成业务',
                meaning: '',
                origin: 'HUMAN',
                humanProtected: true,
                updatedAt: date,
              },
            ]
          : [],
    })),
  };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理人员' },
        platformAdmin: false,
        memberships: [
          { tenantId: tenant, tenantName: '合成企业', role: options.limited ? 'MEMBER' : 'TENANT_ADMIN' },
        ],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: !options.limited,
        canConfigure: !options.limited,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: options.limited ? [{ capability: 'PROFILE_MAINTAIN', workspaceId: null }] : [],
      });
    if (path === `/api/v1/tenants/${tenant}/context`)
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: options.limited ? 'MEMBER' : 'TENANT_ADMIN',
        workspaces: [],
      });
    if (path.endsWith('/company-information/analysis'))
      return json({ state: 'IDLE', pending: 0, running: 0, attention: 0, lastCompletedAt: null });
    if (path.endsWith('/company-information/suggestions')) return json([]);
    if (path.endsWith('/company-information')) {
      if (revoked) return json({ contractVersion: '1.0', code: 'TENANT_ACCESS_DENIED' }, 403);
      if (route.request().method() === 'GET') return json(info);
      const body: CompanyChange = route.request().postDataJSON();
      posts.push(body);
      if (receipts.has(body.requestId)) return json(receipts.get(body.requestId));
      const group = info.groups.find((g) => g.field === body.field)!;
      if (body.expectedRevision !== group.revision)
        return json({ contractVersion: '1.0', code: 'PROFILE_VERSION_CONFLICT' }, 409);
      let tagId = body.tagId;
      if (body.action === 'ADD') {
        tagId = id(sequence++);
        group.tags.push({
          id: tagId,
          revision: 1,
          label: body.label,
          meaning: body.meaning,
          origin: 'HUMAN',
          humanProtected: true,
          updatedAt: date,
        });
      } else if (body.action === 'EDIT') {
        const tag = group.tags.find((t) => t.id === body.tagId)!;
        Object.assign(tag, { label: body.label, meaning: body.meaning, revision: tag.revision + 1 });
      } else if (body.action === 'REMOVE') group.tags = group.tags.filter((t) => t.id !== body.tagId);
      else group.tags = [];
      group.manuallyCleared = body.action === 'CLEAR';
      const receipt = {
        requestId: body.requestId,
        field: body.field,
        revision: ++group.revision,
        action: body.action,
        tagId,
      };
      receipts.set(body.requestId, receipt);
      // Simulate a committed write whose response was lost, not an unexecuted request.
      if (options.lost && posts.length === 1) return route.abort('failed');
      return json(receipt);
    }
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    posts,
    info,
    revoke: () => {
      revoked = true;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=company`;
test('automatic status refreshes without discarding an open manual edit', async ({ page, context }) => {
  const fixtureState = await fixture(context);
  let completed = false;
  await context.route('**/company-information/analysis', (route) =>
    route.fulfill({
      json: {
        state: completed ? 'IDLE' : 'PROCESSING',
        pending: 0,
        running: completed ? 0 : 1,
        attention: 0,
        lastCompletedAt: completed ? date : null,
      },
    }),
  );
  await page.clock.install();
  await page.goto(start);
  await expect(page.locator('.company-analysis')).toContainText('正在自动整理');
  await page.getByRole('button', { name: '合成业务', exact: true }).click();
  await page.getByLabel('标签名称').fill('尚未提交的人工调整');
  completed = true;
  fixtureState.info.groups.find((g) => g.field === 'BUSINESS')!.tags[0].label = '已自动更新的业务';
  await page.clock.fastForward(31000);
  await expect(page.getByLabel('标签名称')).toHaveValue('尚未提交的人工调整');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.clock.fastForward(31000);
  await expect(page.locator('.company-analysis')).toContainText('最近完成');
  await expect(page.getByRole('button', { name: '已自动更新的业务', exact: true })).toBeVisible();
  expect(fixtureState.posts).toHaveLength(0);
});
test('optional tags support committed-response retry, edit, remove and clear without changing tenant identity', async ({
  page,
  context,
}) => {
  const state = await fixture(context, { lost: true });
  await page.goto(start);
  await expect(page.getByRole('heading', { name: '企业背景信息' })).toBeVisible();
  await expect(page.getByText('尚未填写，不影响使用。')).toHaveCount(3);
  await page.getByRole('button', { name: '填写名称' }).click();
  await page.getByRole('textbox', { name: '企业名称', exact: true }).fill('合成品牌');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试同一次操作' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '企业名称', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试同一次操作' }).click();
  await expect(page.getByRole('button', { name: '合成品牌', exact: true })).toBeVisible();
  expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.info.groups[0].tags).toHaveLength(1);
  await page.getByRole('button', { name: '合成品牌', exact: true }).click();
  await page.getByRole('textbox', { name: '企业名称', exact: true }).fill('合成品牌二');
  await page.getByRole('button', { name: '保存调整' }).click();
  await page.getByRole('button', { name: '合成品牌二', exact: true }).click();
  await page.getByRole('button', { name: '移除标签' }).click();
  await page.getByRole('button', { name: '确认移除' }).click();
  await expect(page.getByRole('button', { name: '填写名称' })).toBeVisible();
  const business = page
    .locator('.company-group')
    .filter({ has: page.getByRole('heading', { name: '主营业务' }) });
  await business.getByRole('button', { name: '清空此项' }).click();
  await page.getByRole('button', { name: '确认清空' }).click();
  await expect(business.getByText('已由人工清空，保持为空。')).toBeVisible();
  expect(state.posts.map((p) => p.action)).toEqual(['ADD', 'ADD', 'EDIT', 'REMOVE', 'CLEAR']);
  await expect(page.getByRole('complementary', { name: '企业管理导航' })).toContainText('合成企业');
});
test('delegated company maintainer has a usable page and narrow layout without configuration links', async ({
  page,
  context,
}) => {
  await fixture(context, { limited: true });
  await page.goto(start + '&detail=records');
  await expect(page.getByRole('heading', { name: '企业背景信息' })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理记录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '保留与退出', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '企业信息', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/admin-company/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/admin-company/mobile.png', fullPage: true });
  const terms = page
    .locator('.company-group')
    .filter({ has: page.getByRole('heading', { name: '业务术语' }) });
  await terms.getByRole('button', { name: '添加标签' }).click();
  await page.getByLabel('标签名称').fill('转化率');
  await page.getByLabel('含义（选填）').fill('合成口径说明');
  await page.screenshot({ path: '.local/admin-company/mobile-editor.png', fullPage: true });
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(terms.getByRole('button', { name: '转化率', exact: true })).toBeVisible();
});
test('read-only details have no mutation and revocation removes displayed content', async ({
  page,
  context,
}) => {
  const state = await fixture(context, { reader: true });
  await page.goto(start);
  await page.getByRole('button', { name: '合成业务', exact: true }).click();
  await expect(page.getByLabel('标签名称')).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存调整' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '移除标签' })).toHaveCount(0);
  state.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('合成业务', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '没有访问权限' })).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test('suggestion comparison keeps the same KEEP request after response loss and hides revoked evidence', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  let available = true,
    completed = false;
  const choices: Record<string, unknown>[] = [];
  const suggestion = {
    id: id(40),
    revision: 1,
    field: 'BUSINESS',
    targetId: id(9),
    label: '篮球培训',
    meaning: '',
    createdAt: date,
    evidence: [
      {
        chunkId: id(41),
        versionId: id(42),
        filename: '合成企业介绍.txt',
        locator: '第1段',
        quote: '主营篮球培训。',
      },
    ],
  };
  await context.route('**/company-information/suggestions**', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: available && !completed ? [suggestion] : [] });
    const body = route.request().postDataJSON();
    choices.push(body);
    completed = true;
    state.info.groups.find((g) => g.field === 'BUSINESS')!.revision = 2;
    if (choices.length === 1) return route.abort('failed');
    return route.fulfill({
      json: { requestId: body.requestId, suggestionId: suggestion.id, action: body.action, revision: 2 },
    });
  });
  await page.goto(start);
  await page.getByRole('button', { name: '主营业务 · 篮球培训', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('合成业务');
  await expect(page.getByRole('dialog')).toContainText('篮球培训');
  await page.getByText('查看依据', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('主营篮球培训。');
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/admin-company/mobile-suggestion.png', fullPage: true });
  await page.getByRole('button', { name: '保留当前', exact: true }).click();
  await page.getByRole('button', { name: '重试同一次操作', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(choices).toHaveLength(2);
  expect(choices[0]).toEqual(choices[1]);
  expect(choices[1].action).toBe('KEEP');
  await expect(page.getByRole('button', { name: '合成业务', exact: true })).toBeVisible();
  completed = false;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '主营业务 · 篮球培训', exact: true }).click();
  available = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('主营篮球培训。', { exact: true })).toHaveCount(0);
});

test('source revocation closes an open tag even while other company fields remain readable', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.info.groups.find((g) => g.field === 'BUSINESS')!.tags[0].origin = 'AI';
  await context.route('**/company-information/tags/*/evidence?*', (route) =>
    route.fulfill({
      json: [
        {
          chunkId: id(41),
          versionId: id(42),
          filename: '企业介绍.txt',
          locator: '第1段',
          quote: '合成依据。',
        },
      ],
    }),
  );
  await page.goto(start);
  await page.getByRole('button', { name: '合成业务', exact: true }).click();
  await page.getByRole('button', { name: '信息依据', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('合成依据。');
  state.info.groups.find((g) => g.field === 'BUSINESS')!.tags = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '企业背景信息', exact: true })).toBeVisible();
  await expect(page.getByText('合成依据。', { exact: true })).toHaveCount(0);
});
