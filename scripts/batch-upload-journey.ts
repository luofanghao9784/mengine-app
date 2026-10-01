/** Real /workspace UI + platform API; only response loss and in-flight delay are injected. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, type Page, type APIRequestContext } from '@playwright/test';

// CDP omits disk-backed File bytes from intercepted multipart postDataEntries.
// Keep native browser uploads intact and inject loss only after the real response.
type TransportProbe = {
  keys: string[];
  firstStatus: number | null;
  firstReceipt: any;
  errors: string[];
  release?: () => void;
  restore: () => void;
};
type ProbeWindow = Window & { __batchTransportProbe?: TransportProbe; __batchNativeFetch?: typeof fetch; __batchIntercept?: typeof fetch };
async function installProbe(page: Page, mode: 'loss' | 'hold') {
  await page.evaluate((mode) => {
    const windowWithProbe = window as ProbeWindow;
    windowWithProbe.__batchTransportProbe?.release?.();
    windowWithProbe.__batchTransportProbe?.restore();
    const original = windowWithProbe.__batchNativeFetch!;
    const probe: TransportProbe = {
      keys: [],
      firstStatus: null,
      firstReceipt: null,
      errors: [],
      restore: () => {
        delete windowWithProbe.__batchIntercept;
      },
    };
    windowWithProbe.__batchTransportProbe = probe;
    windowWithProbe.__batchIntercept = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      if (init?.method !== 'POST' || !url.pathname.endsWith('/materials')) return original(input, init);
      const index = probe.keys.length;
      probe.keys.push('');
      const metadata = init.body instanceof FormData ? init.body.get('metadata') : null;
      try {
        if (!(metadata instanceof Blob)) probe.errors.push('Upload metadata was not a JSON Blob');
        else probe.keys[index] = JSON.parse(await metadata.text()).requestId || '';
      } catch {
        probe.errors.push('Upload metadata could not be read');
      }
      const response = await original(input, init);
      if (index === 0) {
        probe.firstStatus = response.status;
        probe.firstReceipt = await response
          .clone()
          .json()
          .catch(() => null);
        if (mode === 'loss') throw new TypeError('Synthetic response loss after native upload');
        await new Promise<void>((resolve) => {
          probe.release = resolve;
        });
      }
      return response;
    };
  }, mode);
}
async function readProbe(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__batchTransportProbe!;
    return {
      keys: probe.keys,
      status: probe.firstStatus,
      receipt: probe.firstReceipt,
      errors: probe.errors,
      held: !!probe.release,
    };
  });
}
async function restoreProbe(page: Page) {
  await page
    .evaluate(() => {
      const windowWithProbe = window as ProbeWindow;
      windowWithProbe.__batchTransportProbe?.release?.();
      windowWithProbe.__batchTransportProbe?.restore();
      delete windowWithProbe.__batchTransportProbe;
    })
    .catch(() => {});
}

export async function batchUploadJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const scratch = await mkdtemp(join(tmpdir(), 'dreamcore-batch-ui-'));
  const directory = join(scratch, '授权资料');
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}`;
  const list = async (folder?: string) => {
    const response = await request.get(root + '/library' + (folder ? `?folder=${folder}` : ''));
    assert.equal(response.status(), 200);
    return await response.json();
  };
  const row = (filename: string) => page.locator('.batch-file').filter({ hasText: filename });
  const payload = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('合成文件') });
  try {
    await mkdir(join(directory, '分部'), { recursive: true });
    await writeFile(join(directory, '一.txt'), '本次授权原件一');
    await writeFile(join(directory, '分部', '二.txt'), '本次授权原件二');
    await writeFile(join(directory, '待人工处理.custom'), '不支持解析但可保留原件');
    await page.addInitScript(() => {
      const w = window as ProbeWindow;
      const nativeFetch = window.fetch.bind(window);
      w.__batchNativeFetch = nativeFetch;
      window.fetch = (input, init) => (w.__batchIntercept ?? nativeFetch)(input, init);
    });
    await page.goto(`/workspace/#tenant=${tenant}&view=library&scope=personal`);
    await page.getByRole('button', { name: '批量上传', exact: true }).click();
    await page.getByLabel('新批次文件夹', { exact: true }).fill('批量授权验收');
    await page.getByLabel('选择授权目录', { exact: true }).setInputFiles(directory);
    await expect(page.locator('.batch-file')).toHaveCount(3);
    await expect(row('分部/二.txt')).toBeVisible();
    await expect(row('待人工处理.custom')).toContainText('暂不支持自动解析');
    assert.equal(
      (await list()).items.some((v: { name: string }) => v.name === '批量授权验收'),
      false,
      'preview must not create server data',
    );
    await row('待人工处理.custom').getByRole('checkbox').uncheck();
    await expect(page.getByRole('button', { name: '确认上传 2 个文件', exact: true })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.batch-file')).toHaveCount(3);
    await page.screenshot({ path: join(artifacts, 'batch-preview-desktop.png'), fullPage: true });
    await installProbe(page, 'loss');
    await page.getByRole('button', { name: '确认上传 2 个文件', exact: true }).click();
    await expect.poll(async () => (await readProbe(page)).status).not.toBeNull();
    const initial = await readProbe(page);
    assert.equal(
      initial.status,
      201,
      `Native multipart upload failed: ${initial.receipt?.code || 'no response code'}`,
    );
    await expect(page.getByRole('button', { name: '仅重试 1 个未完成文件', exact: true })).toBeVisible();
    await expect(page.locator('.batch-file.succeeded')).toHaveCount(1);
    await expect(page.locator('.batch-file.uncertain')).toHaveCount(1);
    const received = await readProbe(page);
    assert.deepEqual(received.errors, []);
    assert.equal(received.keys.length, 2);
    assert.ok(received.keys.every(Boolean));
    const firstReceipt = received.receipt;
    const csrf = await (await request.get('/api/v1/auth/csrf')).json();
    const update = await request.post(root + `/materials/${firstReceipt.id}/versions`, {
      headers: { [csrf.headerName]: csrf.token },
      multipart: {
        metadata: {
          name: 'metadata.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ requestId: randomUUID(), expectedVersion: 1 })),
        },
        file: {
          name: firstReceipt.acceptedVersion.filename,
          mimeType: 'text/plain',
          buffer: Buffer.from('稍后的独立版本二'),
        },
      },
    });
    assert.equal(update.status(), 201);
    await page.getByRole('button', { name: '仅重试 1 个未完成文件', exact: true }).click();
    await expect(page.locator('.batch-file.succeeded')).toHaveCount(2);
    const replayed = await readProbe(page);
    assert.deepEqual(replayed.errors, []);
    assert.equal(replayed.keys.length, 3);
    assert.equal(replayed.keys[0], replayed.keys[2]);
    const accepted = row(firstReceipt.acceptedVersion.filename);
    await accepted.getByText('查看保存回执', { exact: true }).click();
    await expect(accepted).toContainText(firstReceipt.acceptedVersion.id);
    await expect(accepted.locator('dd').nth(1)).toContainText('v1');
    await expect(accepted.locator('dd').nth(2)).toHaveText('v2');
    const detail = await (await request.get(root + `/materials/${firstReceipt.id}`)).json();
    assert.equal(detail.versions.length, 2, 'replay must not append v3');
    await restoreProbe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'batch-receipts-mobile.png'), fullPage: true });
    assert.ok(
      await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
    );
    await page.getByRole('button', { name: '完成并关闭', exact: true }).click();
    const batchFolder = (await list()).items.find((v: { name: string }) => v.name === '批量授权验收');
    const chosenFolder = (await list(batchFolder.id)).items.find(
      (v: { name: string }) => v.name === '授权资料',
    );
    const chosenItems = (await list(chosenFolder.id)).items;
    assert.equal(chosenItems.filter((v: { name: string }) => v.name === '一.txt').length, 1);
    assert.equal(
      chosenItems.some((v: { name: string }) => v.name === '待人工处理.custom'),
      false,
    );
    const nested = chosenItems.find((v: { name: string }) => v.name === '分部');
    assert.equal(
      (await list(nested.id)).items.filter((v: { name: string }) => v.name === '二.txt').length,
      1,
    );

    // Multi-file fallback, duplicate path selection, and no merge of an existing batch.
    await page.getByRole('button', { name: '批量上传', exact: true }).click();
    await page.getByLabel('新批次文件夹', { exact: true }).fill('批量授权验收');
    await page
      .getByLabel('选择批量文件', { exact: true })
      .setInputFiles([payload('同名.txt'), payload('同名.txt')]);
    await expect(
      page.getByText('当前目标已有同名项目，请换一个批次文件夹名称。完整冲突检查还会在上传前执行。'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '确认上传 2 个文件', exact: true })).toBeDisabled();
    await page.getByLabel('新批次文件夹', { exact: true }).fill('批量多选验收');
    await expect(page.getByRole('button', { name: '确认上传 2 个文件', exact: true })).toBeDisabled();
    await page.locator('.batch-file input').last().uncheck();
    await expect(page.getByRole('button', { name: '确认上传 1 个文件', exact: true })).toBeEnabled();
    await page
      .getByLabel('选择批量文件', { exact: true })
      .setInputFiles([payload('停止一.txt'), payload('停止二.txt')]);
    await installProbe(page, 'hold');
    await page.getByRole('button', { name: '确认上传 2 个文件', exact: true }).click();
    await expect.poll(async () => (await readProbe(page)).held).toBe(true);
    const held = await readProbe(page);
    assert.equal(
      held.status,
      201,
      `Native multipart upload failed: ${held.receipt?.code || 'no response code'}`,
    );
    assert.deepEqual(held.errors, []);
    await page.getByRole('button', { name: '停止剩余上传', exact: true }).click();
    await page.evaluate(() => (window as ProbeWindow).__batchTransportProbe?.release?.());
    await expect(page.getByRole('button', { name: '继续 1 个未上传文件', exact: true })).toBeVisible();
    assert.equal((await readProbe(page)).keys.length, 1);
    await page.getByRole('button', { name: '继续 1 个未上传文件', exact: true }).click();
    await expect(page.locator('.batch-file.succeeded')).toHaveCount(2);
    assert.equal((await readProbe(page)).keys.length, 2);
    await page.getByRole('button', { name: '完成并关闭', exact: true }).click();
    await restoreProbe(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    await restoreProbe(page);
    await rm(scratch, { recursive: true, force: true });
  }
}
