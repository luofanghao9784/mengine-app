import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2);
test('audit filters use server query and revocation removes previously displayed rows', async ({
  page,
  context,
}) => {
  let denied = false;
  const queries: URL[] = [];
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/v1/me')
      return json({
        account: { id: actor, email: 'synthetic@example.test', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: actor,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/records')) {
      queries.push(url);
      if (denied) return json({ contractVersion: '1.0', code: 'FORBIDDEN' }, 403);
      return json(
        url.searchParams.get('q') === '不存在'
          ? []
          : [
              {
                id: 1,
                actorId: actor,
                actorName: '合成 姓名（TENANT_ADMIN+owner）',
                action: 'COLLECTION_NOW',
                targetId: id(3),
                targetName: '合成销售来源',
                relatedAccountId: null,
                relatedAccountName: null,
                createdAt: '2026-10-12T00:00:00Z',
              },
            ],
      );
    }
    return json({ contractVersion: '1.0', code: 'UNAVAILABLE' }, 404);
  });
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=audit`);
  await expect(page.getByRole('heading', { name: '企业操作记录' })).toBeVisible();
  await expect(page.getByRole('link', { name: '操作审计', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '合成销售来源' })).toBeVisible();
  await expect(page.getByText('审计链校验通过')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '合成 姓名（企业负责人）' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '立即更新数据', exact: true })).toBeVisible();
  await expect(page.locator('.tenant-audit')).not.toContainText('COLLECTION_NOW');
  await expect(page.locator('.tenant-audit')).not.toContainText('TENANT_ADMIN');
  await page.getByLabel('事件类别').selectOption('DATA');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('category')).toBe('DATA');
  await page.screenshot({ path: 'test-results/management-audit.png', fullPage: true });
  await page.getByLabel('搜索审计记录').fill('不存在');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page.getByText('暂无匹配的操作记录')).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByRole('cell', { name: '合成销售来源' })).toBeVisible();
  denied = true;
  await page.getByRole('button', { name: '刷新记录' }).click();
  await expect(page.getByRole('cell', { name: '合成销售来源' })).toHaveCount(0);
});
