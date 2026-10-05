import { test, expect } from '@playwright/test';
const id = '00000000-0000-4000-8000-000000000001';
const rows = [
  {
    id: 'tone:2',
    rule: '以后回答语气直接一些',
    origin: 'MANUAL',
    provenance: '总部录入',
    state: 'EFFECTIVE',
    revision: 2,
    recordedAt: '2026-10-05T03:00:00Z',
  },
  {
    id: 'tone:1',
    rule: '以后回答语气友好一些',
    origin: 'CONVERSATION',
    provenance: '用户在会话中明确要求记住',
    state: 'SUPERSEDED',
    revision: 1,
    recordedAt: '2026-10-05T02:00:00Z',
  },
];
async function fixture(page: import('@playwright/test').Page, empty = false) {
  let posts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') posts++;
    if (path.endsWith('/csrf'))
      return route.fulfill({ json: { headerName: 'X-CSRF-TOKEN', token: 'synthetic-only' } });
    if (path.endsWith('/me'))
      return route.fulfill({
        json: {
          account: {
            id,
            email: 'synthetic@preferences.test',
            phone: null,
            displayName: '合成总部用户',
            status: 'ACTIVE',
          },
          platformAdmin: true,
          memberships: [],
        },
      });
    if (path.endsWith('/expression-preferences/books'))
      return route.fulfill({
        json: {
          scope: 'GLOBAL',
          canMaintain: true,
          books: [
            { target: 'ALL', body: '', revision: 0, id: null },
            { target: 'BRIEFING', body: '', revision: 0, id: null },
          ],
        },
      });
    if (path.endsWith('/expression-preferences/records'))
      return route.fulfill({ json: { scope: 'GLOBAL', items: empty ? [] : rows, hasMore: false } });
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
  return () => posts;
}
test('偏好页展示每次规则及来源状态，不提供选项调整', async ({ page }) => {
  const posts = await fixture(page);
  await page.goto('/platform-admin/#admin=capabilities&tab=preferences');
  await expect(page.getByText('以后回答语气直接一些', { exact: true })).toBeVisible();
  await expect(page.getByText('以后回答语气友好一些', { exact: true })).toBeVisible();
  await expect(page.getByText('当前采用', { exact: true })).toBeVisible();
  await expect(page.getByText('已被更新', { exact: true })).toBeVisible();
  await expect(page.getByText('会话收录 · 版本 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存偏好' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全部恢复继承' })).toHaveCount(0);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('以后回答语气直接一些', { exact: true })).toBeVisible();
  expect(posts()).toBe(0);
  await page.screenshot({ path: '.local/preference-records-platform.png', fullPage: true });
});
test('没有实际记录时显示空状态，不虚构默认规则为收录记录', async ({ page }) => {
  await fixture(page, true);
  await page.goto('/platform-admin/#admin=capabilities&tab=preferences');
  await expect(page.getByText('暂无偏好规则记录', { exact: true })).toBeVisible();
  await expect(page.locator('.expression-rule-list li')).toHaveCount(0);
});

test('文字录入保留版本号与请求幂等标识，不使用下拉选项', async ({ page }) => {
  await fixture(page, true);
  let saved: Record<string, unknown> | undefined;
  await page.route('**/expression-preferences/books', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') saved = request.postDataJSON();
    return route.fulfill({
      json: {
        scope: 'GLOBAL',
        canMaintain: true,
        books: [
          { target: 'ALL', body: '', revision: 0, id: null },
          { target: 'BRIEFING', body: saved ? '标题写业务发现' : '', revision: saved ? 1 : 0, id: null },
        ],
      },
    });
  });
  await page.goto('/platform-admin/#admin=capabilities&tab=preferences');
  await page.getByRole('button', { name: '录入或修订画报规则' }).click();
  await page.getByRole('textbox', { name: '规则正文' }).fill('标题写业务发现');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.getByRole('button', { name: '保存规则' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(saved?.target).toBe('BRIEFING');
  expect(saved?.body).toBe('标题写业务发现');
  expect(saved?.expectedRevision).toBe(0);
  expect(saved?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
