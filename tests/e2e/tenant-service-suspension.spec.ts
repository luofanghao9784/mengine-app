import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  other = id(2),
  person = id(3);
test('customer surfaces show public service notice, keep other enterprises usable and refresh after resume', async ({
  context,
  page,
}) => {
  let paused = true;
  const requests: string[] = [];
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'member@example.test', displayName: '合成用户' },
        platformAdmin: false,
        memberships: [
          {
            tenantId: tenant,
            tenantName: '合成暂停企业',
            role: 'TENANT_ADMIN',
            service: {
              status: paused ? 'SUSPENDED' : 'ACTIVE',
              explanation: paused ? '正在维护，请联系企业负责人。' : null,
              changedAt: '2026-10-04T01:00:00Z',
            },
          },
          {
            tenantId: other,
            tenantName: '另一正常企业',
            role: 'MEMBER',
            service: { status: 'ACTIVE', explanation: null, changedAt: null },
          },
        ],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance'))
      return json({
        tenantId: path.includes(tenant) ? tenant : other,
        ownerId: person,
        ownerName: '合成用户',
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        latestHandover: null,
        capabilities: [],
      });
    return route.fulfill({ status: 404, json: { code: 'SYNTHETIC_UNAVAILABLE' } });
  });
  const admin = await context.newPage();
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations`);
  await admin.goto(`/tenant-admin/#tenant=${tenant}&admin=members`);
  for (const current of [page, admin]) {
    await expect(current.getByRole('heading', { name: '企业服务已暂停' })).toBeVisible();
    await expect(current.getByText('正在维护，请联系企业负责人。')).toBeVisible();
    await expect(current.getByRole('link', { name: '另一正常企业' })).toHaveAttribute(
      'href',
      `/workspace/#tenant=${other}&view=briefing`,
    );
    await expect(current.getByRole('link', { name: /总台|平台管理/ })).toHaveCount(0);
  }
  expect(requests.some((p) => p.includes(`/tenants/${tenant}/`))).toBe(false);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/customer-service-paused.png', fullPage: true });
  paused = false;
  await admin.getByRole('button', { name: '重新检查服务状态' }).click();
  await expect(admin.getByRole('heading', { name: '企业服务已暂停' })).toHaveCount(0);
  await expect(admin.getByRole('complementary', { name: '企业管理导航' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '企业服务已暂停' })).toHaveCount(0);
});
