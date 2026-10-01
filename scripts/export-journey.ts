/** Caller owns isolated DB/runtime, an authenticated session with explicit BULK_EXPORT and a
 * synthetic versioned private document. entryUrl must be the real /workspace route containing
 * ExportBatchPanel, selected by the integration owner; no fixture or Demo may be supplied. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ExportBatch } from '../contracts/public-api/export.ts';
type ProbeWindow = Window & {
  __exportProbe?: { armed: boolean; suffix: string; keys: string[]; status: number | null; receipt: unknown };
};
export async function exportJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  documentId: string,
  artifacts: string,
  entryUrl: string,
) {
  assert.match(entryUrl, /^\/workspace\//, 'Use the actual workspace entry, not a synthetic fixture');
  const root = `/api/v1/tenants/${tenant}/export-batches`,
    docRoot = `/api/v1/tenants/${tenant}/documents/${documentId}`;
  const response = await request.get(docRoot + '?version=1');
  assert.equal(response.status(), 200);
  const doc = await response.json();
  assert.equal(doc.document.workspaceId, workspace);
  const options = await request.get(
    root + `/options?workspaceId=${workspace}&scope=PRIVATE&objectId=${documentId}&format=docx`,
  );
  assert.equal(options.status(), 200);
  assert.equal(
    (await options.json()).canExport,
    true,
    'Fixture must explicitly grant bulk export capability',
  );
  const capture: { armed: boolean; suffix: string; keys: string[]; status: number | null; receipt: unknown } =
    { armed: false, suffix: '/export-batches', keys: [], status: null, receipt: null };
  const pattern = '**' + root + '**';
  await page.route(pattern, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith(capture.suffix))
      return route.continue();
    capture.keys.push(request.postDataJSON().requestId);
    const response = await route.fetch();
    if (capture.armed) {
      capture.armed = false;
      capture.status = response.status();
      capture.receipt = await response.json();
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  const arm = async (suffix: string) =>
    Object.assign(capture, { armed: true, suffix, keys: [], status: null, receipt: null });
  const probe = async () => ({ keys: [...capture.keys], status: capture.status, receipt: capture.receipt });
  try {
    await page.goto(entryUrl);
    const panel = page.locator(
      `.export-panel[data-export-scope="PRIVATE"][data-workspace-id="${workspace}"]`,
    );
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '选择成果并导出', exact: true }).click();
    const row = panel.locator('.export-choices li').filter({ hasText: doc.document.title });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: '选择历史版本', exact: true }).click();
    await panel.locator('.export-choices li').filter({ hasText: '版本 1 ·' }).getByRole('checkbox').check();
    await panel.getByLabel('临时包有效期', { exact: true }).selectOption('1');
    await arm('/export-batches');
    await panel.getByRole('button', { name: '生成所选版本的临时包', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(panel.getByRole('button', { name: '收起选择', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('临时包有效期', { exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '重试同次导出请求', exact: true }).click();
    await expect(panel.locator('.export-detail')).toContainText('所选项全部生成', { timeout: 30000 });
    await expect(panel.locator('.export-history')).toContainText('所选项全部生成');
    const accepted = await probe();
    assert.equal(accepted.status, 201);
    assert.equal(accepted.keys.length, 2);
    assert.equal(accepted.keys[0], accepted.keys[1]);
    const batch = accepted.receipt as ExportBatch;
    assert.equal(batch.items.length, 1);
    assert.deepEqual(batch.items[0].selection, { objectId: documentId, version: 1, format: 'docx' });
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: '下载 ZIP 与清单', exact: true }).click();
    const file = await download;
    assert.equal(file.suggestedFilename(), `dreamcore-export-${batch.id}.zip`);
    const path = join(artifacts, 'real-batch-export.zip');
    await file.saveAs(path);
    const inspected = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `import sys,json,zipfile,io,hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('_export-manifest.json'))
 files=[n for n in z.namelist() if n.endswith('.docx')]
 assert len(files)==1
 with zipfile.ZipFile(io.BytesIO(z.read(files[0]))) as d:
  xml=d.read('word/document.xml').decode('utf-8')
 print(json.dumps({'batchId':m['batchId'],'complete':m['complete'],'items':m['items'],'hasDocumentXml':bool(xml),'entries':z.namelist()}))`,
          path,
        ],
        { encoding: 'utf8' },
      ),
    );
    assert.equal(inspected.batchId, batch.id);
    assert.equal(inspected.complete, true);
    assert.equal(inspected.items[0].selection.version, 1);
    assert.equal(inspected.hasDocumentXml, true);
    assert.equal(inspected.entries.length, 2);
    await page.screenshot({ path: join(artifacts, 'export-batch-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'export-batch-mobile.png'), fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    );
    await arm('/' + batch.id);
    await panel.getByRole('button', { name: '提前移除临时包', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(panel.getByRole('button', { name: '选择成果并导出', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '重试同次批次操作', exact: true }).click();
    await expect(panel.locator('.export-cleanup')).toContainText('在线临时包已清理', { timeout: 30000 });
    const removed = await probe();
    assert.equal(removed.status, 200);
    assert.equal(removed.keys.length, 2);
    assert.equal(removed.keys[0], removed.keys[1]);
    const finalResponse = await request.get(root + '/' + batch.id);
    assert.equal(finalResponse.status(), 200);
    const final = (await finalResponse.json()) as ExportBatch;
    assert.equal(final.state, 'REMOVED');
    assert.equal(final.cleanup.state, 'COMPLETE');
    assert.ok(final.cleanup.removedBytes > 0);
    assert.equal(final.canDownload, false);
    const gone = await request.get(root + '/' + batch.id + '/archive');
    assert.equal(gone.status(), 410);
    assert.equal((await gone.json()).contractVersion, '1.0');
    assert.equal((await request.get(docRoot + '?version=1')).status(), 200);
    await page.screenshot({ path: join(artifacts, 'export-batch-cleaned.png'), fullPage: true });
    return {
      batchId: batch.id,
      selectedVersion: 1,
      archiveEntries: inspected.entries.length,
      cleanup: final.cleanup.state,
      removedBytes: final.cleanup.removedBytes,
      retries: 'same-key',
    };
  } finally {
    await page.unroute(pattern);
  }
}
