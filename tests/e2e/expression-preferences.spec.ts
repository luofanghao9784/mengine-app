import { test, expect } from '@playwright/test';
const id = '00000000-0000-4000-8000-000000000001';
const choices = [
  ['RESPONSE_LENGTH', 'CONCISE'],
  ['RESPONSE_LENGTH', 'DETAILED'],
  ['RESPONSE_FORMAT', 'PARAGRAPHS'],
  ['RESPONSE_FORMAT', 'BULLETS'],
  ['TONE', 'DIRECT'],
  ['TONE', 'FRIENDLY'],
  ['BRIEFING_ORDER', 'CONCLUSION_FIRST'],
  ['BRIEFING_ORDER', 'EVIDENCE_FIRST'],
].map(([category, choice]) => ({ category, choice, label: choice, explicitPhrases: [] }));
const base = {
  RESPONSE_LENGTH: 'CONCISE',
  RESPONSE_FORMAT: 'PARAGRAPHS',
  TONE: 'DIRECT',
  BRIEFING_ORDER: 'CONCLUSION_FIRST',
};
test('总部偏好可保存、显示实际来源、恢复默认且使用独立平台CSRF', async ({ page }) => {
  let current = {
    scope: 'GLOBAL',
    canMaintain: true,
    choices,
    settings: Object.fromEntries(Object.keys(base).map((k) => [k, { choice: '', revision: 0, id: null }])),
    effective: Object.fromEntries(
      Object.entries(base).map(([k, choice]) => [k, { choice, source: 'SYSTEM', revision: 0 }]),
    ),
  };
  let posts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const send = (v: unknown) => route.fulfill({ json: v });
    if (path.endsWith('/me'))
      return send({
        account: {
          id,
          email: 'synthetic@preferences.test',
          phone: null,
          displayName: '合成总部用户',
          status: 'ACTIVE',
        },
        platformAdmin: true,
        memberships: [],
      });
    if (path.endsWith('/csrf')) {
      expect(path).toBe('/api/platform-admin/v1/auth/csrf');
      return send({ token: 'synthetic-expression', headerName: 'X-CSRF-TOKEN' });
    }
    if (path === '/api/platform-admin/v1/expression-preferences') {
      if (route.request().method() === 'POST') {
        posts++;
        expect(route.request().headers()['x-csrf-token']).toBe('synthetic-expression');
        const data = route.request().postDataJSON();
        for (const k of Object.keys(base)) {
          if (data.choices[k] !== current.settings[k].choice) {
            current.settings[k] = {
              choice: data.choices[k],
              revision: current.settings[k].revision + 1,
              id: null,
            };
          }
          current.effective[k] = {
            choice: data.choices[k] || base[k as keyof typeof base],
            source: data.choices[k] ? 'GLOBAL' : 'SYSTEM',
            revision: data.choices[k] ? current.settings[k].revision : 0,
          };
        }
      }
      return send(current);
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
  await page.goto('/platform-admin/#admin=capabilities&tab=preferences');
  await expect(page.getByRole('heading', { name: 'AI内容偏好' })).toBeVisible();
  await page.getByLabel('内容长短').selectOption('DETAILED');
  await page.getByLabel('画报顺序').selectOption('EVIDENCE_FIRST');
  await page.getByRole('button', { name: '保存偏好' }).click();
  await expect(page.getByText('当前生效：详细 · 总部设置 v1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部恢复继承' }).click();
  await page.getByRole('button', { name: '保存偏好' }).click();
  await expect(page.getByText('当前生效：简洁 · 系统默认', { exact: true })).toBeVisible();
  expect(posts).toBe(2);
  await page.screenshot({ path: '.local/expression-preferences-platform.png', fullPage: true });
});
