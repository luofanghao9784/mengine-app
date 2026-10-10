import { test, expect } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = {
  account: { id: id(1), email: 'synthetic@platform.test', displayName: '合成平台人员' },
  platformAdmin: true,
  memberships: [],
};
const token = 'S'.repeat(43);
test('staff invite and qualification actions stay within settings and separate invitation acceptance', async ({
  context,
  page,
}) => {
  let invites: unknown[] = [];
  let revoked = false;
  const requests: unknown[] = [];
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      post = route.request().method() === 'POST';
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me') return json(identity);
    if (path.endsWith('/staff'))
      return json([
        {
          id: id(1),
          displayName: '合成平台人员',
          loginName: 'synthetic@platform.test',
          status: 'ACTIVE',
          administrator: true,
          version: 0,
        },
        {
          id: id(2),
          displayName: '合成受邀人员',
          loginName: '+8619900000001',
          status: 'ACTIVE',
          administrator: !revoked,
          version: 1,
        },
      ]);
    if (path.endsWith('/staff/invitations')) {
      if (post) {
        requests.push(route.request().postDataJSON());
        invites = [
          {
            id: id(3),
            loginName: '+8619900000002',
            status: 'PENDING',
            createdAt: '2026-10-04T00:00:00Z',
            expiresAt: '2026-10-07T00:00:00Z',
            deliveryMode: 'LOCAL',
          },
        ];
        return json(invites[0]);
      }
      return json(invites);
    }
    if (path.endsWith('/local-link')) return json({ path: '/platform-admin/#invite=' + token });
    if (path.endsWith(`/staff/${id(2)}/revoke`)) {
      expect(route.request().postDataJSON().expectedVersion).toBe(1);
      revoked = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  await page.goto('/platform-admin/#admin=settings');
  await page.getByRole('button', { name: '邀请管理人员' }).click();
  await page.getByLabel('手机号').fill('19900000002');
  await page.getByRole('button', { name: '创建邀请', exact: true }).click();
  await expect(page.getByText('待接受', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '本地合成投递' }).click();
  await expect(page.getByRole('link', { name: '打开合成邀请' })).toHaveAttribute(
    'href',
    '/platform-admin/#invite=' + token,
  );
  await page
    .locator('.admin-directory-row')
    .filter({ hasText: '合成受邀人员' })
    .getByRole('button', { name: '撤销资格' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('该账号的企业成员身份及访问资格不受影响');
  await page.getByRole('button', { name: '确认撤销', exact: true }).click();
  await expect(page.getByText('资格已撤销')).toBeVisible();
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await expect(page.getByRole('link', { name: '绑定手机号并设置统一登录密码' })).toHaveAttribute(
    'href',
    '/workspace/#bind',
  );
  await expect(page.locator('a[href*="/tenant-admin/"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/platform-staff.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('invitation verifies a new phone identity before granting platform access and clears the fragment', async ({
  context,
  page,
}) => {
  let accepted = false;
  const bodies: Record<string, unknown>[] = [];
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/csrf'))
      return route.fulfill({ json: { token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/v1/me')
      return accepted
        ? route.fulfill({ json: identity })
        : route.fulfill({ status: 401, json: { code: 'AUTHENTICATION_REQUIRED' } });
    if (path.endsWith('/invitation/preview'))
      return route.fulfill({ json: { loginName: '+8619900000002', existingAccount: false } });
    if (path.endsWith('/invitation/challenge'))
      return route.fulfill({
        json: {
          id: id(9),
          expiresAt: '2026-10-10T23:59:59Z',
          retryAfterSeconds: 60,
          delivery: 'LOCAL',
          localPreview: false,
        },
      });
    if (path.endsWith('/invitation/accept')) {
      accepted = true;
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json: identity });
    }
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  await page.goto('/platform-admin/#invite=' + token);
  await expect(page.getByRole('heading', { name: '加入梦擎总台' })).toBeVisible();
  await page.getByLabel('姓名', { exact: true }).fill('合成管理员');
  await page.getByLabel('设置账号密码').fill('synthetic-only-password');
  await expect(page.getByRole('button', { name: '创建账号并接受邀请' })).toBeDisabled();
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建账号并接受邀请' })).toBeEnabled();
  await page.getByLabel('短信验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '创建账号并接受邀请' }).click();
  await expect(page.getByRole('complementary', { name: '总台导航' })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].username).toBe('+8619900000002');
  expect(bodies[0].challengeId).toBe(id(9));
  expect(bodies[0].code).toBe('123456');
  expect(new URL(page.url()).hash).toBe('#admin=overview');
});
