import { test, expect } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const space = '00000000-0000-4000-8000-000000000003';
for (const available of [true, false]) {
  test(`real skill center capability=${available}, favorites and conversation handoff`, async ({ page }) => {
    const writes: string[] = [];
    await page.route('**/api/**', async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (req.method() !== 'GET') writes.push(path);
      const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
      if (path === '/api/v1/me')
        return json({
          account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
          platformAdmin: false,
          memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
        });
      if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
      if (path.endsWith('/auth/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
      if (path.endsWith('/context'))
        return json({
          tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
          role: 'MEMBER',
          workspaces: [{ id: space, name: '个人空间', kind: 'PERSONAL' }],
        });
      if (path.endsWith('/presentation-capability'))
        return available ? json({ available: true }) : json({ code: 'NOT_FOUND' }, 404);
      if (path.endsWith('/conversations'))
        return json({
          tenantId: tenant,
          enabled: true,
          agentMode: 'live',
          publicWebEnabled: false,
          items: [],
          hasMore: false,
        });
      if (path.endsWith('/work-receipts')) return json({ checks: [], preferences: [], hasMore: false });
      if (path.endsWith('/plan-receipts')) return json([]);
      return json({ items: [], hasMore: false });
    });
    await page.goto(`/workspace/#tenant=${tenant}&view=skills`);
    const center = page.getByRole('region', { name: '技能中心', exact: true });
    await expect(center).toBeVisible();
    await expect(page.getByRole('link', { name: '技能中心', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收藏PPT 生成', exact: true }).click();
    await page.reload();
    await page.getByRole('tab', { name: '我的技能' }).click();
    await expect(center.locator('article')).toHaveCount(1);
    await page.getByRole('tab', { name: '发现技能' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `.local/skills-integration/mobile-${available}.png`, fullPage: true });
    await page.getByRole('button', { name: '查看PPT 生成详情', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (available) {
      await dialog.getByRole('button', { name: '开始使用' }).click();
      await expect(page.getByLabel('PPT 页数')).toHaveValue('6');
      await expect(page.getByLabel('工作要求', { exact: true })).toBeEmpty();
    } else {
      await expect(dialog.getByRole('button', { name: '暂未开放' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
    expect(writes).toEqual([]);
  });
}
