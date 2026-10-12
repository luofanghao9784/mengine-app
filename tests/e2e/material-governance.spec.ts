import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  space = id(3),
  material = id(4);
const date = '2026-10-12T07:00:00Z';
async function fixture(
  context: BrowserContext,
  options: { readonly?: boolean; lost?: boolean; conflict?: boolean } = {},
) {
  let revoked = false;
  const posts: any[] = [];
  const receipts = new Map<string, unknown>();
  let item = {
    id: material,
    workspaceId: space,
    workspaceName: '合成共享空间',
    name: '合成经营资料.txt',
    version: 1,
    revision: 0,
    canEdit: !options.readonly,
    canRedact: false,
    source: 'NOT_CHECKED',
    quality: null as number | null,
    issues: [] as string[],
    tags: [] as string[],
    reviewAt: null as string | null,
    checkedAt: null as string | null,
  };
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理人员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [{ id: space, name: '合成共享空间', kind: 'SHARED' }],
      });
    if (path.includes('/material-governance')) {
      if (revoked) return json({ contractVersion: '1.0', code: 'MATERIAL_NOT_FOUND' }, 404);
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        posts.push(body);
        if (options.conflict)
          return json({ contractVersion: '1.0', code: 'MATERIAL_GOVERNANCE_VERSION_CONFLICT' }, 409);
        if (receipts.has(body.requestId)) return json(receipts.get(body.requestId));
        const redacted = path.endsWith('/redact');
        item = {
          ...item,
          version: redacted ? 2 : 1,
          revision: item.revision + 1,
          source: 'ORIGINAL_TEXT',
          quality: redacted ? 100 : 84,
          issues: redacted ? [] : ['phone'],
          tags: body.tags,
          reviewAt: body.reviewAt,
          checkedAt: date,
          canRedact: !redacted,
        };
        const result = {
          reportId: id(10 + item.revision),
          version: item.version,
          revision: item.revision,
          source: item.source,
          issues: item.issues,
          tags: item.tags,
          reviewAt: item.reviewAt,
          redacted,
        };
        receipts.set(body.requestId, result);
        if (options.lost && posts.length === 1) return route.abort('failed');
        return json(result);
      }
      if (path.endsWith('/' + material)) return json(item);
      const hidden =
        url.searchParams.get('q') === '不存在' ||
        (url.searchParams.get('rule') === 'identity' && !item.issues.includes('identity'));
      return json({
        tenantId: tenant,
        summary: {
          total: 1,
          checked: item.quality === null ? 0 : 1,
          attention: item.issues.length ? 1 : 0,
          sensitive: item.issues.includes('phone') ? 1 : 0,
          average: item.quality,
        },
        filteredTotal: hidden ? 0 : 1,
        items: hidden ? [] : [item],
        hasMore: false,
      });
    }
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    posts,
    revoke: () => {
      revoked = true;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=materials`;
test('governance diagnosis checks then confirms a new redacted version', async ({ page, context }) => {
  await fixture(context);
  await page.goto(start);
  await expect(page.getByRole('heading', { name: '让资料可信、可用、可追溯' })).toBeVisible();
  await page.getByRole('button', { name: '查看诊断' }).click();
  await page.getByLabel('业务标签', { exact: true }).fill('合成');
  await page.getByLabel('下次复核日期').fill('2027-01-01');
  await page.getByRole('button', { name: '保存并检查' }).click();
  await expect(page.locator('.mg-result')).toContainText('检查已保存');
  await page.getByRole('button', { name: '查看最新诊断' }).click();
  await page.getByRole('button', { name: '脱敏为新版本' }).click();
  await expect(page.getByText(/旧版本仍保留敏感信息/)).toBeVisible();
  await page.getByRole('button', { name: '确认生成脱敏版本' }).click();
  await expect(page.locator('.mg-result')).toContainText('已生成脱敏新版本 · v2');
  await page.getByRole('button', { name: '查看最新诊断' }).click();
  await expect(page.getByText(/文件版本 v2/)).toBeVisible();
  await page.screenshot({ path: '.local/material-governance/diagnosis.png', fullPage: true });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: '.local/material-governance/desktop.png', fullPage: true });
});
test('uncertain mutation preserves request id and prevents closing until retry', async ({
  page,
  context,
}) => {
  const f = await fixture(context, { lost: true });
  await page.goto(start);
  await page.getByRole('button', { name: '查看诊断' }).click();
  await page.getByRole('button', { name: '保存并检查' }).click();
  await expect(page.getByRole('button', { name: '重试本次请求' })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '重试本次请求' }).click();
  await expect(page.locator('.mg-result')).toContainText('检查已保存');
  expect(f.posts).toHaveLength(2);
  expect(f.posts[0]).toEqual(f.posts[1]);
});
test('read-only diagnosis offers no mutation and revoked data clears', async ({ page, context }) => {
  const f = await fixture(context, { readonly: true });
  await page.goto(start);
  await page.getByRole('button', { name: '查看诊断' }).click();
  await expect(page.getByRole('button', { name: '保存并检查' })).toHaveCount(0);
  await expect(page.getByText('当前只有阅读权限，请由有编辑权限的人员处理。')).toBeVisible();
  f.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.mg-diagnosis')).toHaveCount(0);
  expect(f.posts).toHaveLength(0);
});
test('version conflict offers fresh verification and no success receipt', async ({ page, context }) => {
  await fixture(context, { conflict: true });
  await page.goto(start);
  await page.getByRole('button', { name: '查看诊断' }).click();
  await page.getByRole('button', { name: '保存并检查' }).click();
  await expect(page.getByRole('button', { name: '重新核对版本与权限' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('文件版本或检查记录已经变化');
  await expect(page.locator('.mg-result')).toHaveCount(0);
});
test('rule filters, explanations and narrow layout', async ({ page, context }) => {
  await fixture(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(start);
  await page.getByLabel('治理规则').selectOption('identity');
  await expect(page.getByText('没有符合条件的资料')).toBeVisible();
  await page.getByRole('button', { name: '规则与评分说明' }).click();
  await expect(page.getByRole('heading', { name: '六项治理规则与评分' })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/material-governance/mobile.png', fullPage: true });
});
