import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  owner = id(2),
  receiver = id(3);
async function fixture(context: BrowserContext, asReceiver = false, uncertainAccept = false) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const people = [
    { accountId: owner, displayName: '合成原负责人', role: 'TENANT_ADMIN' },
    { accountId: receiver, displayName: '合成接任者', role: 'MEMBER' },
  ].map((p) => ({
    ...p,
    email: null,
    phone: '+861990000000' + (p.accountId === owner ? '1' : '2'),
    status: 'ACTIVE',
    accountStatus: 'ACTIVE',
    version: 0,
  }));
  let pending: Record<string, unknown> | null = asReceiver
    ? {
        id: id(4),
        fromAccount: owner,
        toAccount: receiver,
        fromName: '合成原负责人',
        toName: '合成接任者',
        status: 'PENDING',
        previousOwnerRole: 'MEMBER',
      }
    : null;
  let latest: Record<string, unknown> | null = null,
    revision = 0,
    currentOwner = owner,
    lost = false;
  const actor = asReceiver ? receiver : owner;
  const snapshot = () => ({
    tenantId: tenant,
    ownerId: currentOwner,
    ownerName: currentOwner === owner ? '合成原负责人' : '合成接任者',
    revision,
    owner: actor === currentOwner,
    canConfigure: actor === currentOwner,
    canEnterManagement: actor === currentOwner || !!pending,
    canAcceptInitialResponsibility: false,
    pendingHandover: pending,
    latestHandover: latest,
    capabilities: [],
  });
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      post = route.request().method() === 'POST';
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: {
          id: actor,
          displayName: asReceiver ? '合成接任者' : '合成原负责人',
          email: 'synthetic@example.test',
        },
        platformAdmin: false,
        memberships: [
          {
            tenantId: tenant,
            tenantName: '合成企业',
            role: actor === currentOwner ? 'TENANT_ADMIN' : 'MEMBER',
          },
        ],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance')) return json(snapshot());
    if (path.endsWith('/capabilities')) return json([]);
    if (path.endsWith('/workspaces')) return json([]);
    if (path.endsWith('/members')) return json(people);
    if (post && path.includes('/handover')) {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      if (path.endsWith('/handover')) {
        pending = {
          id: id(4),
          fromAccount: owner,
          toAccount: receiver,
          fromName: '合成原负责人',
          toName: '合成接任者',
          status: 'PENDING',
          previousOwnerRole: body.previousOwnerRole,
        };
        revision++;
      } else {
        if (pending) {
          latest = {
            ...pending,
            status: path.endsWith('/accept')
              ? 'ACCEPTED'
              : path.endsWith('/reject')
                ? 'REJECTED'
                : 'CANCELLED',
          };
          pending = null;
          revision++;
        }
        if (path.endsWith('/accept')) {
          currentOwner = receiver;
          if (uncertainAccept && !lost) {
            lost = true;
            return route.abort('failed');
          }
        }
      }
      return json(snapshot());
    }
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  return writes;
}
const href = `/tenant-admin/#tenant=${tenant}&admin=members&detail=duties`;
test('owner previews previous role, cannot silently replace pending, and can revoke', async ({
  context,
  page,
}) => {
  const writes = await fixture(context);
  await page.goto(href);
  await page.getByLabel('职责成员', { exact: true }).selectOption(receiver);
  await expect(page.getByLabel('交接后我的身份')).toHaveValue('TENANT_ADMIN');
  await page.getByLabel('交接后我的身份').selectOption('MEMBER');
  await page.getByLabel('确认向此成员发起交接').check();
  await page.getByRole('button', { name: '发起负责人交接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '负责人交接待接受' })).toBeVisible();
  await expect(page.getByText('合成原负责人 将变为普通成员', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '发起负责人交接', exact: true })).toHaveCount(0);
  expect(writes[0].body.previousOwnerRole).toBe('MEMBER');
  await page.getByRole('button', { name: '撤销交接', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '交接' })).toContainText(
    '已撤销，原负责人继续负责',
  );
  expect(writes[1].path).toMatch(/\/cancel$/);
});
test('receiver sees agreed role and can reject without an acceptance checkbox', async ({ context, page }) => {
  const writes = await fixture(context, true);
  await page.goto(href);
  await expect(page.getByRole('button', { name: '接受负责人交接', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '撤销交接', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/owner-handover-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '拒绝交接', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '交接' })).toContainText(
    '已拒绝，原负责人继续负责',
  );
  expect(writes[0].path).toMatch(/\/reject$/);
});
test('lost acceptance response keeps the same request and prevents switching to reject', async ({
  context,
  page,
}) => {
  const writes = await fixture(context, true, true);
  await page.goto(href);
  await page.getByLabel('我已了解并愿意承担上述职责').check();
  await page.getByRole('button', { name: '接受负责人交接', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本次接受' })).toBeVisible();
  await expect(page.getByRole('button', { name: '拒绝交接' })).toBeDisabled();
  await page.getByRole('button', { name: '重试本次接受' }).click();
  await expect(page.getByRole('status').filter({ hasText: '交接' })).toContainText('已接受');
  expect(writes[0].body).toEqual(writes[1].body);
});
