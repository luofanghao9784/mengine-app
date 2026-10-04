import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2),
  space = id(3),
  entryId = id(4),
  version = id(5);
async function fixture(context: BrowserContext) {
  let revoked = false,
    eraseAfterStop = false;
  let stopped = false,
    loseNextResponse = false;
  const requests: unknown[] = [];
  const completed = new Set<string>();
  const mutations: string[] = [];
  const queries: URLSearchParams[] = [];
  let waiting = 3;
  let adjustment: {
    id: string;
    versionId: string;
    state: string;
    resultVersionId: string | null;
    createdAt: string;
  } | null = null;
  let adjusted = false;
  const content = {
    kind: 'METHOD',
    title: '先核对来源口径',
    summary: '合成方法摘要',
    body: '核对来源范围，再检查实际执行回执。',
    tags: ['核对'],
    applicable: '具备实际执行回执',
    excluded: '缺少回执时不能推断成功',
    dependencies: '使用当前获准来源',
    basis: '系统自动检查，不代表所有业务效果已获证明。',
    accessMode: 'SOURCE_BOUND',
  };
  const result = {
    id: entryId,
    tenantId: tenant,
    workspaceId: space,
    revision: 2,
    status: 'PUBLISHED',
    latestNumber: 1,
    publishedVersion: version,
    canMaintain: true,
    version: {
      id: version,
      number: 1,
      schemaVersion: 1,
      content,
      evidence: [{ kind: 'TASK', referenceId: id(6), workspaceId: space }],
      origin: 'AUTOMATIC',
      evaluation: 'AUTOMATIC_CHECKED',
      createdBy: person,
      createdAt: '2026-10-04T00:00:00Z',
    },
  };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path === '/api/v1/auth/csrf') return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: 'synthetic@example.test', displayName: '合成管理员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [{ capability: 'EXPERIENCE_MAINTAIN', workspaceId: space }],
      });
    if (path.endsWith('/context'))
      return json({
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        workspaces: [{ id: space, name: '合成共享空间', kind: 'SHARED', ownerId: person, canMaintain: true }],
      });
    if (path.endsWith('/adjustments')) {
      if (revoked) return json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404);
      if (route.request().method() === 'GET')
        return json({ enabled: true, items: adjustment ? [adjustment] : [] });
      const body = route.request().postDataJSON();
      requests.push(body);
      if (!completed.has(body.requestId)) {
        adjustment = {
          id: id(21),
          versionId: body.versionId,
          state: 'WAITING',
          resultVersionId: null,
          createdAt: '2026-10-04T00:00:00Z',
        };
        completed.add(body.requestId);
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        return route.abort('failed');
      }
      return json(adjustment);
    }
    if (path.endsWith('/experience-library')) {
      queries.push(new URL(route.request().url()).searchParams);
      return json({
        scopes: [{ id: space, name: '合成共享空间' }],
        items:
          revoked || (new URL(route.request().url()).searchParams.get('state') === 'STOPPED') !== stopped
            ? []
            : [
                {
                  workspaceId: space,
                  workspaceName: '合成共享空间',
                  updatedAt: '2026-10-04T00:00:00Z',
                  experience: {
                    id: entryId,
                    versionId: version,
                    number: 1,
                    revision: 2,
                    status: stopped ? 'WITHDRAWN' : 'PUBLISHED',
                    ...content,
                    origin: 'AUTOMATIC',
                    evaluation: 'AUTOMATIC_CHECKED',
                  },
                },
              ],
        hasMore: false,
      });
    }
    if (path.endsWith('/experience-library/processing'))
      return json({
        enabled: false,
        scopes: [{ id: space, name: '合成共享空间' }],
        counts: {
          WAITING: waiting,
          PROCESSING: 0,
          RETRYING: 0,
          ADMITTED: 1,
          UPDATED: 0,
          DUPLICATE: 0,
          NOT_ADMITTED: 1,
          UNAVAILABLE: 0,
          FAILED: 1,
          UNKNOWN: 0,
        },
        items: [
          {
            id: id(10),
            sourceKind: 'TASK',
            state: 'NOT_ADMITTED',
            reason: 'INSUFFICIENT_EVIDENCE',
            updatedAt: '2026-10-04T00:00:00Z',
            entryId: null,
            versionId: null,
            workspaceId: space,
          },
          {
            id: id(11),
            sourceKind: 'FEEDBACK',
            state: 'FAILED',
            reason: 'TECHNICAL_FAILURE',
            updatedAt: '2026-10-04T00:00:00Z',
            entryId: null,
            versionId: null,
            workspaceId: space,
          },
          {
            id: id(12),
            sourceKind: 'TASK',
            state: 'ADMITTED',
            reason: null,
            updatedAt: '2026-10-04T00:00:00Z',
            entryId,
            versionId: version,
            workspaceId: space,
          },
        ],
        hasMore: false,
      });
    if (path.endsWith('/history'))
      return json({
        items: [
          {
            id: version,
            number: 1,
            origin: 'AUTOMATIC',
            evaluation: 'AUTOMATIC_CHECKED',
            createdAt: '2026-10-04T00:00:00Z',
            current: true,
          },
        ],
        hasMore: false,
      });
    const current = () => ({
      ...result,
      status: stopped ? 'WITHDRAWN' : 'PUBLISHED',
      publishedVersion: stopped ? null : adjusted ? id(22) : version,
      latestNumber: adjusted ? 2 : 1,
      version:
        adjusted && new URL(route.request().url()).searchParams.get('version') === id(22)
          ? { ...result.version, id: id(22), number: 2, content: { ...content, title: '核验后的新版本' } }
          : result.version,
      canRestore: stopped,
    });
    if (path.endsWith('/stop') || path.endsWith('/restore')) {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (!completed.has(body.requestId)) {
        stopped = path.endsWith('/stop');
        result.revision++;
        if (stopped && eraseAfterStop) revoked = true;
        completed.add(body.requestId);
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        return route.abort('failed');
      }
      return path.endsWith('/stop')
        ? json({ entryId, versionId: version, revision: body.expectedRevision + 1, status: 'WITHDRAWN' })
        : json(current());
    }
    if (path.endsWith('/experiences/' + entryId))
      return revoked ? json({ contractVersion: '1.0', code: 'EXPERIENCE_NOT_FOUND' }, 404) : json(current());
    return json({ contractVersion: '1.0', code: 'NOT_FOUND' }, 404);
  });
  return {
    mutations,
    finishAdjustment: (state: string) => {
      if (adjustment) {
        adjustment.state = state;
        if (state === 'UPDATED') {
          adjustment.resultVersionId = id(22);
          adjusted = true;
          result.revision++;
        }
      }
    },
    eraseAfterStop: () => {
      eraseAfterStop = true;
    },
    requests,
    loseResponse: () => {
      loseNextResponse = true;
    },
    queries,
    setWaiting: (n: number) => {
      waiting = n;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
const start = `/tenant-admin/#tenant=${tenant}&admin=experience&scope=${space}`;
test('automatic experience is readable in tenant admin without manual approval or editing', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.goto(start);
  await expect(page.locator('.experience-management-card')).toContainText('自动核验通过');
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await expect(page.locator('.experience-detail')).toContainText('系统积累 · 自动核验通过');
  await expect(page.locator('.experience-detail')).toContainText('持续依赖来源权限');
  await expect(
    page.getByRole('button', { name: /整理新版本|发布此版本|审核|批准|判断适用并记录/ }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  await page.screenshot({ path: '/tmp/automatic-experience-admin.png', fullPage: true });
});
test('a focus refresh removes a detail after source access disappears', async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await expect(page.locator('.experience-detail')).toBeVisible();
  state.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.experience-detail')).toHaveCount(0);
  await expect(page.getByText('核对来源范围，再检查实际执行回执。', { exact: true })).toHaveCount(0);
});

test('drawer preserves search and scope, with version history loaded on demand', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.goto(start);
  await page.getByLabel('搜索经验').fill('核对');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.get('query')).toBe('核对');
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await page.getByText('版本历史', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'v1 · 当前生效' })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByLabel('搜索经验')).toHaveValue('核对');
  await expect(page.getByLabel('经验范围')).toHaveValue(space);
});
test('accumulation dashboard separates quality and execution outcomes without human review actions', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.clock.install();
  await page.goto(start);
  await page.getByRole('tab', { name: '积累与改进' }).click();
  await expect(page.getByText('缺少充分依据', { exact: true })).toBeVisible();
  await expect(page.getByText('技术执行未完成', { exact: true })).toBeVisible();
  await expect(page.getByText(/自动积累尚未启用/)).toBeVisible();
  await expect(page.getByRole('button', { name: /审核|批准|驳回|分派|手工关闭|补齐/ })).toHaveCount(0);
  state.setWaiting(2);
  await page.clock.fastForward(31000);
  await expect(
    page.locator('.experience-processing-metrics section').filter({ hasText: '等待处理' }),
  ).toContainText('2');
  await page.getByRole('button', { name: '查看关联经验' }).click();
  await expect(page.locator('.experience-detail')).toBeVisible();
  expect(state.mutations).toEqual([]);
});
test('mobile processing and drawer fit the viewport', async ({ page, context }) => {
  await fixture(context);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(start);
  await page.getByRole('tab', { name: '积累与改进' }).click();
  await expect(page.locator('.experience-processing-metrics')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/experience-processing-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '查看关联经验' }).click();
  await expect(page.locator('.experience-detail')).toBeVisible();
  expect(await page.locator('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/experience-drawer-mobile.png', fullPage: true });
});

test('stop and restore retain the exact version and reconcile a lost response with the same request', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await page.getByRole('button', { name: '停用经验', exact: true }).click();
  await expect(page.getByText(/依赖它的自动经验会失效/)).toBeVisible();
  state.loseResponse();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.experience-detail')).toBeVisible();
  await expect(page.getByRole('button', { name: '取消并刷新' })).toBeDisabled();
  await page.getByRole('button', { name: '重试原请求' }).click();
  await expect(page.getByRole('button', { name: '恢复使用', exact: true })).toBeVisible();
  expect(state.requests[0]).toEqual(state.requests[1]);
  await page.getByRole('button', { name: '恢复使用', exact: true }).click();
  await expect(page.getByText(/已清理的内容和下游任务不会恢复/)).toBeVisible();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('button', { name: '停用经验', exact: true })).toBeVisible();
  expect(state.requests[2]).toMatchObject({ versionId: version, expectedRevision: 3 });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.locator('.experience-management-card')).toHaveCount(1);
});

test('a confirmed stop remains successful when the related body becomes unavailable', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.eraseAfterStop();
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await page.getByRole('button', { name: '停用经验', exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '经验已停用。' })).toBeVisible();
  await expect(page.getByText('核对来源范围，再检查实际执行回执。', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试原请求' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  expect(state.mutations).toHaveLength(1);
});

test('adjustment keeps the original version, retries one request and links its automatic result', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.clock.install();
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await page.getByRole('button', { name: '调整内容', exact: true }).click();
  await page.getByLabel('方法', { exact: true }).fill('核对覆盖范围，再解释执行回执。');
  await page.getByLabel('调整原因与依据').fill('补充原方法未列出的覆盖范围限制。');
  state.loseResponse();
  await page.getByRole('button', { name: '提交调整', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试原调整' })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByLabel('调整原因与依据')).toHaveValue('补充原方法未列出的覆盖范围限制。');
  await page.getByRole('button', { name: '重试原调整' }).click();
  await expect(page.getByText('系统正在自动处理，原版本继续可用。', { exact: true })).toBeVisible();
  expect(state.requests[0]).toEqual(state.requests[1]);
  await expect(page.getByRole('button', { name: '调整内容', exact: true })).toBeDisabled();
  state.finishAdjustment('UPDATED');
  await page.clock.fastForward(31000);
  await page.getByRole('button', { name: '查看处理后的版本' }).click();
  await expect(page.locator('.experience-detail h3')).toHaveText('核验后的新版本');
});
test('mobile adjustment form preserves draft while focus refreshes and removes it on access loss', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(start);
  await page.getByRole('button', { name: /先核对来源口径/ }).click();
  await page.getByRole('button', { name: '调整内容', exact: true }).click();
  await page.getByLabel('调整原因与依据').fill('保留未提交的调整说明');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('调整原因与依据')).toHaveValue('保留未提交的调整说明');
  expect(await page.locator('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/experience-adjustment-mobile.png', fullPage: true });
  state.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('调整原因与依据')).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test('a submission-time access rejection clears the draft and stale method without waiting for focus', async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await page.goto(start);
  await page.getByRole('button', { name: '先核对来源口径' }).click();
  await page.getByRole('button', { name: '调整内容', exact: true }).click();
  await page.getByRole('textbox', { name: '调整原因与依据', exact: true }).fill('不应在失权后继续显示');
  state.revoke();
  await page.getByRole('button', { name: '提交调整', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '调整原因与依据', exact: true })).toHaveCount(0);
  await expect(page.getByText('核对来源范围，再检查实际执行回执。', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '关闭弹窗' })).toBeEnabled();
});
