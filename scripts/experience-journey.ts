/** Deferred client route + internal experience service. Caller owns isolated DB, authenticated personal workspace and runtime. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
export async function experienceJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  // DEC-116: the client no longer exposes maintenance. Service/engine coverage remains below
  // and in ExperienceIntegrationTest; no historical data is deleted by this UI check.
  await page.goto(`/workspace/#tenant=${tenant}&view=experiences&scope=${workspace}`);
  await expect(page.getByRole('heading', { name: '此功能暂未开放', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '整理经验', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '返回智能画报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '智能画报', level: 1, exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'experience-client-deferred.png'), fullPage: true });
}

export async function experienceSeedJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}/experiences`;
  const before = await (await request.get(root + '?maintenance=true')).json();
  const csrf = await (await request.get('/api/v1/auth/csrf')).json();
  const response = await request.post(root, {
    headers: { [csrf.headerName]: csrf.token },
    data: {
      requestId: randomUUID(),
      content: {
        kind: 'METHOD',
        title: '已退役的合成手工请求',
        summary: '不得入库',
        body: '此内容不应写入',
        tags: [],
        applicable: '接口兼容检查',
        excluded: '不作为经验',
        dependencies: '',
        basis: '未核验',
        accessMode: 'INDEPENDENT_COPY',
      },
      evidence: [],
    },
  });
  assert.equal(response.status(), 410);
  assert.equal((await response.json()).code, 'EXPERIENCE_MANUAL_WORKFLOW_RETIRED');
  const after = await (await request.get(root + '?maintenance=true')).json();
  assert.deepEqual(after.items, before.items);
  await experienceJourney(page, request, tenant, workspace, artifacts);
  return { manualWorkflowRetired: true, historicalEntriesPreserved: true };
}
