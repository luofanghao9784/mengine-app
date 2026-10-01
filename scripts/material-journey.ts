import { attentionJourney } from './attention-journey.ts';
import { experienceJourney } from './experience-journey.ts';
import { lifecycleJourney } from './lifecycle-journey.ts';
import { sourceJourney } from './source-journey.ts';
import { batchUploadJourney } from './batch-upload-journey.ts';
/** Optional M2-C1 extension to the owned M2-B4 fixture; exercises actual file and permission UI. */
import assert from 'node:assert/strict';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export async function materialJourney({
  tenant,
  memberContext,
  adminContext,
  memberEmail,
  space,
  artifacts,
}: {
  tenant: string;
  memberContext: BrowserContext;
  adminContext: BrowserContext;
  memberEmail: string;
  space: string;
  artifacts: string;
}) {
  await mkdir(artifacts, { recursive: true });
  const client = await memberContext.newPage(),
    manager = await adminContext.newPage();
  const errors: string[] = [];
  for (const page of [client, manager]) page.on('pageerror', (e) => errors.push(e.name));
  const location = (scope = 'personal', folder?: string) =>
    '/workspace/#' + new URLSearchParams({ tenant, view: 'library', scope, ...(folder ? { folder } : {}) });
  const context = await (await memberContext.request.get(`/api/v1/tenants/${tenant}/context`)).json();
  const personal = context.workspaces.find((w: { kind: string }) => w.kind === 'PERSONAL').id;
  await batchUploadJourney(client, memberContext.request, tenant, personal, artifacts);
  await sourceJourney(client, memberContext.request, tenant, personal, artifacts);
  await lifecycleJourney(client, memberContext.request, tenant, personal, artifacts);
  await experienceJourney(client, memberContext.request, tenant, personal, artifacts);
  await attentionJourney(client, memberContext.request, tenant, personal, artifacts);
  const base = (workspace: string) => `/api/v1/tenants/${tenant}/workspaces/${workspace}`;
  const payload = (name: string, content: string) => ({
    name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(content),
  });
  const original = 'M2-C1 合成自用资料\n上传、下载、历史版本验证。\n';
  const updated = 'M2-C1 合成自用资料\n更新后的第二版；原版仍可下载。\n';
  async function upload(name: string, content: string) {
    await client.getByRole('button', { name: '上传资料', exact: true }).click();
    await client.getByLabel(/^选择文件/).setInputFiles(payload(name, content));
    // Native picker focus must not tear down the selected file or its form.
    await client.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() =>
        client.getByLabel(/^选择文件/).evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
      )
      .toBe(name);
    await client.getByRole('button', { name: '保存原文件', exact: true }).click();
    await expect(client.getByRole('dialog')).toHaveCount(0);
    await expect(client.locator('.material-entry').filter({ hasText: name })).toHaveCount(1);
  }
  async function saveVersion(number: number, expected: string) {
    const downloadEvent = client.waitForEvent('download');
    await client.getByRole('button', { name: `下载 v${number}`, exact: true }).click();
    const downloaded = await downloadEvent;
    assert.equal(await downloaded.failure(), null);
    const path = join(artifacts, `synthetic-v${number}.txt`);
    await downloaded.saveAs(path);
    assert.equal(await readFile(path, 'utf8'), expected);
  }
  await client.goto(location());
  await expect(client.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
  await client.getByRole('button', { name: '资料操作', exact: true }).click();
  await client.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await client.getByLabel('文件夹名称').fill('开发草稿');
  await client.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await expect(client.getByRole('dialog')).toHaveCount(0);
  await client.locator('.material-entry').filter({ hasText: '开发草稿' }).click();
  await expect(client.locator('.material-crumbs')).toContainText('开发草稿');
  await upload('自用进展.md', original);
  const folder = new URLSearchParams(new URL(client.url()).hash.slice(1)).get('folder')!;
  await client.reload();
  await expect(client.locator('.material-entry')).toContainText('自用进展.md');
  await client.locator('.material-entry').filter({ hasText: '自用进展.md' }).click();
  await expect(client.getByRole('tab', { name: '正文', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await client.getByRole('tab', { name: '历史版本', exact: true }).click();
  await client.getByRole('button', { name: '上传新版本', exact: true }).click();
  await client.getByLabel(/^选择文件/).setInputFiles(payload('自用进展修订.md', updated));
  await client.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(client.getByLabel(/^选择文件/)).toBeVisible();
  await client.getByRole('dialog').getByRole('button', { name: '上传新版本', exact: true }).click();
  await expect(client.getByRole('button', { name: '下载 v2', exact: true })).toBeVisible();
  await saveVersion(1, original);
  await saveVersion(2, updated);
  await client.screenshot({ path: join(artifacts, 'versions-desktop.png'), fullPage: true });
  await client.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const list = await (await memberContext.request.get(base(personal) + `/library?folder=${folder}`)).json();
  const material = list.items.find((i: { name: string }) => i.name === '自用进展.md').id;
  const details = await (await memberContext.request.get(base(personal) + `/materials/${material}`)).json();
  const version = details.versions.find((v: { number: number }) => v.number === 1);
  assert.equal(version.sha256, createHash('sha256').update(original).digest('hex'));
  const privateDownload = base(personal) + `/materials/${material}/versions/${version.id}/download`;
  assert.equal((await adminContext.request.get(privateDownload)).status(), 404);
  await client.getByRole('button', { name: '企业资料库', exact: true }).first().click();
  await expect(client.locator('.material-space-card')).toContainText('企业 B 共享资料');
  await expect(client.locator('.material-entry').filter({ hasText: '自用进展' })).toHaveCount(0);
  await client.locator('.material-space-card').filter({ hasText: '企业 B 共享资料' }).click();
  await expect(client.locator('.material-caption')).toContainText('只读');
  await expect(client.getByRole('button', { name: '上传资料', exact: true })).toHaveCount(0);
  await manager.goto('/tenant-admin/#tenant=' + tenant);
  await manager.getByRole('button', { name: '共享空间', exact: true }).click();
  await manager.getByRole('button', { name: '管理空间 企业 B 共享资料', exact: true }).click();
  const memberRow = () => manager.locator('.tenant-grants > li').filter({ hasText: memberEmail });
  await expect(memberRow()).toContainText('只读');
  await memberRow().getByRole('button', { name: '允许维护', exact: true }).click();
  await manager.getByRole('button', { name: '确认允许维护', exact: true }).click();
  await expect(memberRow()).toContainText('可维护');
  await client.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(client.getByRole('button', { name: '上传资料', exact: true })).toBeVisible();
  // A response lost after the server commits must remain one material after explicit retry.
  await client.route('**/materials', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await client.getByRole('button', { name: '上传资料', exact: true }).click();
  await client
    .getByLabel(/^选择文件/)
    .setInputFiles(payload('企业资料说明.md', '合成共享资料；已明确授予维护权限。'));
  await client.getByRole('button', { name: '保存原文件', exact: true }).click();
  await expect(client.getByRole('button', { name: '重试本次上传', exact: true })).toBeVisible();
  await client.unrouteAll();
  await client.getByRole('button', { name: '重试本次上传', exact: true }).click();
  await expect(client.getByRole('dialog')).toHaveCount(0);
  await expect(client.locator('.material-entry').filter({ hasText: '企业资料说明.md' })).toHaveCount(1);
  const sharedList = await (await memberContext.request.get(base(space) + '/library')).json();
  assert.equal(sharedList.items.filter((x: { name: string }) => x.name === '企业资料说明.md').length, 1);
  const sharedDoc = sharedList.items.find((x: { name: string }) => x.name === '企业资料说明.md');
  const sharedDetails = await (
    await memberContext.request.get(base(space) + `/materials/${sharedDoc.id}`)
  ).json();
  const sharedDownload =
    base(space) + `/materials/${sharedDoc.id}/versions/${sharedDetails.versions[0].id}/download`;
  await memberRow().getByRole('button', { name: '设为只读', exact: true }).click();
  await manager.getByRole('button', { name: '确认设为只读', exact: true }).click();
  await expect(memberRow()).toContainText('只读');
  await client.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(client.getByRole('button', { name: '上传资料', exact: true })).toHaveCount(0);
  assert.equal((await memberContext.request.get(sharedDownload)).status(), 200);
  await memberRow().getByRole('button', { name: '撤销授权', exact: true }).click();
  await manager.getByRole('button', { name: '确认撤销授权', exact: true }).click();
  await expect(manager.getByRole('heading', { name: '还没有授权成员', exact: true })).toBeVisible();
  await client.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(client.getByRole('heading', { name: '此位置暂不可用', exact: true })).toBeVisible();
  assert.equal((await memberContext.request.get(sharedDownload)).status(), 404);
  assert.equal((await memberContext.request.get(privateDownload)).status(), 200);
  // Restore explicit grants for the retained trial fixture; no self-grant or admin promotion.
  await manager.getByRole('button', { name: '添加成员', exact: true }).click();
  await manager.getByLabel('搜索授权成员').fill(memberEmail);
  await manager.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await expect(manager.locator('.tenant-grants > li')).toHaveCount(1);
  await manager.getByRole('button', { name: '选择', exact: true }).click();
  await manager.getByRole('button', { name: '确认添加', exact: true }).click();
  await memberRow().getByRole('button', { name: '允许维护', exact: true }).click();
  await manager.getByRole('button', { name: '确认允许维护', exact: true }).click();
  await expect(memberRow()).toContainText('可维护');
  await manager.screenshot({ path: join(artifacts, 'maintenance-desktop.png'), fullPage: true });
  await client.goto(location('personal', folder));
  await expect(client.locator('.material-entry')).toContainText('自用进展.md');
  await client.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(client.locator('.material-entries.list')).toBeVisible();
  await client.getByRole('button', { name: '卡片视图', exact: true }).click();
  await client.screenshot({ path: join(artifacts, 'library-desktop.png'), fullPage: true });
  await client.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await client
      .getByRole('heading', { name: '资料库', exact: true })
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await client.screenshot({ path: join(artifacts, 'library-mobile.png'), fullPage: true });
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await client.locator('.material-entry').filter({ hasText: '自用进展.md' }).click();
  await expect(client.getByRole('tab', { name: '正文', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await client.getByRole('tab', { name: '历史版本', exact: true }).click();
  await expect(client.getByRole('button', { name: '下载 v2', exact: true })).toBeVisible();
  await client.screenshot({ path: join(artifacts, 'versions-mobile.png'), fullPage: true });
  assert.ok(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await client.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  return async () => {
    // Same cookies and fixed version URI continue to work after the entire runtime is restarted.
    const response = await memberContext.request.get(privateDownload);
    assert.equal(response.status(), 200);
    assert.equal(await response.text(), original);
    assert.equal((await memberContext.request.get(sharedDownload)).status(), 200);
    await client.reload();
    await expect(client.locator('.material-entry')).toContainText('自用进展.md');
    await client.route('**/library?*', (route) => route.abort());
    await client.getByLabel('搜索资料名称').fill('自用');
    await client.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(client.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
    await expect(client.locator('.material-entry')).toHaveCount(0);
    await client.unrouteAll();
    await client.getByRole('button', { name: '重试', exact: true }).click();
    await expect(client.locator('.material-entry')).toContainText('自用进展.md');
    assert.deepEqual(errors, []);
    await client.close();
    await manager.close();
  };
}
