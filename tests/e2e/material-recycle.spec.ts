import { test, expect, type Page } from '@playwright/test';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  workspace = uid(3),
  folder = uid(10),
  material = uid(20);
const url = `/workspace/#tenant=${tenant}&view=library&scope=personal&folder=${folder}`;
const now = '2026-10-04T00:00:00Z',
  deadline = '2099-11-01T00:00:00Z';
const recycled = (n: number, extra = {}) => ({
  id: uid(n),
  kind: 'MATERIAL',
  name: `合成资料${n}.txt`,
  state: 'TRASHED',
  revision: 1,
  trashedAt: now,
  purgeAfter: deadline,
  cleanupJobId: null,
  canPurge: true,
  path: ['个人空间', '原目录'],
  parentAvailable: true,
  ...extra,
});
async function fixture(page: Page, canMaintain = true) {
  const requests: URL[] = [],
    writes: Record<string, unknown>[] = [];
  let deleted = false,
    restored = false,
    loseRestore = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      path = u.pathname;
    requests.push(u);
    let json: unknown;
    if (path === '/api/v1/me')
      json = {
        account: { id: uid(2), phone: '+8619900009001', displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: workspace, name: '个人空间', kind: 'PERSONAL' }],
      };
    else if (path.endsWith('/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic' };
    else if (path.endsWith('/library'))
      json = {
        tenantId: tenant,
        workspaceId: workspace,
        folderId: u.searchParams.get('folder'),
        trail: [{ id: folder, name: '原目录' }],
        canMaintain,
        maxUploadBytes: 1000000,
        hasMore: false,
        items:
          deleted && !restored
            ? []
            : Array.from({ length: 20 }, (_, i) => ({
                id: uid(20 + i),
                tenantId: tenant,
                workspaceId: workspace,
                workspaceName: '个人空间',
                folderId: folder,
                kind: i === 0 ? 'DOCUMENT' : 'FOLDER',
                name: `合成资料${20 + i}.txt`,
                version: i === 0 ? 1 : 0,
                sizeBytes: i === 0 ? 10 : null,
                updatedAt: now,
                path: ['个人空间', '原目录'],
                canMaintain,
              })),
      };
    else if (path.endsWith('/lifecycle')) {
      if (!canMaintain) return route.fulfill({ status: 403, json: { code: 'MATERIAL_READ_ONLY' } });
      json = {
        items:
          u.searchParams.get('view') === 'RECORDS'
            ? [recycled(70, { state: 'PURGING', cleanupJobId: uid(90) })]
            : restored
              ? []
              : u.searchParams.get('query') === '无匹配'
                ? []
                : [
                    recycled(20),
                    recycled(21, { name: '父目录待恢复.txt', canPurge: false, parentAvailable: false }),
                  ],
        hasMore: false,
      };
    } else if (path.endsWith('/lifecycle/cleanup/' + uid(90)))
      json = {
        id: uid(90),
        state: 'FAILED',
        revision: 1,
        attempts: 1,
        errorCode: 'ONLINE_CLEANUP_FAILED',
        originals: 1,
        originalsRemoved: 0,
        completedAt: null,
        backupState: 'NOT_COVERED_BY_ONLINE_CLEANUP',
      };
    else if (path.endsWith('/lifecycle/MATERIAL/' + material)) {
      if (request.method() === 'GET')
        json = {
          item: recycled(20, { state: deleted ? 'TRASHED' : 'ACTIVE', revision: deleted ? 1 : 0 }),
          documents: 1,
          versions: 1,
          folders: 0,
          restoration: 'CURRENT_PERMISSIONS_NO_TASK_RESTART',
        };
      else {
        const body = request.postDataJSON();
        writes.push(body);
        expect(request.headers()['x-csrf-token']).toBe('synthetic');
        if (body.action === 'TRASH') deleted = true;
        else if (body.action === 'RESTORE') {
          restored = true;
          if (loseRestore) {
            loseRestore = false;
            return route.abort('failed');
          }
        }
        json = {
          objectId: material,
          kind: 'MATERIAL',
          action: body.action,
          resultingState: body.action === 'TRASH' ? 'TRASHED' : 'ACTIVE',
          revision: body.action === 'TRASH' ? 1 : 2,
          occurredAt: now,
          purgeAfter: body.action === 'TRASH' ? deadline : null,
          cleanupJobId: null,
        };
      }
    } else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    return route.fulfill({ json });
  });
  return {
    requests,
    writes,
    loseRestore: () => {
      loseRestore = true;
    },
  };
}
test('资料回收站在资料库页面内，删除确认和直接恢复保留原目录与搜索布局', async ({ page }) => {
  const f = await fixture(page);
  await page.goto(url);
  await page.getByRole('searchbox', { name: '搜索资料名称或正文' }).fill('合成');
  await page.getByRole('button', { name: '搜索资料', exact: true }).click();
  await expect(page.locator('.material-entry')).toHaveCount(20);
  await page.locator('.access-content').evaluate((n) => {
    n.scrollTop = 300;
  });
  await expect.poll(() => page.locator('.access-content').evaluate((n) => n.scrollTop)).toBe(300);
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.getByLabel('资料回收站', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回资料库', exact: true }).click();
  await expect.poll(() => page.locator('.access-content').evaluate((n) => n.scrollTop)).toBe(300);
  await page.locator('.access-content').evaluate((n) => {
    n.scrollTop = 0;
  });
  await page.getByRole('button', { name: '资料操作 合成资料20.txt', exact: true }).click();
  await page
    .getByRole('dialog', { name: '资料操作 合成资料20.txt' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '删除资料', exact: true });
  await expect(dialog).toContainText('停止读取和任务使用');
  expect(f.writes).toHaveLength(0);
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(f.writes[0]).toMatchObject({ action: 'TRASH', expectedRevision: 0 });
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page).toHaveURL(/folder=.*&recycle=trash$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const recycle = page.getByLabel('资料回收站', { exact: true });
  await expect(recycle.locator('.recycle-entries')).toHaveClass(/list/);
  await expect(recycle).toContainText('原位置');
  await page.screenshot({ path: '.local/material-recycle-list-synthetic.png' });
  await expect(page.getByRole('button', { name: '上传资料', exact: true })).toHaveCount(0);
  const blocked = recycle.getByRole('article', { name: '文件 父目录待恢复.txt' });
  await expect(blocked.getByRole('button', { name: '恢复', exact: true })).toBeDisabled();
  await expect(blocked).toContainText('请先恢复原文件夹');
  await expect(blocked.getByRole('button', { name: /更多操作/ })).toHaveCount(0);
  await recycle.getByRole('button', { name: '更多操作 合成资料20.txt', exact: true }).click();
  await page
    .getByRole('dialog', { name: '更多操作 合成资料20.txt' })
    .getByRole('button', { name: '彻底删除', exact: true })
    .click();
  const purge = page.getByRole('dialog', { name: '彻底删除', exact: true });
  await expect(purge).toContainText('无法恢复');
  expect(f.writes).toHaveLength(1);
  await purge.getByRole('button', { name: '取消', exact: true }).click();
  await expect(purge).toHaveCount(0);
  await recycle
    .getByRole('article', { name: '文件 合成资料20.txt' })
    .getByRole('button', { name: '恢复', exact: true })
    .click();
  await expect(recycle).toContainText('回收站为空');
  await expect(recycle.getByRole('button', { name: '上一页', exact: true })).toHaveCount(0);
  expect(f.writes[1]).toMatchObject({ action: 'RESTORE', expectedRevision: 1 });
  await page.getByRole('button', { name: '返回资料库', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folder}$`));
  await expect(page.getByRole('searchbox', { name: '搜索资料名称或正文' })).toHaveValue('合成');
  await expect(page.locator('.material-entries')).toHaveClass(/cards/);
  await expect(page.locator('.material-entry')).toHaveCount(20);
});
test('回收站响应丢失时保留同一次恢复请求，删除记录、搜索和移动端不溢出', async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 841 });
  await page.goto(url + '&recycle=trash');
  const row = page.getByRole('article', { name: '文件 合成资料20.txt' });
  f.loseRestore();
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(row.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回资料库', exact: true })).toBeDisabled();
  await expect(page.getByRole('searchbox', { name: '搜索回收站', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: '重试恢复', exact: true }).click();
  await expect(page.getByText('回收站为空', { exact: true })).toBeVisible();
  expect(f.writes[1]).toEqual(f.writes[0]);
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page).toHaveURL(/recycle=records$/);
  await page.getByText('清理详情', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ONLINE_CLEANUP_FAILED');
  await expect(page.getByRole('button', { name: '重试清理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  await expect(page.locator('.recycle-entries')).toHaveClass(/cards/);
  expect(await page.locator('.library-page').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.getByRole('searchbox', { name: '搜索删除记录', exact: true }).fill('无匹配');
  await page.getByRole('button', { name: '搜索删除记录', exact: true }).click();
  await expect
    .poll(
      () =>
        f.requests.filter(
          (u) =>
            u.pathname.endsWith('/lifecycle') &&
            u.searchParams.get('query') === '无匹配' &&
            u.searchParams.get('view') === 'RECORDS',
        ).length,
    )
    .toBeGreaterThan(0);
});
test('无维护权限时隐藏删除入口，直接打开回收站也由服务端拒绝', async ({ page }) => {
  await fixture(page, false);
  await page.goto(url);
  await expect(page.locator('.material-entry')).toHaveCount(20);
  await expect(page.getByRole('button', { name: /^资料操作/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '回收站', exact: true })).toHaveCount(0);
  await page.goto(url + '&recycle=trash');
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toHaveCount(0);
});
