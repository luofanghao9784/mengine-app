import { test, expect, type Page } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  actor = id(2),
  space = id(3),
  file = id(4),
  colleague = id(5);
async function fixture(page: Page, enabled = true, moves: Record<string, unknown>[] = []) {
  const saves: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let json: unknown;
    if (path === '/api/v1/me')
      json = {
        account: { id: actor, phone: '+8619900009001', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [{ id: space, name: '共享空间', kind: 'SHARED' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic' };
    else if (path.endsWith('/library-access/status')) json = { enabled };
    else if (path.endsWith('/library-access/directory'))
      json = {
        people: [
          { id: actor, name: '合成管理员' },
          { id: colleague, name: '销售同事' },
        ],
        departments: [],
      };
    else if (path.includes('/library-moves/MATERIAL/')) {
      if (path.endsWith('/destinations')) json = [{ id: id(6), name: '财务目录' }];
      else if (path.endsWith('/preview'))
        json = {
          fingerprint: 'synthetic-preview',
          workspaceId: space,
          kind: 'MATERIAL',
          objectId: file,
          sourceFolderId: null,
          destinationFolderId: id(6),
          destinationName: '财务目录',
          inheritDestination: req.postDataJSON().inheritDestination,
          independent: true,
          objects: 1,
          canConfirm: true,
          changes: [
            {
              accountId: colleague,
              name: '销售同事',
              objectId: file,
              objectName: '预算.txt',
              beforeMask: 5,
              afterMask: 1,
            },
          ],
        };
      else {
        moves.push(req.postDataJSON());
        json = { objectId: file };
      }
    } else if (path.includes('/library-access/MATERIAL/')) {
      if (req.method() === 'PUT') {
        saves.push(req.postDataJSON());
        expect(req.headers()['x-csrf-token']).toBe('synthetic');
      }
      json = {
        kind: 'MATERIAL',
        id: file,
        workspaceId: space,
        revision: req.method() === 'PUT' ? 1 : 0,
        inherit: true,
        effective: {
          canRead: true,
          canEdit: true,
          canDownload: true,
          canManageFiles: true,
          canManagePermissions: true,
        },
        grants: [],
      };
    } else if (path.endsWith('/library'))
      json = {
        tenantId: tenant,
        workspaceId: space,
        folderId: null,
        trail: [],
        canMaintain: true,
        maxUploadBytes: 1000000,
        hasMore: false,
        items: [
          {
            id: file,
            tenantId: tenant,
            workspaceId: space,
            workspaceName: '共享空间',
            folderId: null,
            kind: 'DOCUMENT',
            name: '预算.txt',
            version: 1,
            sizeBytes: 10,
            updatedAt: '2026-10-12T00:00:00Z',
            path: ['共享空间', '预算.txt'],
            canMaintain: true,
            canDownload: true,
            canManageFiles: true,
            canManagePermissions: enabled,
          },
        ],
      };
    else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    await route.fulfill({ json });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=${space}`);
  return saves;
}
test('文件权限显示三个内容档位与独立下载，核对后才提交', async ({ page }) => {
  const saves = await fixture(page);
  await page.getByRole('button', { name: '权限设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '权限设置 · 预算.txt' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('添加部门或成员').selectOption(`ACCOUNT:${colleague}`);
  await dialog.getByLabel('内容权限').selectOption('READ');
  await dialog.getByLabel('下载权限').selectOption('DENY');
  await dialog.getByRole('button', { name: '核对并保存' }).click();
  expect(saves).toHaveLength(0);
  await expect(dialog.getByText(/影响该对象及继承它的子目录和文件/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({
    revision: 0,
    inherit: true,
    grants: [{ principalId: colleague, content: 'READ', download: 'DENY', manageFiles: false }],
  });
});
test('未启用企业不出现新版设置入口', async ({ page }) => {
  await fixture(page, false);
  await expect(page.getByText('预算.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '权限设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '当前位置权限' })).toHaveCount(0);
});
test('手机宽度可配置独立范围并取消，不写入权限', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saves = await fixture(page);
  await page.getByRole('button', { name: '权限设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '权限设置 · 预算.txt' });
  await dialog.getByLabel('默认权限').selectOption('false');
  await dialog.getByLabel('添加部门或成员').selectOption(`ACCOUNT:${colleague}`);
  await dialog.getByLabel('内容权限').selectOption('NONE');
  await expect(dialog.getByLabel('明确委派移动、删除资格')).toBeDisabled();
  await dialog.getByRole('button', { name: '核对并保存' }).click();
  await dialog.getByRole('button', { name: '返回核对' }).click();
  expect(saves).toHaveLength(0);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
});

test('移动先展示下载范围变化，确认才提交，独立范围默认保留', async ({ page }) => {
  const moves: Record<string, unknown>[] = [];
  await fixture(page, true, moves);
  await page.getByRole('button', { name: '资料操作 预算.txt' }).click();
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '移动资料 · 预算.txt' });
  await dialog.getByRole('combobox').selectOption(id(6));
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: '预览权限变化' }).click();
  await expect(dialog.getByText('当前独立范围将保留。')).toBeVisible();
  await expect(dialog.getByRole('cell', { name: '销售同事', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: '仅查看 · 不可下载', exact: true })).toBeVisible();
  expect(moves).toHaveLength(0);
  await dialog.getByRole('button', { name: '确认范围并移动' }).click();
  await expect(dialog).toHaveCount(0);
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({
    expectedFingerprint: 'synthetic-preview',
    destinationFolderId: id(6),
    inheritDestination: false,
  });
});
test('取消跨权限移动不发送变更', async ({ page }) => {
  const moves: Record<string, unknown>[] = [];
  await fixture(page, true, moves);
  await page.getByRole('button', { name: '资料操作 预算.txt' }).click();
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '移动资料 · 预算.txt' });
  await dialog.getByRole('combobox').selectOption(id(6));
  await dialog.getByRole('button', { name: '预览权限变化' }).click();
  await dialog.getByRole('button', { name: '取消移动' }).click();
  await expect(dialog).toHaveCount(0);
  expect(moves).toHaveLength(0);
});
