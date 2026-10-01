/** Deferred client route + internal experience service. Caller owns isolated DB, authenticated personal workspace and runtime. */
import assert from 'node:assert/strict';
import { experienceSeeds } from '../src/experience/seeds.ts';
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
    data: { requestId: randomUUID(), content: experienceSeeds[0], evidence: [] },
  });
  assert.equal(response.status(), 201);
  const entry = await response.json();
  assert.equal(entry.status, 'CANDIDATE');
  assert.equal(entry.version.content.kind, 'METHOD');
  assert.equal(entry.version.evaluation, 'NOT_EVALUATED');
  assert.deepEqual(entry.version.evidence, []);
  assert.ok(entry.version.content.basis.includes('v1.0'));
  assert.ok(entry.version.content.excluded.includes('不替代专业审计'));
  assert.equal(
    (await (await request.get(root + '?maintenance=true')).json()).items.length,
    before.items.length + 1,
  );
  assert.ok(!(await (await request.get(root)).json()).items.some((v: any) => v.id === entry.id));
  await experienceJourney(page, request, tenant, workspace, artifacts);
  return {
    entryId: entry.id,
    state: entry.status,
    evaluation: entry.version.evaluation,
    seed: 'reporting-source-check-v1.0',
  };
}
