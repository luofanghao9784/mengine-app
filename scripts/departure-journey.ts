/** Run LAST against a disposable synthetic tenant. This really disables/restores one synthetic employee,
 * then formally exits that tenant. Caller provisions explicit MEMBER_OFFBOARD, TENANT_EXIT, BULK_EXPORT,
 * one currently authorized shared workspace, one original material, and mounts DeparturePanel on a real route.
 * No mock routes: the only transport probe discards one already accepted HTTP response. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { DepartureView, ExitPart } from '../contracts/public-api/departure.ts';
type ProbeWindow = Window & {
  __departureProbe?: {
    armed: boolean;
    keys: string[];
    accepted: DepartureView | null;
    status: number | null;
  };
};
export async function departureJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  employee: string,
  workspace: string,
  artifacts: string,
  entryUrl: string,
  secondExporter?: string,
) {
  assert.match(
    entryUrl,
    /^\/(tenant-admin|workspace)(\/|\?)/,
    'Use the actual route, never a Demo or fixture page',
  );
  const root = `/api/v1/tenants/${tenant}/departures`,
    ex = `/api/v1/tenants/${tenant}/departure-exports`;
  const options = await request.get(root + '/options?limit=50');
  assert.equal(options.status(), 200);
  const opts = await options.json();
  assert.ok(opts.canOffboard && opts.canExit);
  assert.ok(opts.members.some((m: { id: string }) => m.id === employee));
  const scopes = await request.get(root + '/export-scopes?limit=50');
  assert.equal(scopes.status(), 200);
  const selected = (await scopes.json()).find((s: { workspaceId: string }) => s.workspaceId === workspace);
  assert.ok(selected, 'Caller must provide a current readable+BULK shared scope');
  await page.addInitScript(() => {
    const native = fetch.bind(window);
    (window as ProbeWindow).__departureProbe = { armed: false, keys: [], accepted: null, status: null };
    window.fetch = async (input, init) => {
      const p = (window as ProbeWindow).__departureProbe,
        u = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          location.href,
        );
      if (!p || init?.method !== 'POST' || !u.pathname.endsWith('/departures/offboard'))
        return native(input, init);
      p.keys.push(JSON.parse(String(init.body)).requestId);
      const response = await native(input, init);
      if (p.armed) {
        p.armed = false;
        p.status = response.status;
        if (response.ok) p.accepted = await response.clone().json();
        throw new TypeError('Synthetic receipt loss after actual response');
      }
      return response;
    };
  });
  await page.goto(entryUrl);
  // A hash-only goto keeps the current document; reload installs the one-shot transport probe.
  await page.reload();
  await page.getByRole('button', { name: '办理员工离职', exact: true }).click();
  await page.getByLabel('离职员工', { exact: true }).selectOption(employee);
  await page.getByLabel('执行原因', { exact: true }).fill('离线验收合成员工：确认原定隔离期与共享责任');
  await page.getByRole('checkbox', { name: /我已核对共享责任/ }).check();
  await page.evaluate(() => ((window as ProbeWindow).__departureProbe!.armed = true));
  await page.getByRole('button', { name: '确认办理离职', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试未确认请求', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '办理企业退出', exact: true })).toBeDisabled();
  await expect(page.getByLabel('执行原因', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试未确认请求', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回执行记录', exact: true })).toBeVisible();
  const probe = await page.evaluate(() => (window as ProbeWindow).__departureProbe!);
  assert.equal(probe.status, 201);
  assert.ok(probe.accepted);
  assert.equal(probe.keys.length, 2);
  assert.equal(probe.keys[0], probe.keys[1]);
  const offboard = probe.accepted!;
  await expect
    .poll(
      async () => {
        const r = await request.get(root + '/' + offboard.execution.id);
        assert.equal(r.status(), 200);
        const state = await r.json();
        if (state.execution.errorCode) throw Error('Departure worker error: ' + JSON.stringify(state));
        return state.execution.state;
      },
      { timeout: 60000 },
    )
    .toBe('ISOLATED');
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await page.getByRole('button', { name: '撤销离职并恢复未清理私人内容', exact: true }).click();
  await expect
    .poll(
      async () => {
        const r = await request.get(root + '/' + offboard.execution.id);
        const state = await r.json();
        if (state.execution.errorCode) throw Error('Departure worker error: ' + JSON.stringify(state));
        return state.execution.state;
      },
      { timeout: 60000 },
    )
    .toBe('CANCELLED');
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByText('离职已撤销', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'departure-restored.png'), fullPage: true });
  await page.getByRole('button', { name: '办理企业退出', exact: true }).click();
  await page.getByRole('checkbox', { name: selected.name, exact: true }).check();
  if (secondExporter) {
    await page.getByLabel('迁出负责人', { exact: true }).selectOption(secondExporter);
    await page.getByRole('checkbox', { name: selected.name, exact: true }).check();
  }
  await page.getByLabel('退出原因', { exact: true }).fill('离线验收企业退出：固定共享范围并生成真实迁出包');
  await page.getByRole('checkbox', { name: /确认停止业务/ }).check();
  await page.getByRole('button', { name: '确认企业退出', exact: true }).click();
  await expect(page.getByText('受限迁出期', { exact: true })).toBeVisible();
  const status = await request.get(root + '/business-status');
  assert.equal(status.status(), 200);
  assert.deepEqual(
    Object.keys(await status.json()).sort(),
    ['businessEnabled', 'canExport', 'exitState', 'exportDeadline', 'tenantId'].sort(),
  );
  assert.equal((await status.json()).businessEnabled, false);
  assert.equal((await status.json()).canExport, true);
  await page.getByRole('button', { name: '固定版本并创建迁出清单', exact: true }).click();
  await page.getByRole('button', { name: '生成下一分包', exact: true }).click();
  await expect(page.getByText('分包详情', { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.getByRole('button', { name: '刷新状态', exact: true }).click();
        return page.getByRole('link', { name: '下载 ZIP（服务端再次核验）', exact: true }).count();
      },
      { timeout: 30000 },
    )
    .toBe(1);
  const href = await page
    .getByRole('link', { name: '下载 ZIP（服务端再次核验）', exact: true })
    .getAttribute('href');
  assert.ok(href?.startsWith(ex + '/parts/'));
  const partId = href!.split('/').at(-2)!;
  const partResponse = await request.get(ex + '/parts/' + partId);
  assert.equal(partResponse.status(), 200);
  const part: ExitPart = await partResponse.json();
  assert.ok(part.canDownload && part.items.some((i) => i.state === 'INCLUDED'));
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 ZIP（服务端再次核验）', exact: true }).click();
  const download = await downloadEvent,
    path = join(artifacts, 'real-exit-part.zip');
  await download.saveAs(path);
  const manifest = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('_exit-manifest.json'))
 assert m['included']>0 and m['fullTenantMigration'] is False
 for i in m['items']:
  if i['state']=='INCLUDED': assert len(z.read(i['filename']))>=0
 print(json.dumps(m))`,
        path,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(manifest.partId, partId);
  assert.equal(manifest.workspaceId, workspace);
  await page.screenshot({ path: join(artifacts, 'departure-exit-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'departure-exit-mobile.png'), fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  );
  await page.getByRole('button', { name: '移除临时包', exact: true }).click();
  await expect
    .poll(
      async () => {
        const r = await request.get(ex + '/parts/' + partId + '/cleanup');
        return (await r.json()).cleanupState;
      },
      { timeout: 15000 },
    )
    .toBe('COMPLETE');
  assert.equal((await request.get(href!)).status(), 410);
  return {
    offboardId: offboard.execution.id,
    partId,
    actualZip: true,
    sameRequestRetry: true,
    tenantBusinessEnabled: false,
  };
}
