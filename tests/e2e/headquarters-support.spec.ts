import { test, expect } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const owner = '00000000-0000-4000-8000-000000000003';
const visit = '00000000-0000-4000-8000-000000000004';
test('headquarters enters scoped management, keeps context in navigation, shows records and retains the original tab', async ({
  page,
  context,
}) => {
  const paths: string[] = [];
  const writes: { path: string; body: unknown }[] = [];
  const access = { id: visit, tenant, actor, owner, mode: 'ADJUSTMENT', name: '合成总部支持企业' };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    paths.push(path);
    const json = (value: unknown) => route.fulfill({ json: value });
    if (method !== 'GET')
      writes.push({ path, body: route.request().postData() ? route.request().postDataJSON() : null });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path.endsWith('/auth/me'))
      return json({
        account: { id: actor, email: 'support@example.test', displayName: '合成总部操作者' },
        platformAdmin: true,
        memberships: [],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/platform-admin/v1/support-access') return json(access);
    if (path === `/api/platform-admin/v1/support-access/${visit}`)
      return method === 'DELETE' ? route.fulfill({ status: 204 }) : json(access);
    if (path === `/api/platform-admin/v1/support-access/${visit}/records`)
      return json({
        events: [{ id: 1, action: 'ENTER', outcome: 'SUCCESS', created_at: '2026-10-04T12:00:00Z' }],
        changes: [],
      });
    if (path === `/api/platform-admin/v1/tenants/${tenant}`)
      return json({
        tenant: { id: tenant, name: access.name, status: 'ACTIVE' },
        version: 0,
        createdAt: '2026-10-01T00:00:00Z',
        activeMemberCount: 1,
        workspaceCount: 1,
        owner: { accountId: owner, name: '合成负责人', state: 'ASSIGNED' },
        initialAdminInvitation: null,
        serviceChange: null,
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: owner,
        ownerName: '合成负责人',
        revision: 1,
        owner: false,
        canConfigure: true,
        canAcceptInitialResponsibility: false,
        canEnterManagement: true,
        capabilities: [],
        pendingHandover: null,
        latestHandover: null,
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: access.name, status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [],
      });
    if (path.endsWith('/library'))
      return json({
        tenantId: tenant,
        workspaceId: null,
        folderId: null,
        trail: [],
        canMaintain: false,
        maxUploadBytes: 20971520,
        items: [],
        hasMore: false,
      });
    if (path.endsWith('/overview'))
      return json({
        tenantId: tenant,
        name: access.name,
        version: 0,
        activeMemberCount: 1,
        disabledMemberCount: 0,
        sharedWorkspaceCount: 1,
        invitationDelivery: 'LOCAL',
      });
    if (path.endsWith('/members') || path.endsWith('/workspaces') || path.endsWith('/invitations'))
      return json([]);
    return route.fulfill({ status: 404, json: { contractVersion: '1.0', code: 'SYNTHETIC_UNAVAILABLE' } });
  });
  await page.goto(`/platform-admin/#admin=tenants&enterprise=${tenant}&section=basic`);
  await expect(page.getByRole('combobox', { name: '总部访问模式' })).toHaveCount(0);
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole('button', { name: '进入企业管理端' }).click();
  await expect(page.getByRole('alert')).toContainText('新标签页未能打开');
  expect(writes).toHaveLength(0);
  await page.reload();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: '进入企业管理端' }).click();
  const supportPage = await popup;
  await expect(supportPage).toHaveURL(/\/tenant-admin\/support\/#.*support=/);
  await expect(page).toHaveURL(
    new RegExp(`/platform-admin/#admin=tenants&enterprise=${tenant}&section=basic`),
  );
  await expect(page.getByRole('button', { name: '进入企业管理端' })).toBeVisible();
  expect(await supportPage.evaluate(() => window.opener)).toBeNull();
  await supportPage.reload();
  await expect(supportPage.locator('.support-mode-banner')).toHaveCount(0);
  await expect(supportPage.getByRole('complementary').getByText('合成总部操作者', { exact: true })).toBeVisible();
  const pageErrors: string[] = [];
  supportPage.on('pageerror', (error) => pageErrors.push(error.message));
  await supportPage.getByRole('complementary', { name: '企业管理导航' }).getByRole('link', { name: '资料库', exact: true }).click();
  await supportPage.getByRole('link', { name: '文件与目录', exact: true }).click();
  await expect(supportPage.getByRole('heading', { name: '还没有资料', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await supportPage.getByRole('link', { name: '成员与空间', exact: true }).click();
  await expect(supportPage).toHaveURL(new RegExp(`admin=members.*support=${visit}`));
  await supportPage.getByRole('link', { name: '职责与交接' }).click();
  await expect(supportPage.getByText('负责人异常恢复', { exact: true })).toHaveCount(0);
  await expect(supportPage.getByRole('button', { name: '发起交接' })).toHaveCount(0);
  await supportPage.getByRole('button', { name: '本次操作记录' }).click();
  await expect(supportPage.getByRole('dialog', { name: '总部操作记录' })).toBeVisible();
  await expect(supportPage.getByRole('dialog').getByText('成功', { exact: true })).toBeVisible();
  await supportPage.keyboard.press('Escape');
  await expect(supportPage.getByRole('button', { name: '返回总台企业概览' })).toHaveCount(0);
  await supportPage.close();
  await expect(page).toHaveURL(
    new RegExp(`/platform-admin/#admin=tenants&enterprise=${tenant}&section=basic`),
  );
  expect(writes[0]).toEqual({
    path: '/api/platform-admin/v1/support-access',
    body: { tenant, mode: 'ADJUSTMENT' },
  });
  expect(writes).toHaveLength(1);
  expect(paths.some((path) => path.startsWith(`/api/platform-admin/v1/support-access/${visit}/api/`))).toBe(
    true,
  );
  expect(paths.some((path) => /^\/api\/(v1|tenant-admin\/v1)\/tenants\//.test(path))).toBe(false);
  expect(paths.includes('/api/v1/auth/me')).toBe(false);
});
