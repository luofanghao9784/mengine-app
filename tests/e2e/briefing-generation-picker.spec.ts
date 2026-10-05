import { test, expect, type Page, type Route } from '@playwright/test';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  space = uid(3),
  conversation = uid(4),
  taskId = uid(5);
const now = '2026-10-02T00:00:00Z';
const home = `/workspace/#tenant=${tenant}&view=briefing`;
const info = {
  id: conversation,
  tenantId: tenant,
  workspaceId: space,
  title: '合成发送验证',
  updatedAt: now,
};
const task = (prompt: string) => ({
  id: taskId,
  prompt,
  mode: 'AGENT',
  status: 'WAITING_CAPABILITY',
  revision: 1,
  attempt: 0,
  summaryCode: null,
  errorCode: null,
  engineVersion: null,
  sourcesUnavailable: false,
  sources: [],
  createdAt: now,
  reply: null,
  executionClass: null,
  modelName: null,
  artifacts: [],
  publicQuery: null,
  webSources: [],
  skills: [],
  originals: [],
  waitReason: 'AGENT_DISABLED',
  requiredInput: null,
  reconciliationRequired: false,
});
async function fixture(page: Page, send: (route: Route, body: Record<string, unknown>) => Promise<void>) {
  const requests: URL[] = [];
  let prompt = '';
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    requests.push(url);
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
        workspaces: [{ id: space, name: '个人空间', kind: 'PERSONAL' }],
      };
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' };
    else if (path.endsWith('/conversations') && request.method() === 'POST') {
      const body = request.postDataJSON();
      prompt = body.prompt;
      expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf');
      return send(route, body);
    } else if (path.endsWith('/conversations'))
      json = {
        tenantId: tenant,
        enabled: true,
        agentMode: 'off',
        publicWebEnabled: false,
        items: prompt ? [info] : [],
        hasMore: false,
      };
    else if (path.endsWith('/conversations/' + conversation))
      json = {
        conversation: info,
        tasks: [task(prompt)],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/events'))
      json = { conversationId: conversation, items: [], cursor: 1, hasMore: false };
    else if (path.endsWith('/plan-receipts')) json = [];
    else if (path.endsWith('/recommendations'))
      json = {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: [],
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 0,
        rankedCount: 0,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      };
    else if (path.endsWith('/briefing/layout')) json = { tenantId: tenant, revision: 0 };
    else if (path.endsWith('/briefing'))
      json = {
        tenantId: tenant,
        view: url.searchParams.get('view'),
        date: url.searchParams.get('date'),
        zone: url.searchParams.get('zone'),
        items: [],
        hasMore: false,
        asOf: now,
      };
    else if (path.endsWith('/briefing/generation')) json = { policies: [], batches: [] };
    else return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNAVAILABLE' } });
    return route.fulfill({ json });
  });
  return requests;
}

async function pickerFixture(page: Page, remaining = 6, dropFirst = false) {
  await fixture(page, async (route) => {
    await route.fulfill({ status: 500 });
  });
  const posts: Record<string, unknown>[] = [];
  let batches: unknown[] = [];
  let dropped = false;
  const cancelled: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (!new URL(request.url()).pathname.includes('/briefing/generation')) return route.fallback();
    if (request.url().endsWith('/cancel')) {
      const id = request.url().split('/').at(-2)!;
      cancelled.push(id);
      const b = batches.find((b: any) => b.id === id) as any;
      for (const member of batches as any[]) member.status = 'CANCELLED';
      return route.fulfill({ json: b });
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push(body);
      if (!batches.length)
        batches = Array.from({ length: body.count }, (_, i) => ({
          id: uid(30 + i),
          workspaceId: space,
          trigger: 'GENERATE_MORE',
          businessType: body.types[i % body.types.length] ?? null,
          status: i === 0 ? 'RUNNING' : 'QUEUED',
          reason: null,
          taskId: i === 0 ? taskId : null,
          cardIds: [],
          createdAt: now,
          finishedAt: null,
        }));
      if (dropFirst && !dropped) {
        dropped = true;
        return route.abort('failed');
      }
      return route.fulfill({ json: batches });
    }
    // Keep history empty in the uncertain-response test so recovery must replay the confirmation.
    return route.fulfill({
      json: {
        policies: [],
        batches: dropFirst && posts.length < 2 ? [] : batches,
        quota: { limit: 6, used: 6 - remaining, reserved: 0, remaining },
      },
    });
  });
  return { posts, cancelled };
}
const picker = (page: Page) => page.getByRole('article', { name: '生成新画报' });
async function choose(page: Page, quantity: number) {
  await picker(page).getByRole('button', { name: '生成更多' }).click();
  await picker(page).getByRole('spinbutton', { name: '生成数量' }).fill(String(quantity));
  await picker(page).getByRole('button', { name: '下一步' }).click();
}
test('卡片内数量与多选类型确认后只提交一次，取消整次生成', async ({ page }) => {
  const { posts, cancelled } = await pickerFixture(page);
  await page.goto(home);
  await choose(page, 3);
  await picker(page).getByRole('checkbox', { name: '洞察', exact: true }).check();
  await picker(page).getByRole('checkbox', { name: '建议', exact: true }).check();
  expect(posts).toHaveLength(0);
  await picker(page).getByRole('button', { name: '生成 3 张' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ count: 3, types: ['INSIGHT', 'SUGGESTION'] });
  await expect(picker(page).getByRole('checkbox')).toHaveCount(0);
  await picker(page).getByRole('button', { name: '取消本次' }).click();
  await expect.poll(() => cancelled.length).toBe(1);
});
test('默认由系统决定类型，上一步不提交请求', async ({ page }) => {
  const { posts } = await pickerFixture(page);
  await page.goto(home);
  await choose(page, 2);
  await expect(picker(page).getByRole('checkbox', { name: '默认', exact: true })).toBeChecked();
  await picker(page).getByRole('button', { name: '上一步' }).click();
  await expect(picker(page).getByRole('spinbutton', { name: '生成数量' })).toHaveValue('2');
  await picker(page).getByRole('button', { name: '下一步' }).click();
  await picker(page).getByRole('button', { name: '生成 2 张' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ count: 2, types: [] });
});
test('剩余额度限制数量，数量缩小后移除超出的类型', async ({ page }) => {
  await pickerFixture(page, 2);
  await page.goto(home);
  await picker(page).getByRole('button', { name: '生成更多' }).click();
  await expect(picker(page).getByRole('spinbutton', { name: '生成数量' })).toHaveAttribute('max', '2');
  await picker(page).getByRole('button', { name: '增加数量' }).click();
  await expect(picker(page).getByRole('button', { name: '增加数量' })).toBeDisabled();
  await picker(page).getByRole('button', { name: '下一步' }).click();
  await picker(page).getByRole('checkbox', { name: '数据', exact: true }).check();
  await picker(page).getByRole('checkbox', { name: '建议', exact: true }).check();
  await expect(picker(page).getByRole('checkbox', { name: '洞察', exact: true })).toBeDisabled();
  await picker(page).getByRole('button', { name: '上一步' }).click();
  await picker(page).getByRole('button', { name: '减少数量' }).click();
  await expect(picker(page).getByRole('button', { name: '减少数量' })).toBeDisabled();
  await picker(page).getByRole('button', { name: '下一步' }).click();
  await expect(picker(page).getByRole('checkbox', { name: '数据', exact: true })).toBeChecked();
  await expect(picker(page).getByRole('checkbox', { name: '建议', exact: true })).not.toBeChecked();
});
test('请求结果不确定时重试沿用数量类型及请求编号', async ({ page }) => {
  const { posts } = await pickerFixture(page, 6, true);
  await page.goto(home);
  await choose(page, 2);
  await picker(page).getByRole('checkbox', { name: '数据', exact: true }).check();
  await picker(page).getByRole('button', { name: '生成 2 张' }).click();
  await picker(page).getByRole('button', { name: '重试本次请求' }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual(posts[0]);
});

test('生成首页保留原入口，数量页只有一个数字，类型复用画报标签', async ({ page }) => {
  const { posts } = await pickerFixture(page);
  await page.goto(home);
  await expect(picker(page).getByRole('heading', { name: '发现新内容' })).toBeVisible();
  await expect(picker(page).getByRole('button', { name: '生成更多' })).toHaveClass(/generation-icon-button/);
  await choose(page, 3);
  await expect(picker(page).locator('.magazine-type[data-briefing-type]')).toHaveCount(6);
  await expect(picker(page).getByRole('button', { name: '生成 3 张' })).toHaveClass(/generation-icon-button/);
  expect(posts).toHaveLength(0);
});

test('资讯未接入时禁选，默认与其他类型仍可操作', async ({ page }) => {
  const { posts } = await pickerFixture(page);
  await page.goto(home);
  await choose(page, 3);
  await expect(picker(page).getByRole('checkbox', { name: '资讯', exact: true })).toBeDisabled();
  await expect(picker(page).getByText('未接入', { exact: true })).toBeVisible();
  await picker(page).getByRole('checkbox', { name: '洞察', exact: true }).check();
  await picker(page).getByRole('button', { name: '生成 3 张' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].types).toEqual(['INSIGHT']);
});
