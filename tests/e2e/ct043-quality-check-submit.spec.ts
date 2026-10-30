import { test, expect, type Page } from '@playwright/test';

// Synthetic customer sessions and intercepted API responses only; never call a real backend.
const tenant = '00000000-0000-4000-8000-000000000043';
const other = '00000000-0000-4000-8000-000000000037';
const account = '00000000-0000-4000-8000-000000000038';
const href = (id = tenant) => `/workspace/#tenant=${id}&view=quality-check`;

const submitPath = '/api/tenant-admin/v1/quality-ops/check-tasks';
const notOpened = '贵企业还没开通「质量检查」，请联系平台管理员开通';
const unavailable = '质量检查暂时不可用，请稍后再试';
const noIssues = {
  taskId: '00000000-0000-4000-8000-000000000044',
  status: 'COMPLETED',
  result: { verdict: 'NO_ISSUES', issues: [] },
};
const foundIssues = {
  ...noIssues,
  result: { verdict: 'ISSUES_FOUND', issues: [{ message: '尺寸超差' }] },
};
type SubmitReply = { status: number; body?: unknown; networkError?: boolean; wait?: Promise<void> };

type OpenedReply = {
  status?: number;
  items?: { enterpriseFunction: string; displayName: string }[];
  networkError?: boolean;
};
const openedItem = { enterpriseFunction: 'quality-check', displayName: '质量检查' };
async function fixture(
  page: Page,
  mode: 'member' | 'anonymous' | 'no-member' = 'member',
  reply: OpenedReply = { items: [openedItem] },
  initial: SubmitReply = { status: 201, body: noIssues },
) {
  let submission = initial;
  const posts: { body: unknown; headers: Record<string, string> }[] = [];
  const requests: { path: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    const t = path.includes(other) ? other : tenant;
    if (path === submitPath) {
      expect(route.request().method()).toBe('POST');
      expect(new URL(route.request().url()).search).toBe('');
      posts.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
      const current = submission;
      await current.wait;
      if (current.networkError) return route.abort('failed');
      return route.fulfill({ status: current.status, json: current.body });
    }
    if (path === '/api/v1/auth/csrf')
      return route.fulfill({ json: { token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' } });
    if (path === '/api/tenant-admin/v1/opened-capabilities') {
      expect(new URL(route.request().url()).search).toBe('');
      if (reply.networkError) return route.abort('failed');
      return route.fulfill({ status: reply.status ?? 200, json: { items: reply.items ?? [] } });
    }
    if (path === '/api/v1/me') {
      if (mode === 'anonymous') return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
      return route.fulfill({
        json: {
          account: { id: account, phone: '+8619900000036', email: null, displayName: '合成成员' },
          platformAdmin: false,
          memberships:
            mode === 'no-member'
              ? []
              : [
                  { tenantId: tenant, tenantName: '合成企业甲', role: 'TENANT_ADMIN' },
                  { tenantId: other, tenantName: '合成企业乙', role: 'TENANT_ADMIN' },
                ],
        },
      });
    }
    if (path.endsWith('/phone/configuration'))
      return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    if (path.endsWith('/governance'))
      return route.fulfill({
        json: {
          tenantId: t,
          ownerId: account,
          revision: 1,
          owner: true,
          canConfigure: true,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          pendingHandover: null,
          capabilities: [],
        },
      });
    if (path.endsWith('/business-status'))
      return route.fulfill({
        json: { tenantId: t, businessEnabled: true, canExport: false, exitState: null, exportDeadline: null },
      });
    if (path.endsWith('/workspace/notifications'))
      return route.fulfill({ json: { tenantId: t, conversations: false, briefing: false } });
    // Existing native plugin requests may fail; the new opened section must still be visible.
    return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  return {
    requests,
    errors,
    posts,
    setReply: (next: SubmitReply) => {
      submission = next;
    },
  };
}

const submitButton = (page: Page) => page.getByRole('button', { name: '提交检查材料', exact: true });
const material = (page: Page) => page.getByRole('textbox', { name: '检查材料', exact: true });
const results = (page: Page) => page.getByRole('region', { name: '③ 处理结果', exact: true });
async function noConclusion(page: Page) {
  await expect(results(page)).not.toContainText('没有发现需要注意的地方');
  await expect(results(page)).not.toContainText(/发现 \d+ 处需要注意/);
  await expect(results(page).getByRole('listitem')).toHaveCount(0);
}
async function submit(page: Page, text = '本批记录完整。') {
  await material(page).fill(text);
  await submitButton(page).click();
}

test.afterEach(async ({ page }) => {
  // Check all visible copy, including every success and failure response.
  await expect(page.locator('body')).not.toContainText('检查通过');
  await expect(page.locator('body')).not.toContainText(/\b(?:seed|capability|Capability|Grant|admission)\b/);
});

for (const items of [[], [{ enterpriseFunction: 'document-parse', displayName: '文档解析' }]]) {
  test(`未开通无表单、无提交按钮、无写请求（${items.length} 个其他功能）`, async ({ page }) => {
    const { requests, posts } = await fixture(page, 'member', { items });
    await page.goto(href());
    await expect(page.getByRole('heading', { name: notOpened, exact: true })).toBeVisible();
    await expect(submitButton(page)).toHaveCount(0);
    await expect(material(page)).toHaveCount(0);
    expect(posts).toEqual([]);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });
}

test('空白、长度和可选标题控制提交；无效输入不发请求', async ({ page }) => {
  const { posts, requests } = await fixture(page);
  await page.goto(href());
  await expect(submitButton(page)).toBeDisabled();
  for (const text of ['', ' \n\t　', '文'.repeat(20_001)]) {
    await material(page).fill(text);
    await expect(submitButton(page)).toBeDisabled();
    await material(page).press('Control+Enter');
  }
  await material(page).fill('文'.repeat(20_000));
  await expect(page.getByText('20000 / 20000 字符', { exact: true })).toBeVisible();
  await expect(submitButton(page)).toBeEnabled();
  const title = page.getByRole('textbox', { name: '标题（选填）' });
  await title.fill('题'.repeat(201));
  await expect(submitButton(page)).toBeDisabled();
  await title.press('Enter');
  expect(posts).toEqual([]);
  expect(requests.some((request) => request.path === '/api/v1/auth/csrf')).toBe(false);
  await title.fill('题'.repeat(200));
  await expect(submitButton(page)).toBeEnabled();
  await submitButton(page).click();
  await expect(results(page)).toContainText('没有发现需要注意的地方');
  expect(posts[0].body).toEqual({ materialText: '文'.repeat(20_000), title: '题'.repeat(200) });
});

for (const width of [1440, 390]) {
  test(`发现问题：原文结果、JSON 与 CSRF、请求范围（${width}px）`, async ({ page }) => {
    const { posts, requests, errors } = await fixture(page, 'member', undefined, {
      status: 201,
      body: foundIssues,
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(href());
    await submit(page, '问题：尺寸超差');
    await expect(results(page)).toContainText('发现 1 处需要注意');
    await expect(results(page).getByRole('listitem')).toHaveText(['尺寸超差']);
    await expect(results(page)).not.toContainText('没有发现需要注意的地方');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ materialText: '问题：尺寸超差' });
    expect(posts[0].headers['content-type']).toBe('application/json');
    expect(posts[0].headers['x-csrf-token']).toBe('synthetic-csrf');
    const allowed = new Set([
      '/api/v1/me',
      '/api/v1/auth/phone/configuration',
      '/api/v1/auth/csrf',
      '/api/tenant-admin/v1/opened-capabilities',
      submitPath,
      ...[tenant, other].map((id) => `/api/v1/tenants/${id}/governance`),
      `/api/v1/tenants/${tenant}/departures/business-status`,
      `/api/v1/tenants/${tenant}/workspace/notifications`,
      `/api/v1/tenants/${tenant}/context`,
      `/api/v1/tenants/${tenant}/conversations`,
    ]);
    expect(
      requests.filter(
        (request) =>
          !allowed.has(request.path) || request.method !== (request.path === submitPath ? 'POST' : 'GET'),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `/tmp/ct043-quality-${width}.png`, fullPage: true });
  });
}

test('没有问题；刷新不留结果且不重发提交', async ({ page }) => {
  const { posts } = await fixture(page);
  await page.goto(href());
  await submit(page);
  await expect(results(page)).toContainText('没有发现需要注意的地方');
  await expect(page.getByText('发现 1 处需要注意', { exact: true })).toHaveCount(0);
  expect(posts[0].body).toEqual({ materialText: '本批记录完整。' });
  await page.reload();
  await expect(submitButton(page)).toBeDisabled();
  await noConclusion(page);
  expect(posts).toHaveLength(1);
});

test('忽略非合同结论，问题按原文顺序显示且不截断或当作 HTML', async ({ page }) => {
  const messages = ['  尺寸超差\n请核对原始记录。  ', '<b>这是原文</b>' + '原文'.repeat(1000)];
  await fixture(page, 'member', undefined, {
    status: 201,
    body: {
      ...foundIssues,
      summary: '不应显示的摘要',
      conclusion: '不应显示的结论',
      result: { verdict: 'ISSUES_FOUND', issues: messages.map((message) => ({ message })) },
    },
  });
  await page.goto(href());
  await page.getByRole('textbox', { name: '标题（选填）' }).fill('尺寸记录');
  await submit(page);
  await expect(results(page)).toContainText('发现 2 处需要注意');
  expect(await results(page).getByRole('listitem').allTextContents()).toEqual(messages);
  await expect(results(page).locator('b')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('不应显示');
});

const invalidBodies: [string, unknown][] = [
  ['缺 taskId', { status: 'COMPLETED', result: noIssues.result }],
  ['taskId 非 UUID', { ...noIssues, taskId: 'task-1' }],
  ['taskId 非字符串', { ...noIssues, taskId: 43 }],
  ['缺 status', { taskId: noIssues.taskId, result: noIssues.result }],
  ['status 未完成', { ...noIssues, status: 'RUNNING' }],
  ['缺 result', { taskId: noIssues.taskId, status: 'COMPLETED' }],
  ['缺 verdict', { ...noIssues, result: { issues: [] } }],
  ['未知 verdict', { ...noIssues, result: { verdict: 'PASSED', issues: [] } }],
  ['缺 issues', { ...noIssues, result: { verdict: 'NO_ISSUES' } }],
  ['issues 非数组', { ...noIssues, result: { verdict: 'NO_ISSUES', issues: {} } }],
  ['问题缺 message', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [{}] } }],
  ['问题为空值', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [null] } }],
  ['message 非字符串', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [{ message: 1 }] } }],
  ['message 空白', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [{ message: '  ' }] } }],
  ['message 为空', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [{ message: '' }] } }],
  ['有问题却空列表', { ...foundIssues, result: { verdict: 'ISSUES_FOUND', issues: [] } }],
  [
    '无问题却非空列表',
    { ...noIssues, result: foundIssues.result && { ...foundIssues.result, verdict: 'NO_ISSUES' } },
  ],
  ['只有非合同字段', { summary: '没有发现需要注意的地方', conclusion: '发现 1 处需要注意' }],
  ['响应为空', null],
];
for (const [name, body] of invalidBodies) {
  test(`201 合同无效则无结论：${name}`, async ({ page }) => {
    await fixture(page, 'member', undefined, { status: 201, body });
    await page.goto(href());
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(unavailable);
    await noConclusion(page);
  });
}

for (const status of [200, 202, 204]) {
  test(`合同字段齐全但 HTTP ${status} 不认成功`, async ({ page }) => {
    await fixture(page, 'member', undefined, { status, body: noIssues });
    await page.goto(href());
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(unavailable);
    await noConclusion(page);
  });
}

for (const [status, code, message] of [
  [400, 'INVALID_REQUEST', '内容不符合要求'],
  [401, 'AUTHENTICATION_REQUIRED', '请重新登录后再试'],
  [403, 'CAPABILITY_NOT_OPENED', notOpened],
  [403, 'ACCESS_DENIED', '请刷新页面后再试'],
  [404, 'TENANT_NOT_FOUND', '暂时不能查看已开通功能'],
  [503, 'SERVICE_UNAVAILABLE', unavailable],
] as const) {
  test(`${status} ${code} 显示人话且删除旧结论`, async ({ page }) => {
    const { setReply, posts } = await fixture(page);
    await page.goto(href());
    await submit(page);
    await expect(results(page)).toContainText('没有发现需要注意的地方');
    setReply({ status, body: { contractVersion: '1.0', code, result: foundIssues.result } });
    await submitButton(page).click();
    await expect(page.getByRole('alert')).toHaveText(message);
    await noConclusion(page);
    expect(posts).toHaveLength(2);
  });
}

for (const status of [401, 403]) {
  test(`客户会话失效时 CSRF 返回 ${status}：引导登录或刷新，不 POST`, async ({ page }) => {
    const { posts } = await fixture(page);
    await page.goto(href());
    await page.context().clearCookies();
    await page.route('**/api/v1/auth/csrf', (route) =>
      route.fulfill({
        status,
        json: { contractVersion: '1.0', code: status === 401 ? 'AUTHENTICATION_REQUIRED' : 'ACCESS_DENIED' },
      }),
    );
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(
      status === 401 ? '请重新登录后再试' : '请刷新页面后再试',
    );
    await noConclusion(page);
    expect(posts).toEqual([]);
  });
}

test('提交中无旧结论且阻止重复提交；重试只保留当前结果', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { setReply, posts } = await fixture(page);
  await page.goto(href());
  await submit(page);
  await expect(results(page)).toContainText('没有发现需要注意的地方');
  setReply({ status: 201, body: foundIssues, wait });
  await submitButton(page).click();
  await expect(page.getByRole('button', { name: '提交中…', exact: true })).toBeDisabled();
  await expect(material(page)).toBeDisabled();
  await expect(results(page).getByRole('status')).toContainText('提交中');
  await noConclusion(page);
  await expect.poll(() => posts.length).toBe(2);
  release();
  await expect(results(page).getByRole('listitem')).toHaveText(['尺寸超差']);
  await expect(results(page)).not.toContainText('没有发现需要注意的地方');
  expect(posts).toHaveLength(2);
});

for (const kind of ['网络错误', '10 秒超时'] as const) {
  test(`${kind}显示暂不可用，无结论`, async ({ page }) => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { posts } = await fixture(
      page,
      'member',
      undefined,
      kind === '网络错误' ? { status: 503, networkError: true } : { status: 201, body: noIssues, wait },
    );
    await page.goto(href());
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(unavailable, { timeout: 15_000 });
    await noConclusion(page);
    await expect(submitButton(page)).toBeEnabled();
    expect(posts).toHaveLength(1);
    release();
  });
}

test('切企业丢弃旧结果和输入，在途响应也不能写入新企业页面', async ({ page }) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { setReply, posts } = await fixture(page);
  await page.goto(href());
  await submit(page);
  await expect(results(page)).toContainText('没有发现需要注意的地方');
  setReply({ status: 201, body: foundIssues, wait });
  await submitButton(page).click();
  await expect.poll(() => posts.length).toBe(2);
  await page.evaluate((id) => {
    location.hash = `tenant=${id}&view=quality-check`;
  }, other);
  await expect(submitButton(page)).toBeDisabled();
  await expect(material(page)).toHaveValue('');
  release();
  await noConclusion(page);
});
