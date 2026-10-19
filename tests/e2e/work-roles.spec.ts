import { test, expect } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-000000000001',
  actor = '00000000-0000-4000-8000-000000000002';
for (const manage of [true, false])
  test(`岗位配置 ${manage ? '保存真实职责与关注方向' : '普通成员只读本人'}`, async ({ page }) => {
    const saves: unknown[] = [];
    let row = {
      accountId: actor,
      name: '合成员工',
      systemRole: manage ? 'OWNER' : 'MEMBER',
      department: '',
      jobTitle: '',
      responsibilities: '',
      focus: [] as string[],
      revision: 0,
    };
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
      if (path === '/api/v1/me')
        return reply({
          account: { id: actor, email: 'synthetic@test.test', displayName: '合成人员' },
          platformAdmin: false,
          memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
        });
      if (path.endsWith('/csrf')) return reply({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
      if (path.endsWith('/governance'))
        return reply({
          tenantId: tenant,
          ownerId: actor,
          revision: 0,
          owner: manage,
          canConfigure: manage,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          pendingHandover: null,
          capabilities: [],
        });
      if (path.endsWith('/work-roles'))
        return reply({
          canMaintain: manage,
          members: [row],
          choices: [
            {
              key: 'SERVICE',
              label: '服务与当天工作',
              keywords: ['美容', '预约'],
              starter: '今天准备什么？',
            },
          ],
        });
      if (path.endsWith('/work-roles/' + actor)) {
        const body = route.request().postDataJSON();
        saves.push(body);
        row = { ...row, ...body, revision: 1 };
        return reply(row);
      }
      return reply({ code: 'UNAVAILABLE' }, 503);
    });
    await page.goto(`/tenant-admin/prototype/?tenant=${tenant}#admin=members`);
    await page.getByRole('button', { name: '成员与权限', exact: true }).click();
    await page.getByRole('button', { name: '岗位与内容偏好', exact: true }).click();
    const panel = page.getByRole('region', { name: '岗位与内容偏好' });
    await expect(panel.getByLabel('岗位', { exact: true })).toBeVisible();
    if (manage) {
      await panel.getByLabel('岗位', { exact: true }).fill('美容师');
      await panel.getByLabel('部门', { exact: true }).fill('门店服务');
      await panel.getByLabel('主要职责').fill('核对预约、准备洗护，异常向负责人反馈');
      await panel.getByLabel('服务与当天工作').check();
      await panel.getByRole('button', { name: '保存岗位与关注方向' }).click();
      await expect(panel.getByRole('status')).toContainText('岗位已保存');
      expect(saves).toHaveLength(1);
      expect(saves[0]).toMatchObject({
        jobTitle: '美容师',
        department: '门店服务',
        focus: ['SERVICE'],
        expectedRevision: 0,
      });
    } else {
      await expect(panel.getByLabel('岗位', { exact: true })).toBeDisabled();
      await expect(panel.getByRole('button', { name: '保存岗位与关注方向' })).toBeDisabled();
      expect(saves).toHaveLength(0);
    }
  });
