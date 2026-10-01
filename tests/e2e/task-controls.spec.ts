import { test, expect } from '@playwright/test';
const tenant = '00000000-0000-4000-8000-000000000001',
  owner = '00000000-0000-4000-8000-000000000002',
  space = '00000000-0000-4000-8000-000000000003',
  conversation = '00000000-0000-4000-8000-000000000004',
  taskId = '00000000-0000-4000-8000-000000000005';
test('real conversation controls use bounded actions and render retained history; off mode can save tasks', async ({
  page,
}) => {
  let status = 'WAITING_INPUT',
    revision = 2;
  const actions: Record<string, unknown>[] = [];
  const task = () => ({
    id: taskId,
    prompt: '合成任务',
    mode: 'AGENT',
    status,
    revision,
    attempt: 1,
    summaryCode: null,
    errorCode: null,
    engineVersion: '0.11.0',
    sourcesUnavailable: false,
    sources: [],
    createdAt: '2026-10-01T00:00:00Z',
    reply: '已完成部分分析',
    executionClass: 'verification',
    modelName: 'synthetic',
    artifacts: [],
    publicQuery: null,
    webSources: [],
    skills: [],
    originals: [],
    waitReason: status === 'WAITING_INPUT' ? 'INPUT_REQUIRED' : null,
    requiredInput: '请补充截止日期',
    reconciliationRequired: false,
  });
  const info = {
    id: conversation,
    tenantId: tenant,
    workspaceId: space,
    title: '合成任务',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    let value: unknown = {};
    if (u.pathname === '/api/v1/me')
      value = {
        account: { id: owner, email: 'synthetic@example.test', displayName: '合成成员' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'MEMBER' }],
      };
    else if (u.pathname.endsWith('/context'))
      value = {
        tenant: { id: tenant, name: '合成企业', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [{ id: space, name: '合成空间', kind: 'PERSONAL' }],
      };
    else if (u.pathname.endsWith('/auth/csrf'))
      value = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' };
    else if (u.pathname.endsWith('/conversations'))
      value = {
        tenantId: tenant,
        enabled: true,
        agentMode: 'off',
        publicWebEnabled: false,
        items: [info],
        hasMore: false,
      };
    else if (u.pathname.endsWith('/attempts'))
      value = {
        taskId,
        hasMore: false,
        items: [
          {
            number: 1,
            status: 'WAITING_INPUT',
            input: '合成任务',
            reply: '已完成部分分析',
            summaryCode: null,
            errorCode: null,
            engineVersion: '0.11.0',
            modelName: 'synthetic',
            tools: [{ callId: 'receipt-1', name: 'task_control', status: 'succeeded' }],
            sources: [],
            artifacts: [],
            startedAt: '2026-10-01T00:00:00Z',
            finishedAt: '2026-10-01T00:00:01Z',
            provenance: 'RECORDED',
            reconciliationCode: null,
          },
        ],
      };
    else if (u.pathname.endsWith('/events'))
      value = {
        conversationId: conversation,
        items: [],
        cursor: Number(u.searchParams.get('after') || 0),
        hasMore: false,
      };
    else if (u.pathname.endsWith('/tasks/' + taskId) && req.method() === 'POST') {
      const body = req.postDataJSON();
      expect(req.headers()['x-csrf-token']).toBe('synthetic-csrf');
      actions.push(body);
      expect(body.expectedRevision).toBe(revision);
      revision++;
      status =
        body.action === 'PAUSE' ? 'PAUSED' : body.action === 'CANCEL' ? 'CANCELLED' : 'WAITING_CAPABILITY';
      value = { conversation: info, tasks: [task()], hasMore: false, cursor: revision };
    } else if (u.pathname.endsWith('/conversations/' + conversation))
      value = { conversation: info, tasks: [task()], hasMore: false, cursor: revision };
    else {
      await route.fulfill({ status: 404, json: { code: 'FIXTURE_UNKNOWN' } });
      return;
    }
    await route.fulfill({ json: value });
  });
  await page.goto(`/workspace/#tenant=${tenant}&view=conversations&conversation=${conversation}`);
  await expect(page.getByRole('button', { name: '提交补充并继续' })).toBeDisabled();
  await page.getByRole('button', { name: '查看执行历史' }).click();
  await expect(page.getByText('第 1 次执行', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '暂停任务', exact: true }).click();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  await page.getByLabel('补充本任务（可选）').fill('截止到周五');
  await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  await expect(page.getByText('等待所需能力', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  expect(actions.map((a) => a.action)).toEqual(['PAUSE', 'RESUME', 'CANCEL']);
  expect(actions[1].input).toBe('截止到周五');
  expect(new Set(actions.map((a) => a.requestId)).size).toBe(3);
  await page.getByLabel('任务方式').selectOption('AGENT');
  await expect(
    page.getByText('模型当前关闭。提交会保存任务并等待能力，不会调用模型；资料查找仍可正常执行。'),
  ).toBeVisible();
});
