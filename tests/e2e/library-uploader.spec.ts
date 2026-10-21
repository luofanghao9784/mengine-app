import { test, expect, type Page } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2),
  shared = id(3),
  personal = id(4),
  material = id(5),
  version = id(6);
const date = '2026-10-21T02:00:00Z';
async function fixture(page: Page) {
  let uploaded = false;
  let revoked = false;
  const requests: string[] = [];
  const entry = {
    id: material,
    tenantId: tenant,
    workspaceId: shared,
    workspaceName: '销售共享空间',
    folderId: null,
    kind: 'DOCUMENT',
    name: '企业上传验证.txt',
    version: 1,
    sizeBytes: 3,
    updatedAt: date,
    path: ['销售共享空间', '企业上传验证.txt'],
    canMaintain: true,
    canDownload: true,
    uploadedBy: actor,
    uploadedByName: '罗方豪',
  };
  const file = {
    id: version,
    number: 1,
    filename: entry.name,
    sizeBytes: 3,
    sha256: 'a'.repeat(64),
    createdBy: actor,
    createdByName: '罗方豪',
    createdAt: date,
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    requests.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/v1/me')
      return json({
        account: { id: actor, email: 'synthetic@example.test', displayName: '罗方豪' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [
          { id: personal, name: '个人空间', kind: 'PERSONAL' },
          { id: shared, name: '销售共享空间', kind: 'SHARED' },
        ],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/business-status'))
      return json({
        tenantId: tenant,
        businessEnabled: true,
        exitState: null,
        exportDeadline: null,
        canExport: false,
      });
    if (path.endsWith('/library-access/status')) return json({ enabled: false });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path.endsWith('/materials') && req.method() === 'POST') {
      expect(path).toContain(`/workspaces/${shared}/`);
      uploaded = true;
      return json({ ...entry, receiptStatus: 'EXACT', acceptedVersion: file, currentVersion: 1 }, 201);
    }
    if (path.endsWith('/library')) {
      const target = path.includes('/workspaces/') ? path.split('/workspaces/')[1].split('/')[0] : null;
      const include = target !== personal || url.searchParams.get('includeUploads') === 'true';
      return json({
        tenantId: tenant,
        workspaceId: target,
        folderId: null,
        trail: [],
        canMaintain: !!target,
        maxUploadBytes: 20971520,
        items: uploaded && !revoked && include ? [entry] : [],
        hasMore: false,
      });
    }
    if (path.endsWith(`/materials/${material}`)) {
      expect(path).toContain(`/workspaces/${shared}/`);
      return json({ document: entry, versions: [file], hasMore: false });
    }
    if (path.endsWith(`/versions/${version}`)) return json(file);
    if (path.endsWith('/analysis'))
      return json({
        tenantId: tenant,
        workspaceId: shared,
        materialId: material,
        versionId: version,
        generation: 0,
        status: 'NOT_STARTED',
        parserVersion: null,
        warnings: [],
        canMaintain: true,
        available: false,
        chunks: [],
        hasMore: false,
      });
    return json({ code: 'FIXTURE_UNAVAILABLE' }, 404);
  });
  return {
    requests,
    revoke: () => {
      revoked = true;
    },
  };
}

test('企业上传在个人入口显示同一文件及上传人，桌面与手机布局可用', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await fixture(page);
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=${shared}`);
  await page.getByRole('button', { name: '上传资料', exact: true }).click();
  await page
    .getByLabel('选择上传文件', { exact: true })
    .setInputFiles({ name: '企业上传验证.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: '开始上传 1 个文件', exact: true }).click();
  await expect(page.locator('.lib-entry')).toHaveCount(1);
  await expect(page.locator('.lib-uploader')).toHaveText('罗方豪');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '个人空间', exact: true }).first().click();
  await expect(page.locator('.lib-entry')).toHaveCount(1);
  await expect(page.locator('.lib-place')).toContainText('企业资料 · 销售共享空间');
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page.locator('.lib-columns')).toContainText('上传人');
  await expect(page.locator('.lib-uploader')).toHaveText('罗方豪');
  await page.screenshot({ path: '.local/library-uploader/desktop.png' });
  await page.locator('.lib-entry-main').click();
  await expect
    .poll(() => state.requests.some((p) => p.endsWith(`/workspaces/${shared}/materials/${material}`)))
    .toBe(true);
  await page.getByRole('button', { name: '关闭资料阅读', exact: true }).last().click();
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.lib-uploader')).toBeVisible();
  const bounds = await page.locator('.lib-uploader').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.local/library-uploader/mobile.png' });
  state.revoke();
  await page.reload();
  await expect(page.locator('.lib-entry')).toHaveCount(0);
});
