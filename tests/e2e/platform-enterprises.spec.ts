import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  invite = id(3);
async function fixture(context: BrowserContext, uncertain = false) {
  const writes: { path: string; body: any }[] = [];
  const detail = {
    tenant: { id: tenant, name: '合成企业甲', status: 'ACTIVE' },
    serviceChange: null as null | {
      status: string;
      internalReason: string;
      publicReason: string;
      changedAt: string;
    },
    version: 0,
    createdAt: '2026-10-01T01:00:00Z',
    activeMemberCount: 0,
    workspaceCount: 0,
    owner: { accountId: null, name: null, state: 'AWAITING_INVITATION' },
    initialAdminInvitation: {
      id: invite,
      tenantId: tenant,
      phone: '+8619900000001',
      email: null,
      role: 'TENANT_ADMIN',
      status: 'PENDING',
      expiresAt: '2099-10-01T01:00:00Z',
    },
  };
  let first = true;
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/platform-admin/v1/auth/me')
      return json({
        account: { id: person, email: 'platform@example.test', displayName: '平台管理员' },
        platformAdmin: true,
        memberships: [],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/platform-admin/v1/overview')
      return json({
        totalTenants: 1,
        activeTenants: 1,
        suspendedTenants: 0,
        platform: 'AVAILABLE',
        database: 'AVAILABLE',
        invitationDelivery: 'LOCAL',
        checkedAt: new Date().toISOString(),
      });
    if (path === '/api/platform-admin/v1/tenants' && route.request().method() === 'POST') {
      writes.push({ path, body: route.request().postDataJSON() });
      return json({ tenant: detail.tenant, invitation: detail.initialAdminInvitation });
    }
    if (path === '/api/platform-admin/v1/tenants')
      return json([
        { ...detail.tenant, createdAt: detail.createdAt, activeMemberCount: 0, owner: detail.owner },
      ]);
    if (path === `/api/platform-admin/v1/tenants/${tenant}`) return json(detail);
    if (path === `/api/platform-admin/v1/tenants/${tenant}/status`) {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      detail.tenant.status = body.status;
      detail.version++;
      detail.serviceChange = {
        status: body.status,
        internalReason: body.internalReason,
        publicReason: body.publicReason,
        changedAt: new Date().toISOString(),
      };
      return json(detail);
    }
    if (path.endsWith('/initial-admin-invitation/revoke')) {
      writes.push({ path, body: route.request().postDataJSON() });
      detail.initialAdminInvitation.status = 'REVOKED';
      detail.owner.state = 'INVITATION_INACTIVE';
      detail.version = 1;
      if (uncertain && first) {
        first = false;
        return route.abort('failed');
      }
      return json(detail);
    }
    if (path.endsWith('/initial-admin-invitation')) {
      writes.push({ path, body: route.request().postDataJSON() });
      detail.initialAdminInvitation.status = 'PENDING';
      detail.initialAdminInvitation.phone = '+86' + route.request().postDataJSON().phone;
      detail.owner.state = 'AWAITING_INVITATION';
      detail.version++;
      return json(detail);
    }
    if (path.endsWith('/records')) return json([]);
    if (path.endsWith('/departure-status'))
      return json({
        tenantId: tenant,
        businessEnabled: true,
        canExport: false,
        exitState: null,
        exportDeadline: null,
      });
    return route.fulfill({ status: 404, json: { code: 'SYNTHETIC_UNAVAILABLE' } });
  });
  return writes;
}
test('enterprise catalog, full detail and creation keep navigation independent with simplified controls', async ({
  page,
  context,
}) => {
  const writes = await fixture(context);
  await page.goto('/platform-admin/#admin=tenants');
  await expect(page.getByRole('textbox', { name: '搜索企业' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看企业 合成企业甲' }).click();
  await expect(page.getByRole('region', { name: '企业详情' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/enterprise=/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '合成企业甲' })).toBeVisible();
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await expect(page).toHaveURL(/section=records/);
  await page.getByRole('button', { name: '返回企业列表' }).click();
  await expect(page.getByRole('heading', { name: '企业管理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开通企业', exact: true }).click();
  await page.getByLabel('企业名称', { exact: true }).fill('合成企业甲');
  await page.getByLabel('初始负责人手机号').fill('19900000001');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: '开通并邀请负责人' }).click();
  await expect.poll(() => writes[0]?.body.designateAuthorizationOwner).toBe(true);
  await expect(page.getByRole('region', { name: '企业详情' })).toBeVisible();
  await expect(page.getByRole('link', { name: /客户端|企业管理端|工作空间/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/platform-enterprise-desktop.png', fullPage: true });
});
test('uncertain initial invitation revocation retains request and cannot leave or revoke a replacement', async ({
  page,
  context,
}) => {
  const writes = await fixture(context, true);
  await page.goto(`/platform-admin/#admin=tenants&enterprise=${tenant}`);
  await page.getByRole('button', { name: '撤销邀请', exact: true }).click();
  const revoke = page.getByRole('dialog', { name: '撤销邀请', exact: true });
  await expect(revoke).toBeVisible();
  await page.getByRole('button', { name: '确认撤销邀请' }).click();
  await expect(page.getByRole('button', { name: '重试本次操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回企业列表', includeHidden: true })).toBeDisabled();
  await expect(revoke.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '刷新详情', exact: true, includeHidden: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重试本次操作' }).click();
  await expect(page.locator('.platform-invitation-line').getByText('已撤销', { exact: true })).toBeVisible();
  expect(writes[0].body).toEqual(writes[1].body);
  await page.getByRole('button', { name: '重新邀请或更换手机号' }).click();
  await page.getByLabel('初始负责人手机号').fill('19900000002');
  await page.getByRole('button', { name: '确认重新邀请负责人' }).click();
  await expect(page.getByText('+8619900000002', { exact: true })).toBeVisible();
  expect(writes[2].body.expectedVersion).toBe(1);
});

test('service suspension and resume require separate internal and public reasons', async ({
  page,
  context,
}) => {
  const writes = await fixture(context);
  await page.goto(`/platform-admin/#admin=tenants&enterprise=${tenant}`);
  await page.getByRole('button', { name: '暂停服务', exact: true }).click();
  const suspension = page.getByRole('dialog', { name: '暂停企业服务', exact: true });
  await expect(suspension).toBeVisible();
  await suspension.getByLabel('内部处理备注').fill('仅总台内部核对');
  await suspension.getByLabel('企业可见说明').fill('企业服务维护中，请联系负责人。');
  await suspension.getByRole('button', { name: '确认暂停服务' }).click();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  expect(writes[0].body.internalReason).toBe('仅总台内部核对');
  expect(writes[0].body.publicReason).toBe('企业服务维护中，请联系负责人。');
  await expect(page.getByRole('region', { name: '最近服务变更' })).toContainText('企业服务维护中');
  await page.getByRole('button', { name: '恢复服务', exact: true }).click();
  const resume = page.getByRole('dialog', { name: '恢复企业服务', exact: true });
  await expect(resume).toBeVisible();
  await expect(resume.getByText(/不补跑错过的执行/)).toBeVisible();
  await resume.getByLabel('内部处理备注').fill('核对完成');
  await resume.getByLabel('企业可见说明').fill('服务已恢复');
  await resume.getByRole('button', { name: '确认恢复服务' }).click();
  await expect(page.getByText('运行中', { exact: true })).toBeVisible();
  expect(writes[1].body.expectedVersion).toBe(1);
});
