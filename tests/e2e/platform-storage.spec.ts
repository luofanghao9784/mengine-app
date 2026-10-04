import { test, expect, type BrowserContext } from '@playwright/test';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString(),
  past = new Date(Date.now() - 3600_000).toISOString(),
  future = new Date(Date.now() + 86400_000).toISOString();
async function fixture(context: BrowserContext) {
  let mode = 'ready';
  const methods: string[] = [];
  await context.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    methods.push(route.request().method());
    const json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (p.endsWith('/auth/me'))
      return json({
        account: { id: id(1), email: 'synthetic@example.test', displayName: '合成平台人员' },
        platformAdmin: true,
        memberships: [],
      });
    if (p.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (p.endsWith('/engine-telemetry'))
      return json({
        tenantId: null,
        checkedAt: now,
        recentSeconds: 300,
        evolution: 'NOT_CONNECTED',
        channels: telemetryChannels.map((code) => ({
          code,
          running: 0,
          queued: 0,
          waiting: 0,
          failed: 0,
          unknown: 0,
          completedRecent: 0,
          lastCompletedAt: null,
        })),
      });
    if (p.endsWith('/operation-cleanup'))
      return json({
        tenantId: null,
        pending: 2,
        failed: 0,
        complete: 3,
        removedEvents: 12,
        removedAudit: 4,
        nextDeadline: null,
        coverage: 'NEW_CLOSED_TASK_NOTIFICATIONS',
        protectedRecords: 'BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION',
      });
    if (p.endsWith('/storage-status')) {
      if (mode === 'revoked') return json({ code: 'ACCESS_DENIED' }, 403);
      const snapshot = { id: id(9), createdAt: past, expiresAt: future, bytes: 102400, files: 8, tables: 30 };
      const value = {
        checkedAt: now,
        storage: {
          databaseBytes: 52428800,
          knowledgeBytes: 1048576,
          registeredOriginalBytes: 1000,
          originalVolume: { state: 'OBSERVED', totalBytes: 1024 ** 3, usableBytes: 1024 ** 3 / 2 },
        },
        cleanup: { queued: 2, running: 1, failed: 1, completed: 7, lastCompletedAt: now },
        backup: {
          state: mode === 'none' ? 'NOT_CONFIGURED' : mode === 'stale' ? 'STALE' : 'FRESH',
          updatedAt: mode === 'none' ? null : now,
          staleSeconds: 900,
          events:
            mode === 'none'
              ? []
              : [
                  {
                    id: id(10),
                    command: 'RESTORE',
                    state: 'SUCCEEDED',
                    startedAt: now,
                    finishedAt: now,
                    snapshot,
                  },
                  {
                    id: id(11),
                    command: 'VERIFY',
                    state: 'SUCCEEDED',
                    startedAt: past,
                    finishedAt: now,
                    snapshot,
                  },
                ],
        },
      };
      return json(mode === 'leak' ? { ...value, privatePath: '/never-show-private' } : value);
    }
    return json({ code: 'NOT_FOUND' }, 404);
  });
  return {
    mode: (m: string) => {
      mode = m;
    },
    methods,
  };
}
test('system wall opens read-only storage page with separate restore and opening facts', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.goto('/platform-admin/#admin=engine');
  await page.getByRole('link', { name: '存储与备份', exact: true }).click();
  await expect(page.getByRole('heading', { name: '存储与备份', exact: true })).toBeVisible();
  const facts = page.getByRole('region', { name: '备份与恢复验证' });
  await expect(facts).toContainText('在隔离目录完成还原验证，尚不代表对外开放');
  await expect(facts).toContainText('尚无成功记录，不推断已完成');
  await expect(page.getByRole('region', { name: '已记录恢复点' }).locator('article')).toHaveCount(1);
  await expect(page.getByRole('region', { name: '存储用量' })).toContainText('已包含在数据库占用中');
  await expect(page.getByRole('button', { name: /恢复|下载|生成备份|配置/ })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/platform-storage-1440.png', fullPage: true });
  await page.getByRole('region', { name: '部署操作记录' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/platform-storage-events-1440.png' });
  await page.getByText('查看任务通知清理', { exact: true }).click();
  await expect(page.getByRole('region', { name: '任务通知清理状态' })).toContainText('已清理通知 12');
  await expect(page.getByRole('region', { name: '任务通知清理状态' })).toContainText(
    '此状态不代表备份已清理',
  );
  await page.getByRole('link', { name: '返回系统运行' }).click();
  await expect(page.getByRole('heading', { name: '存储与备份', exact: true })).toHaveCount(0);
  expect(f.methods.every((m) => m === 'GET')).toBeTruthy();
});
test('unknown and stale observations are explicit and malformed/private response is removed', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  f.mode('none');
  await page.goto('/platform-admin/#admin=engine&detail=storage');
  await expect(page.getByRole('region', { name: '备份与恢复验证' })).toContainText('尚未接入备份监测');
  await expect(page.getByRole('region', { name: '已记录恢复点' })).toContainText('暂无恢复点监测信息');
  f.mode('stale');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('region', { name: '备份与恢复验证' })).toContainText('部署记录已过期');
  f.mode('leak');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('暂时无法读取', { exact: true })).toBeVisible();
  await expect(page.getByText('/never-show-private')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '已记录恢复点' })).toHaveCount(0);
});
test('authorization loss clears historical facts and narrow layout has no page overflow', async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto('/platform-admin/#admin=engine&detail=storage');
  await expect(page.getByRole('region', { name: '已记录恢复点' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/platform-storage-360.png', fullPage: true });
  f.mode('revoked');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByText('没有访问权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '备份与恢复验证' })).toHaveCount(0);
});
