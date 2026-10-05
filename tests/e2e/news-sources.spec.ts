import { test, expect } from '@playwright/test';
const id = '00000000-0000-4000-8000-000000000001';
test('总台维护来源目录，来源创建使用稳定请求编号', async ({ page }) => {
  const rows: any[] = [];
  const writes: any[] = [];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/csrf'))
      return route.fulfill({ json: { headerName: 'X-CSRF-TOKEN', token: 'synthetic' } });
    if (p.endsWith('/me'))
      return route.fulfill({
        json: {
          account: {
            id,
            email: 'synthetic@news.test',
            phone: null,
            displayName: '合成总部用户',
            status: 'ACTIVE',
          },
          platformAdmin: true,
          memberships: [],
        },
      });
    if (p.endsWith('/news-sources')) {
      if (route.request().method() === 'POST') {
        const b = route.request().postDataJSON();
        writes.push(b);
        const s = { ...b, revision: 1, selected: false, lastStatus: null, checkedAt: null };
        rows.push(s);
        return route.fulfill({ json: s });
      }
      return route.fulfill({ json: rows });
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
  await page.goto('/platform-admin/#admin=capabilities&tab=news');
  await expect(page.getByText('暂无补充来源，资讯仍可按关注主题联网查询。')).toBeVisible();
  await page.getByRole('button', { name: '添加来源' }).click();
  await page.getByLabel('来源名称').fill('合成官方资讯');
  await page.getByLabel('公开网址').fill('https://publisher.example.org/rss');
  await page.getByLabel('来源形式').selectOption('RSS');
  await page.getByLabel('适用行业').fill('健身');
  await page.getByLabel('适用地区').fill('中国');
  await page.getByLabel('启用来源').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('合成官方资讯', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(writes[0]).toMatchObject({ format: 'RSS', enabled: true, revision: 0 });
  await page.screenshot({ path: '.local/news-source-platform-preview.png', fullPage: true });
});
