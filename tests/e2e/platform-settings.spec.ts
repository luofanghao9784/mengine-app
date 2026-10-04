import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = {
  account: { id: id(1), email: 'synthetic@platform.test', displayName: '合成管理人员' },
  platformAdmin: true,
  memberships: [],
};
test('settings records filter, preserve position and link to independent enterprise detail', async ({
  page,
  context,
}) => {
  const queries: string[] = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: identity });
    if (url.pathname.endsWith('/records')) {
      queries.push(url.search);
      return route.fulfill({
        json: Array.from({ length: url.searchParams.get('offset') === '20' ? 1 : 21 }, (_, n) => ({
          id: n + 1,
          category: 'ENTERPRISE',
          action: 'TENANT_SUSPEND',
          outcome: 'SUCCESS',
          actorId: id(1),
          actorName: '合成管理人员',
          targetId: id(3),
          targetName: '合成企业',
          tenantId: id(2),
          tenantName: '合成企业',
          createdAt: '2026-10-04T00:00:00Z',
          internalReason: '合成内部备注',
          publicReason: '合成公开说明',
        })),
      });
    }
    if (url.pathname.endsWith(`/tenants/${id(2)}`))
      return route.fulfill({
        json: {
          tenant: { id: id(2), name: '合成企业', status: 'ACTIVE' },
          owner: { accountId: null, name: null, state: 'UNDESIGNATED' },
          serviceChange: null,
          version: 0,
          createdAt: '2026-10-04T00:00:00Z',
          initialAdminInvitation: null,
          activeMemberCount: 0,
          workspaceCount: 0,
        },
      });
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  await page.goto('/platform-admin/#admin=settings&section=records');
  await page.getByRole('combobox', { name: '操作类别' }).click();
  await page
    .getByRole('listbox', { name: '操作类别' })
    .getByRole('option', { name: '企业服务', exact: true })
    .click();
  await page.getByRole('combobox', { name: '执行结果' }).click();
  await page
    .getByRole('listbox', { name: '执行结果' })
    .getByRole('option', { name: '已完成', exact: true })
    .click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页')).toBeVisible();
  await expect(page.getByRole('link', { name: '合成企业', exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: '合成企业', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`enterprise=${id(2)}&section=records`));
  await page.goBack();
  await expect(page.getByText('第 2 页')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '操作类别' })).toHaveText('企业服务');
  expect(
    queries.some(
      (q) => q.includes('offset=20') && q.includes('category=ENTERPRISE') && q.includes('outcome=SUCCESS'),
    ),
  ).toBe(true);
  await expect(page.locator('a[href*="/workspace/"],a[href*="/tenant-admin/"]')).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/platform-settings-records.png', fullPage: true });
});
for (const lost of [false, true])
  test(`own password ${lost ? 'lost response avoids replay' : 'success requires a new platform login'}`, async ({
    page,
    context,
  }) => {
    let changed = false,
      calls = 0;
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/csrf'))
        return route.fulfill({ json: { token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' } });
      if (path.endsWith('/auth/me'))
        return changed
          ? route.fulfill({ status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } })
          : route.fulfill({ json: identity });
      if (path.endsWith('/auth/password')) {
        calls++;
        changed = true;
        expect(route.request().postDataJSON()).toEqual({
          currentPassword: 'old-synthetic-password',
          password: 'new-synthetic-password',
        });
        return lost ? route.abort('failed') : route.fulfill({ status: 204 });
      }
      return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
    });
    await page.goto('/platform-admin/#admin=settings&section=account');
    await page.getByLabel('当前总台密码').fill('old-synthetic-password');
    await page.getByLabel('新总台密码', { exact: true }).fill('new-synthetic-password');
    await page.getByLabel('确认新密码').fill('mismatching-password');
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('两次输入的新密码不一致。');
    expect(calls).toBe(0);
    await page.getByLabel('确认新密码').fill('new-synthetic-password');
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    await expect(
      page.getByText(
        lost
          ? '暂时无法确认密码是否修改成功。请重新登录核对，先尝试新密码；如果不成功，再尝试原密码。'
          : '密码已修改，所有总台登录已失效。请使用新密码重新登录。',
        { exact: true },
      ),
    ).toBeVisible();
    expect(calls).toBe(1);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
      'synthetic-password',
    );
    await page.getByRole('button', { name: '返回总台登录' }).click();
    await expect(page.getByRole('complementary', { name: '总台导航' })).toHaveCount(0);
  });
