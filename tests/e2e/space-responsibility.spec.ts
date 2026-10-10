import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  manager = id(2),
  owner = id(3),
  next = id(4),
  spaceId = id(5);
async function fixture(context: BrowserContext, limited = false, exitOnly = false) {
  const changes: Record<string, unknown>[] = [];
  const people = [
    { accountId: manager, displayName: '合成管理员', role: 'TENANT_ADMIN' },
    { accountId: owner, displayName: '合成空间负责人', role: 'MEMBER' },
    { accountId: next, displayName: '合成接任人员', role: 'MEMBER' },
  ].map((p) => ({
    ...p,
    email: p.accountId + '@synthetic.test',
    phone: null,
    status: 'ACTIVE',
    accountStatus: 'ACTIVE',
    version: 0,
  }));
  let space = {
    id: spaceId,
    tenantId: tenant,
    name: '合成项目空间',
    kind: 'SHARED',
    version: 0,
    memberCount: 1,
    ownerId: owner,
    ownerName: '合成空间负责人',
    description: '合成空间说明',
  };
  let created = limited;
  let archived = false;
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      post = route.request().method() === 'POST';
    const json = (v: unknown) => route.fulfill({ json: v });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: {
          id: limited ? owner : manager,
          email: 'synthetic@example.test',
          displayName: limited ? '合成空间负责人' : '合成管理员',
        },
        platformAdmin: false,
        memberships: [
          { tenantId: tenant, tenantName: '合成企业', role: limited ? 'MEMBER' : 'TENANT_ADMIN' },
        ],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: manager,
        revision: 0,
        owner: !limited,
        canConfigure: !limited,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: exitOnly ? [{capability:'TENANT_EXIT',workspaceId:null}] : [],
      });
    if (path.endsWith('/overview'))
      return json({
        tenantId: tenant,
        name: '合成企业',
        version: 0,
        activeMemberCount: 3,
        disabledMemberCount: 0,
        sharedWorkspaceCount: created ? 1 : 0,
        invitationDelivery: 'DISABLED',
      });
    if (path.endsWith(`/workspaces/${spaceId}/archive`)) {
      if (post) {
        const body = route.request().postDataJSON();
        changes.push(body);
        archived = body.archived;
        space.version++;
      }
      return json({ id: spaceId, archived, revision: space.version, dependentRecords: 0 });
    }
    if (path.endsWith('/workspaces')) {
      if (post) {
        const body = route.request().postDataJSON();
        changes.push(body);
        space = { ...space, name: body.name, description: body.description };
        created = true;
        return route.fulfill({ status: 201, json: space });
      }
      return json(created ? [space] : []);
    }
    if (path.endsWith('/owner')) {
      const body = route.request().postDataJSON();
      changes.push(body);
      space = { ...space, ownerId: body.ownerId, ownerName: '合成接任人员', version: 1 };
      return json(space);
    }
    if (path.endsWith('/owner-records')) return json([]);
    if (path.endsWith(`/workspaces/${spaceId}`)) return json(space);
    if (path.endsWith(`/workspaces/${spaceId}/members`))
      return json([{ ...people.find((p) => p.accountId === space.ownerId), canMaintain: true }]);
    if (path.endsWith('/eligible-members')) return json(people);
    if (path.endsWith('/members'))
      return json(people.filter((p) => p.displayName.includes(url.searchParams.get('q') || '')));
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  return changes;
}
test('create requires an explicit responsible member and transfer previews old access', async ({
  context,
  page,
}) => {
  const changes = await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=members&tab=spaces`);
  await page.getByRole('button', { name: '创建空间', exact: true }).click();
  await page.getByLabel('空间名称', { exact: true }).fill('合成项目空间');
  await page.getByLabel('空间说明（选填）').fill('合成空间说明');
  await expect(page.getByRole('button', { name: '创建空间并授权' })).toBeDisabled();
  await page
    .getByRole('dialog')
    .locator('li')
    .filter({ hasText: '合成空间负责人' })
    .getByRole('button', { name: '选择', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('创建者选择其他负责人时，不会自动获得内容访问权');
  await page.getByRole('button', { name: '创建空间并授权' }).click();
  await expect(page.getByRole('button', { name: '更换负责人' })).toBeVisible();
  expect(changes[0].ownerId).toBe(owner);
  await page.getByRole('button', { name: '更换负责人' }).click();
  await page
    .getByRole('dialog')
    .locator('li')
    .filter({ hasText: '合成接任人员' })
    .getByRole('button', { name: '选择', exact: true })
    .click();
  await expect(page.getByLabel('原负责人 合成空间负责人 的后续权限')).toHaveValue('READ');
  await page.getByLabel('原负责人 合成空间负责人 的后续权限').selectOption('REMOVE');
  await expect(page.getByRole('dialog')).toContainText('原负责人将移出空间');
  await page.screenshot({ path: 'test-results/space-owner-transfer.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '确认负责人变更' }).click();
  await expect(page.getByRole('dialog')).toContainText('负责人：合成接任人员');
  expect(changes[1].previousAccess).toBe('REMOVE');
});
test('ordinary responsible member gets scoped spaces without enterprise management controls', async ({
  context,
  page,
}) => {
  await fixture(context, true);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=members`);
  await expect(page.getByText('只显示你负责的共享空间', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '邀请成员', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建空间', exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('complementary', { name: '企业管理导航' })
      .getByRole('link', { name: '企业信息', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '管理空间 合成项目空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更换负责人', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '设为只读', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty workspace archive preserves restoration and hides mutation controls', async ({
  context,
  page,
}) => {
  const changes = await fixture(context, true);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=members`);
  await page.getByRole('button', { name: '管理空间 合成项目空间', exact: true }).click();
  await page.getByRole('checkbox', { name: '确认归档此空间' }).check();
  await page.getByRole('button', { name: '归档空间', exact: true }).click();
  await expect(page.getByText('已归档', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-archive.png', fullPage: true });
  await page.getByRole('checkbox', { name: '确认恢复此空间' }).check();
  await page.getByRole('button', { name: '恢复空间', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeVisible();
  expect(changes.map((c) => c.archived)).toEqual([true, false]);
});

test('explicit enterprise exit capability exposes the exit entry without configuration rights',async({context,page})=>{
 await fixture(context,true,true);
 await page.goto(`/tenant-admin/#tenant=${tenant}&admin=company&detail=retention`);
 await expect(page.getByRole('link',{name:'保留与退出',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'资讯来源',exact:true})).toHaveCount(0);
});
