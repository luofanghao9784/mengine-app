import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  workspace = uid(3),
  documentId = uid(20);
const home = `/workspace/#tenant=${tenant}&view=library&scope=personal`;
const now = '2026-10-04T00:00:00Z';
async function fixture(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const versions = [{ number: 1, title: '合成文稿', body: '原始合成正文', createdAt: now }];
  const writes: Record<string, unknown>[] = [],
    exports: string[] = [];
  const receipts = new Map<string, unknown>();
  let lost = false,
    denied = false,
    publications = 0;
  const detail = (number = versions.length) => ({
    document: {
      id: documentId,
      tenantId: tenant,
      workspaceId: workspace,
      sourceWorkspaceId: workspace,
      conversationId: uid(30),
      taskId: uid(31),
      artifactId: null,
      revision: versions.length,
      title: versions.at(-1)!.title,
      updatedAt: now,
    },
    version: versions[number - 1],
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname;
    let json: unknown;
    if (path === '/api/v1/me')
      json = {
        account: { id: account, phone: '+8619900009001', displayName: '合成成员' },
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
        folderId: null,
        trail: [],
        canMaintain: true,
        maxUploadBytes: 1000000,
        hasMore: false,
        items: [
          {
            id: documentId,
            tenantId: tenant,
            workspaceId: workspace,
            workspaceName: '个人空间',
            folderId: null,
            kind: 'DRAFT',
            name: '合成文稿',
            version: versions.length,
            sizeBytes: 10,
            updatedAt: now,
            path: ['个人空间'],
            canMaintain: true,
          },
        ],
      };
    else if (path.endsWith(`/documents/${documentId}`)) {
      if (denied) return route.fulfill({ status: 403, json: { code: 'DOCUMENT_ACCESS_DENIED' } });
      json = detail(Number(u.searchParams.get('version')) || undefined);
    } else if (path.endsWith(`/documents/${documentId}/versions`)) {
      const body = req.postDataJSON();
      writes.push(body);
      if (denied) return route.fulfill({ status: 403, json: { code: 'DOCUMENT_ACCESS_DENIED' } });
      if (!receipts.has(body.requestId)) {
        if (body.expectedRevision !== versions.length)
          return route.fulfill({
            status: 409,
            json: { contractVersion: '1.0', code: 'DOCUMENT_REVISION_CONFLICT' },
          });
        versions.push({ number: versions.length + 1, title: body.title, body: body.body, createdAt: now });
        receipts.set(body.requestId, detail());
      }
      if (lost) {
        lost = false;
        return route.abort('failed');
      }
      json = receipts.get(body.requestId);
    } else if (path.endsWith('/publications')) {
      if (req.method() === 'POST') publications++;
      json = { tenantId: tenant, documentId, items: [], hasMore: false };
    } else if (path.includes('/exports/')) {
      exports.push(path);
      const bytes = Buffer.from('synthetic exported document');
      return route.fulfill({
        body: bytes,
        headers: {
          'content-type': path.endsWith('/pdf')
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-length': String(bytes.length),
          'content-disposition': 'attachment; filename="synthetic.pdf"',
          'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
        },
      });
    } else return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
    return route.fulfill({ json });
  });
  await page.goto(home);
  await page.locator('.material-entry').click();
  await expect(page.locator('.document-card-surface .document-text')).toContainText('原始合成正文');
  // Native dialog opening precedes the deck's ResizeObserver centering pass.
  await expect
    .poll(() =>
      page.locator('.document-card-surface').evaluate((el) => {
        const card = el.querySelector('.deck-conversation')!.getBoundingClientRect();
        const rail = el.querySelector('.deck-scroller')!.getBoundingClientRect();
        return Math.abs(card.x + card.width / 2 - rail.x - rail.width / 2);
      }),
    )
    .toBeLessThan(1);
  return {
    versions,
    writes,
    exports,
    lose: () => {
      lost = true;
    },
    revoke: () => {
      denied = true;
    },
    concurrent: () =>
      versions.push({
        number: versions.length + 1,
        title: '其他设备版本',
        body: '其他设备的正文',
        createdAt: now,
      }),
    publications: () => publications,
  };
}
test('标题和正文原位编辑，保存后同卡阅读；窄屏操作不溢出', async ({ page }) => {
  const state = await fixture(page);
  const reader = page.locator('.document-card-surface .live-source-reader');
  const before = await reader.boundingBox();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const after = await reader.boundingBox();
  expect(after).toEqual(before);
  await expect(page.getByText('文稿正文', { exact: true })).toHaveCount(0);
  await expect(page.locator('.document-editor')).toHaveCount(0);
  await page.getByLabel('文稿标题').fill('修改后的合成文稿');
  await page.getByLabel('文稿正文').fill('修改后的合成正文');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.document-card-surface .document-text')).toHaveText('修改后的合成正文');
  await expect(page.getByLabel('文稿正文')).toHaveCount(0);
  expect(state.versions).toHaveLength(2);
  expect(state.publications()).toBe(0);
  await page.getByRole('button', { name: '资料属性', exact: true }).click();
  await expect(page.locator('.document-card-metadata')).toContainText('v2');
  await page.getByRole('button', { name: '关闭资料属性', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 841 });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  expect(
    await page.locator('.live-card-actions').evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
  ).toBe(true);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
});
test('未保存修改关闭先确认，刷新恢复草稿，放弃才清除', async ({ page }) => {
  const state = await fixture(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文稿正文').fill('尚未保存的合成草稿');
  await page.getByRole('button', { name: '关闭资料阅读', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '有未保存的修改', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByLabel('文稿正文')).toBeEditable();
  expect(await page.locator('.document-card-surface .live-conversations').evaluate((el) => el.inert)).toBe(
    false,
  );
  await page.reload();
  await page.locator('.material-entry').click();
  await expect(page.getByLabel('文稿正文')).toHaveValue('尚未保存的合成草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('.document-text')).toHaveText('原始合成正文');
  expect(state.writes).toHaveLength(0);
});
test('长正文沿用外层阅读滚动区，模式切换保留阅读位置', async ({ page }) => {
  const state = await fixture(page);
  state.versions[0].body = Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 段合成正文`).join('\n');
  await page.reload();
  await page.locator('.material-entry').click();
  const reader = page.locator('.document-card-surface .live-source-reader');
  await expect.poll(() => reader.evaluate((el) => el.scrollHeight)).toBeGreaterThan(1500);
  await reader.evaluate((el) => {
    el.scrollTop = 180;
  });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeCloseTo(180, 0);
  expect(
    await page.getByLabel('文稿正文').evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(1500);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeCloseTo(180, 0);
});
test('保存回包丢失后保留请求，重试不产生重复版本', async ({ page }) => {
  const state = await fixture(page);
  state.lose();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文稿正文').fill('幂等重试合成正文');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeEnabled();
  await expect(page.getByLabel('文稿正文')).toBeDisabled();
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.locator('.document-text')).toHaveText('幂等重试合成正文');
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.versions).toHaveLength(2);
});
test('版本冲突保留草稿且可核对最新正文，历史版本只读', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文稿正文').fill('本设备未保存正文');
  state.concurrent();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByLabel('文稿正文')).toHaveValue('本设备未保存正文');
  await page.getByRole('button', { name: '核对最新内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '最新版本 v2', exact: true })).toContainText(
    '其他设备的正文',
  );
  await page.getByRole('button', { name: '返回编辑', exact: true }).click();
  await page.getByRole('button', { name: '载入最新版本', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('.document-text')).toHaveText('其他设备的正文');
  await page.getByRole('button', { name: '资料属性', exact: true }).click();
  await page.getByRole('button', { name: '上一版本', exact: true }).click();
  await expect(page.locator('.document-text')).toHaveText('原始合成正文');
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
  expect(state.versions).toHaveLength(2);
});
test('导出前显式保存，导出新版本，发布入口仅菜单内一处', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文稿正文').fill('待导出的合成正文');
  await page.getByRole('button', { name: '更多资料操作', exact: true }).click();
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '保存修改后继续', exact: true })).toBeVisible();
  expect(state.exports).toHaveLength(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存并继续', exact: true }).click();
  await downloaded;
  expect(state.exports).toHaveLength(1);
  expect(state.exports[0]).toContain('/versions/2/exports/pdf');
  await page.getByRole('button', { name: '资料属性', exact: true }).click();
  await expect(page.getByRole('button', { name: '发布到企业资料库', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '更多资料操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '发布到企业资料库', exact: true })).toHaveCount(1);
  expect(state.publications()).toBe(0);
});
test('服务端撤权移除正文及编辑草稿', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('文稿正文').fill('不可保留的合成正文');
  state.revoke();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByLabel('文稿正文')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem(
        `dreamcore:document:${'00000000-0000-4000-8000-000000000002'}:${'00000000-0000-4000-8000-000000000001'}:${'00000000-0000-4000-8000-000000000020'}`,
      ),
    ),
  ).toBeNull();
});
