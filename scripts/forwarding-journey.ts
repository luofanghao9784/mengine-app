import { expect, type BrowserContext, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ForwardBatch, ForwardPeople, ForwardInbox } from '../contracts/public-api/forwarding.ts';

/** Real authenticated pages + API. Caller supplies a published synthetic latest copy and two existing readers. */
export async function forwardingJourney({
  tenant,
  publicationId,
  materialVersionId,
  recipientId,
  senderContext,
  recipientContext,
  artifacts,
  revokeRecipient,
}: {
  tenant: string;
  publicationId: string;
  materialVersionId: string;
  recipientId: string;
  senderContext: BrowserContext;
  recipientContext: BrowserContext;
  artifacts: string;
  revokeRecipient?: () => Promise<void>;
}) {
  await mkdir(artifacts, { recursive: true });
  const sourcePath = `/api/v1/tenants/${tenant}/forwarding`,
    scope = new URLSearchParams({ publicationId, materialVersionId });
  const peopleResponse = await senderContext.request.get(`${sourcePath}/recipients?${scope}`);
  assert.equal(peopleResponse.status(), 200);
  const people = (await peopleResponse.json()) as ForwardPeople,
    recipient = people.items.find((r) => r.id === recipientId);
  assert.ok(recipient, 'Synthetic receiver must already hold real access to the exact shared copy');
  const sender = await senderContext.newPage(),
    receiver = await recipientContext.newPage(),
    errors: string[] = [];
  for (const page of [sender, receiver]) {
    page.on('pageerror', (e) => errors.push(e.message));
    await installLossProbe(page);
  }
  try {
    await sender.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    await sender.getByRole('tab', { name: '推荐', exact: true }).click();
    await sender
      .getByRole('combobox', { name: '工作空间', exact: true })
      .selectOption(people.source.workspaceId);
    const card = sender.getByRole('article', { name: `推荐成果：${people.source.filename}`, exact: true });
    await card.getByRole('button', { name: `阅读：${people.source.filename}`, exact: true }).click();
    await sender
      .locator('dialog.live-reading-dialog')
      .getByRole('button', { name: '站内转发', exact: true })
      .click();
    const dialog = sender.getByRole('dialog', { name: '转发已发布的企业副本', exact: true });
    await dialog.getByRole('textbox', { name: '查找当前获权同事', exact: true }).fill(recipient.name);
    await dialog
      .locator('.forwarding-people label')
      .filter({ hasText: recipientId.slice(0, 8) })
      .getByRole('checkbox')
      .check();
    await dialog
      .getByRole('textbox', { name: '转发说明（可选）', exact: true })
      .fill('合成站内转发旅程：请核对这一确切企业副本。');
    await dialog.getByRole('button', { name: '确认站内转发', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '重试本次站内转发', exact: true })).toBeVisible();
    const acceptedResponse = await senderContext.request.get(`${sourcePath}/batches?${scope}`);
    assert.equal(acceptedResponse.status(), 200);
    const accepted = (await acceptedResponse.json()).items[0] as ForwardBatch;
    assert.equal(accepted.materialVersionId, materialVersionId);
    assert.deepEqual(
      accepted.recipients.map((r) => r.accountId),
      [recipientId],
    );
    assert.equal(accepted.recipients[0].state, 'ACCEPTED');
    assert.equal(accepted.recipients[0].openedAt, null);
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await expect(dialog).toBeVisible();
    await sender.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByRole('button', { name: '重试本次站内转发', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '重试本次站内转发', exact: true }).click();
    await expect(dialog.getByText('站内已接受 1 位接收人的转发', { exact: true })).toBeVisible();
    const sent = await probe(sender);
    assert.equal(sent.keys.length, 2);
    assert.equal(sent.keys[0], sent.keys[1]);
    const after = await (await senderContext.request.get(`${sourcePath}/batches?${scope}`)).json();
    assert.equal(after.items.filter((r: ForwardBatch) => r.requestId === accepted.requestId).length, 1);
    await sender.screenshot({ path: `${artifacts}/forwarding-send-desktop.png`, fullPage: true });
    await sender.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await sender.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    await sender.screenshot({ path: `${artifacts}/forwarding-send-mobile.png`, fullPage: true });
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await receiver.goto(`/workspace/#tenant=${tenant}&view=briefing`);
    const inbox = receiver.getByRole('region', { name: '同事转来的企业成果' });
    await inbox.getByRole('button', { name: '展开同事转发', exact: true }).click();
    const delivery = inbox.getByRole('article').filter({ hasText: people.source.filename });
    await expect(delivery.getByText('未打开', { exact: true })).toBeVisible();
    const beforeOpen = (await (
      await senderContext.request.get(`${sourcePath}/batches/${accepted.id}`)
    ).json()) as ForwardBatch;
    assert.equal(
      beforeOpen.recipients[0].openedAt,
      null,
      'Listing and sender receipt views are not a recipient open action',
    );
    await delivery.getByRole('button', { name: '打开这份转发', exact: true }).click();
    await expect(inbox.getByRole('button', { name: '重试本次打开', exact: true })).toBeVisible();
    const actualOpen = (await (
      await recipientContext.request.get(`${sourcePath}/inbox`)
    ).json()) as ForwardInbox;
    const receipt = actualOpen.items.find((r) => r.id === accepted.recipients[0].receiptId);
    assert.ok(receipt?.openedAt);
    await inbox.getByRole('button', { name: '重试本次打开', exact: true }).click();
    await expect(delivery.getByRole('button', { name: '下载确切版本', exact: true })).toBeVisible();
    const opened = await probe(receiver);
    assert.equal(opened.keys.length, 2);
    assert.equal(opened.keys[0], opened.keys[1]);
    const downloadPromise = receiver.waitForEvent('download');
    await delivery.getByRole('button', { name: '下载确切版本', exact: true }).click();
    const download = await downloadPromise,
      path = `${artifacts}/forwarding-exact-copy.${people.source.format}`;
    await download.saveAs(path);
    assert.equal(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
      people.source.sha256,
    );
    const fresh = (await (
      await senderContext.request.get(`${sourcePath}/batches/${accepted.id}`)
    ).json()) as ForwardBatch;
    assert.equal(fresh.recipients[0].state, 'OPENED');
    assert.equal(fresh.recipients[0].openedAt, receipt.openedAt);
    await receiver.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await receiver.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    );
    await receiver.screenshot({ path: `${artifacts}/forwarding-inbox-mobile.png`, fullPage: true });
    if (revokeRecipient) {
      await revokeRecipient();
      await receiver.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(inbox.getByText(people.source.filename, { exact: true })).toHaveCount(0);
      await expect(inbox.getByRole('button', { name: '下载确切版本', exact: true })).toHaveCount(0);
      const hidden = await recipientContext.request.get(`${sourcePath}/inbox`);
      assert.equal(hidden.status(), 200);
      assert.equal(
        (await hidden.json()).items.some((r: { id: string }) => r.id === receipt.id),
        false,
      );
    }
    assert.deepEqual(errors, []);
    return {
      batchId: accepted.id,
      receiptId: receipt.id,
      exactVersion: materialVersionId,
      acceptedThenOpened: true,
      sameSendKey: true,
      sameOpenKey: true,
      sha256: people.source.sha256,
      revocationChecked: Boolean(revokeRecipient),
    };
  } finally {
    await sender.close();
    await receiver.close();
  }
}
async function installLossProbe(page: Page) {
  await page.addInitScript(() => {
    const native = window.fetch.bind(window);
    type Probe = { keys: string[]; dropped: boolean };
    const target = window as unknown as { forwardProbe: Probe };
    target.forwardProbe = { keys: [], dropped: false };
    window.fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input),
        location.href,
      ).pathname;
      if (
        init?.method === 'POST' &&
        path.includes('/forwarding/') &&
        (path.endsWith('/batches') || path.endsWith('/open'))
      ) {
        target.forwardProbe.keys.push(JSON.parse(String(init.body)).requestId);
        const response = await native(input, init);
        if (response.ok && !target.forwardProbe.dropped) {
          target.forwardProbe.dropped = true;
          throw new TypeError('synthetic accepted response loss');
        }
        return response;
      }
      return native(input, init);
    };
  });
}
async function probe(page: Page) {
  return page.evaluate(
    () => (window as unknown as { forwardProbe: { keys: string[]; dropped: boolean } }).forwardProbe,
  );
}
