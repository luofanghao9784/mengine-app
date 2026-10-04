import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  space = id(3),
  entryId = id(4),
  version = id(5);
async function fixture(context: BrowserContext) {
  let revoked = false;
  const mutations: string[] = [];
  const content = {
    kind: 'METHOD',
    title: '先核对来源口径',
    summary: '合成方法摘要',
    body: '核对来源范围，再检查实际执行回执。',
    tags: ['核对'],
    applicable: '具备实际执行回执',
    excluded: '缺少回执时不能推断成功',
    dependencies: '使用当前获准来源',
    basis: '系统自动检查，不代表所有业务效果已获证明。',
    accessMode: 'SOURCE_BOUND',
  };
  const result = {
    id: entryId,
    tenantId: tenant,
    workspaceId: space,
    revision: 2,
    status: 'PUBLISHED',
    latestNumber: 1,
    publishedVersion: version,
    canMaintain: true,
    version: {
      id: version,
      number: 1,
      schemaVersion: 1,
      content,
      evidence: [{ kind: 'TASK', referenceId: id(6), workspaceId: space }],
      origin: 'AUTOMATIC',
      evaluation: 'AUTOMATIC_CHECKED',
      createdBy: person,
      createdAt: '2026-10-04T00:00:00Z',
    },
  };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [{ capability: 'EXPERIENCE_MAINTAIN', workspaceId: space }],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [{ id: space, name: '合成共享空间', kind: 'SHARED', ownerId: person, canMaintain: true }],
      });
    if (path.endsWith('/experiences'))
      return json({
        items: revoked
          ? []
          : [
              {
                id: entryId,
                versionId: version,
                number: 1,
                revision: 2,
                status: 'PUBLISHED',
                ...content,
                origin: 'AUTOMATIC',
                evaluation: 'AUTOMATIC_CHECKED',
              },
            ],
        hasMore: false,
        canMaintain: true,
        indexStatus: 'READY',
      });
    if (path.endsWith('/experiences/' + entryId))
      return revoked ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404) : json(result);
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    mutations,
    revoke: () => {
      revoked = true;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=experience&scope=${space}`;
test('automatic experience is readable in tenant admin without manual approval or editing', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.goto(start);
  await expect(page.locator('.experience-card')).toContainText('自动核验通过');
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await expect(page.locator('.experience-detail')).toContainText('系统积累 · 自动核验通过');
  await expect(page.locator('.experience-detail')).toContainText('持续依赖来源权限');
  await expect(
    page.getByRole('button', { name: /整理新版本|发布此版本|审核|批准|判断适用并记录/ }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await page.screenshot({ path: '/tmp/automatic-experience-admin.png', fullPage: true });
});
test('a focus refresh removes a detail after source access disappears', async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await expect(page.locator('.experience-detail')).toBeVisible();
  state.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.experience-detail')).toHaveCount(0);
  await expect(page.getByText('核对来源范围，再检查实际执行回执。', { exact: true })).toHaveCount(0);
});
