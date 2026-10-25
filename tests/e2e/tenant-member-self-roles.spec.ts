import { expect, test } from '@playwright/test';

const tenant = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const workspace = '00000000-0000-4000-8000-000000000004';

for (const selected of ['', other]) {
  test(`受限管理成员只读本人岗位${selected ? '，忽略地址中的其他成员' : ''}`, async ({ page }) => {
    const administratorMemberRequests: string[] = [];
    const writes: string[] = [];
    let roleReads = 0;

    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
      if (request.method() !== 'GET') writes.push(path);
      if (path.startsWith(`/api/tenant-admin/v1/tenants/${tenant}/members`)) {
        administratorMemberRequests.push(path);
        return reply({ code: 'ACCESS_DENIED' }, 403);
      }
      if (path === '/api/v1/me')
        return reply({
          account: { id: actor, phone: '+8619900001234', displayName: '合成受限成员' },
          platformAdmin: false,
          memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
        });
      if (path === '/api/v1/auth/phone/configuration')
        return reply({ delivery: 'DISABLED', localPreview: false });
      if (path.endsWith('/csrf')) return reply({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
      if (path === `/api/v1/tenants/${tenant}/governance`)
        return reply({
          tenantId: tenant,
          ownerId: other,
          ownerName: '合成负责人',
          revision: 0,
          owner: false,
          canConfigure: false,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          pendingHandover: null,
          capabilities: [{ capability: 'CONTENT_MAINTAIN', workspaceId: workspace }],
        });
      if (path === `/api/v1/tenants/${tenant}/library-access/status`)
        return reply({ enabled: false });
      if (path === `/api/v1/tenants/${tenant}/work-roles`) {
        roleReads++;
        return reply({
          canMaintain: false,
          members: [{
            accountId: actor,
            name: '合成受限成员',
            systemRole: 'MEMBER',
            department: '本地验证',
            jobTitle: '本人岗位',
            responsibilities: '只读本人已登记的职责',
            focus: [],
            revision: 0,
          }],
          choices: [],
        });
      }
      return reply({ code: 'UNAVAILABLE' }, 503);
    });

    await page.goto(`/tenant-admin/#tenant=${tenant}&place=members&tab=roles${selected ? '&member=' + selected : ''}`);
    const panel = page.getByRole('region', { name: '成员背景与治理目标', exact: true });
    await expect(panel.getByLabel('岗位', { exact: true })).toHaveValue('本人岗位');
    await expect(panel.getByLabel('岗位', { exact: true })).toBeDisabled();
    await expect(panel.getByRole('textbox', { name: '主要职责', exact: true })).toHaveValue('只读本人已登记的职责');
    await expect(panel.getByLabel('岗位成员', { exact: true })).toHaveValue(actor);
    await expect(panel.getByLabel('岗位成员', { exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '保存成员背景与目标', exact: true })).toBeDisabled();
    expect(roleReads).toBeGreaterThan(0);
    expect(administratorMemberRequests).toEqual([]);
    expect(writes).toEqual([]);
  });
}
