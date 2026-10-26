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
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'LOCAL', localPreview: true });
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
    if (path.endsWith('/invitations'))
      return json([
        {
          id: owner,
          tenantId: tenant,
          phone: '+8619900012345',
          email: null,
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: '2027-10-08T01:00:00Z',
        },
      ]);
    if (
      path ===
      `/api/platform-admin/v1/support-access/${visit}/api/tenant-admin/v1/tenants/${tenant}/invitations/${owner}/local-link`
    )
      return json({ mode: 'LOCAL', path: '/workspace/#invite=' + 's'.repeat(43) });
    if (path.endsWith('/members') || path.endsWith('/workspaces')) return json([]);
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
  await expect(supportPage.getByRole('banner', { name: '总部支持身份' })).toContainText('合成总部操作者');
  await expect(supportPage.locator('.shell')).toBeVisible();
  await expect(supportPage.getByRole('complementary', {name:'企业管理导航'})).toHaveCount(0);
  await expect.poll(() => paths.some(p => p.includes(`/support-access/${visit}/api/tenant-admin/v1/tenants/${tenant}/scene/dispatch`))).toBe(true);
  await supportPage.getByRole('button', { name: '本次操作记录' }).click();
  await expect(supportPage.getByRole('dialog', { name: '总部操作记录' })).toBeVisible();
  await supportPage.keyboard.press('Escape');
  await supportPage.getByRole('button', { name: '结束支持并返回总台' }).click();
  await expect(supportPage).toHaveURL(new RegExp('/platform-admin/#admin=tenants&enterprise='+tenant));
  await supportPage.close();
  await expect(page).toHaveURL(
    new RegExp(`/platform-admin/#admin=tenants&enterprise=${tenant}&section=basic`),
  );
  expect(writes[0]).toEqual({
    path: '/api/platform-admin/v1/support-access',
    body: { tenant, mode: 'ADJUSTMENT' },
  });
  expect(writes).toHaveLength(2);
  expect(writes[1].path).toBe(`/api/platform-admin/v1/support-access/${visit}`);
  expect(paths.some((path) => path.startsWith(`/api/platform-admin/v1/support-access/${visit}/api/`))).toBe(
    true,
  );
  expect(paths.some((path) => /^\/api\/(v1|tenant-admin\/v1)\/tenants\//.test(path))).toBe(false);
  expect(paths.includes('/api/v1/auth/me')).toBe(false);
});

test('scene writes use platform CSRF and tenant-bound support routes; revoked access fails closed', async ({page}) => {
  const seen: {path:string, token:string|undefined}[]=[];
  await page.route('**/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    seen.push({path,token:route.request().headers()['x-csrf-token']});
    if(path.endsWith('/auth/me')) return route.fulfill({json:{account:{id:actor,displayName:'总部'},platformAdmin:true,memberships:[]}});
    if(path.endsWith('/csrf')) return route.fulfill({json:{token:'platform-only',headerName:'X-CSRF-TOKEN'}});
    return route.fulfill({status:403,json:{code:'SUPPORT_ACCESS_INVALID'}});
  });
  await page.goto(`/tenant-admin/support/#tenant=${tenant}&support=${visit}`);
  await expect(page.locator('.shell')).toHaveCount(0);
  const result=await page.evaluate(async () => {
    // Test the scene request adapter without creating an actual business mutation.
    const {api}=await import(/* @vite-ignore */ '/src/admin/prototype/foundation-api.ts');
    try { await api('/scene-foundation/example/actions',{action:'synthetic'}); return 'unexpected'; }
    catch(e) { return (e as {status:number}).status; }
  });
  expect(result).toBe(403);
  const write=seen.find(x=>x.path.endsWith('/scene/dispatch'));
  expect(write?.path).toBe(`/api/platform-admin/v1/support-access/${visit}/api/tenant-admin/v1/tenants/${tenant}/scene/dispatch`);
  expect(write?.token).toBe('platform-only');
  expect(seen.some(x=>x.path==='/api/v1/auth/csrf'||x.path==='/api/v1/auth/me')).toBe(false);
});
