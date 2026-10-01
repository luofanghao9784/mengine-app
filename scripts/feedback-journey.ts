/** Real HTTP and actual /workspace conversation route. Caller supplies an isolated, newly completed
 * AGENT task owned by this session in its personal workspace; no real model call is made here. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Feedback, FeedbackAction, FeedbackTarget } from '../contracts/public-api/feedback.ts';
type Probe = { armed: boolean; suffix: string; keys: string[]; status: number | null; receipt: unknown };
export async function feedbackJourney(
  page: Page,
  request: APIRequestContext,
  tenant: string,
  workspace: string,
  conversationId: string,
  taskId: string,
  artifacts: string,
) {
  const root = `/api/v1/tenants/${tenant}/feedback`;
  const detailResponse = await request.get(`/api/v1/tenants/${tenant}/conversations/${conversationId}`);
  assert.equal(detailResponse.status(), 200);
  const detail = await detailResponse.json(),
    task = detail.tasks.find((t: any) => t.id === taskId);
  assert.ok(task, 'Caller must supply a visible completed task');
  assert.equal(task.mode, 'AGENT');
  assert.equal(task.status, 'SUCCEEDED');
  const target: FeedbackTarget = {
    kind: 'TASK',
    taskId,
    taskRevision: task.revision,
    attempt: task.attempt,
    presentationVersion: 'task-v1',
    presentationRevision: 0,
  };
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(target).map(([k, v]) => [k, String(v)])),
  );
  const initial = await request.get(root + '?' + query);
  assert.equal(initial.status(), 200);
  assert.equal(
    (await initial.json()).feedback,
    null,
    'Use a fresh task, do not overwrite an existing evaluation',
  );
  async function post(path: string, body: unknown) {
    const token = await (await request.get('/api/v1/auth/csrf')).json();
    return request.post(root + path, { headers: { [token.headerName]: token.token }, data: body });
  }
  const capture: Probe = {armed:false,suffix:'/feedback',keys:[],status:null,receipt:null};
  const pattern = '**' + root + '**';
  await page.route(pattern, async route => {
    const req = route.request();
    if (req.method() !== 'POST' || !new URL(req.url()).pathname.endsWith(capture.suffix)) return route.continue();
    capture.keys.push(req.postDataJSON().requestId);
    const response = await route.fetch();
    if (capture.armed) {
      capture.armed = false; capture.status = response.status(); capture.receipt = await response.json();
      await route.abort('failed');
    } else await route.fulfill({response});
  });
  const arm = async (suffix: string) => Object.assign(capture, {armed:true,suffix,keys:[],status:null,receipt:null});
  const probe = async () => ({keys:[...capture.keys],status:capture.status,receipt:capture.receipt});
  try {
    await page.goto(
      `/workspace/#tenant=${tenant}&view=conversations&conversation=${conversationId}&task=${taskId}`,
    );
    const panel = page.locator(`.feedback-panel[data-feedback-kind="TASK"][data-task-id="${taskId}"]`);
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '评价 / 建议', exact: true }).click();
    await arm('/feedback');
    await panel.getByRole('button', { name: '部分达到', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(panel.getByRole('button', { name: '收起评价', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '刷新评价', exact: true })).toBeDisabled();
    const pinnedUrl = page.url();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByRole('button', { name: '重试同次提交', exact: true })).toBeVisible();
    await expect(page.getByLabel('当前企业', { exact: true })).toBeDisabled();
    await page.evaluate(() => { location.hash = '#view=briefing'; });
    await expect(page).toHaveURL(pinnedUrl);
    await expect(panel.getByRole('button', { name: '重试同次提交', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '重试同次提交', exact: true }).click();
    await expect(panel.locator('.feedback-notice')).toContainText('评价已保存');
    const first = await probe();
    assert.equal(first.status, 201);
    assert.equal(first.keys.length, 2);
    assert.equal(first.keys[0], first.keys[1]);
    const saved = first.receipt as Feedback;
    assert.equal(saved.tenantId, tenant);
    assert.equal(saved.workspaceId, workspace);
    assert.deepEqual(saved.target, target);
    assert.equal(saved.revision, 1);
    assert.equal((await (await request.get(root + `/${saved.id}/history`)).json()).items.length, 1);
    await panel.getByLabel('资料有缺口', { exact: true }).check();
    await panel
      .getByLabel('补充原因或改进建议', { exact: true })
      .fill('合成验收：需要人工核对本月数据，评价不是执行证据。');
    await panel.getByRole('button', { name: '保存评价与建议', exact: true }).click();
    await expect(panel.locator('.feedback-heading')).toContainText('评价修订 2');
    const concurrent = await post('/' + saved.id, {
      requestId: randomUUID(),
      expectedRevision: 2,
      assessment: { rating: 'PARTIAL', reasons: ['DATA_GAP'], suggestion: '另一页面已核对，当前缺口保留。' },
    });
    assert.equal(concurrent.status(), 200);
    await panel.getByLabel('补充原因或改进建议', { exact: true }).fill('旧页面不能覆盖更新。');
    const conflict = page.waitForResponse(
      (r) => r.url().endsWith(root + '/' + saved.id) && r.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '保存评价与建议', exact: true }).click();
    const response = await conflict;
    assert.equal(response.status(), 409);
    assert.equal((await response.json()).contractVersion, '1.0');
    await expect(panel.getByRole('alert')).toContainText('刷新');
    await panel.getByRole('button', { name: '刷新评价', exact: true }).click();
    await expect(panel.locator('.feedback-heading')).toContainText('评价修订 3');
    await panel.getByRole('button', { name: '设置个人表达偏好', exact: true }).click();
    await panel.getByLabel('偏好场景', { exact: true }).selectOption('WEEKLY_REPORT');
    await panel.getByLabel('表达偏好', { exact: true }).selectOption('TABLE_FIRST');
    await panel.locator('.feedback-confirm input').check();
    await panel.getByRole('button', { name: '确认并执行所选动作', exact: true }).click();
    await expect(panel.locator('.feedback-receipts')).toContainText('已写入个人偏好档案');
    await panel.getByRole('button', { name: '创建本次纠正任务', exact: true }).click();
    await panel
      .getByLabel('明确的本次纠正要求', { exact: true })
      .fill('请核对本月数字，缺少资料时保留缺口，不覆盖原成果。');
    await panel.locator('.feedback-confirm input').check();
    await arm('/actions');
    await panel.getByRole('button', { name: '确认并执行所选动作', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('同一次请求');
    await expect(panel.getByRole('button', { name: '撤回评价', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '整理经验候选', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '重试同次后续动作', exact: true }).click();
    await expect(panel.locator('.feedback-receipts')).toContainText('独立纠正任务已建立');
    const second = await probe();
    assert.equal(second.status, 201);
    assert.equal(second.keys.length, 2);
    assert.equal(second.keys[0], second.keys[1]);
    const correction = second.receipt as FeedbackAction;
    assert.equal(correction.status, 'TASK_CREATED');
    const correctionResponse = await request.get(
      `/api/v1/tenants/${tenant}/conversations/${correction.conversationId}`,
    );
    assert.equal(correctionResponse.status(), 200);
    const correctionDetail = await correctionResponse.json();
    assert.ok(correctionDetail.tasks.some((t: any) => t.id === correction.targetId));
    await panel.getByRole('button', { name: '整理经验候选', exact: true }).click();
    await panel
      .getByLabel('候选标题', { exact: true })
      .fill('离线反馈的人工核对方法 ' + randomUUID().slice(0, 8));
    await panel.getByLabel('候选摘要', { exact: true }).fill('明确区分已核对事实与资料缺口。');
    await panel
      .getByLabel('可复用方法与人工纠正', { exact: true })
      .fill('先核对本次资料版本，再整理差异；不能用历史经验补造本次事实。');
    await panel.getByLabel('适用前提', { exact: true }).fill('有本次获准的计划与实际记录。');
    await panel.getByLabel('不适用条件', { exact: true }).fill('不代表真实业务成功或已评测。');
    await panel.locator('.feedback-confirm input').check();
    await panel.getByRole('button', { name: '确认并执行所选动作', exact: true }).click();
    await expect(panel.locator('.feedback-receipts')).toContainText('经验候选已保存，尚未评测、未发布');
    const results = (await (await request.get(root + `/${saved.id}/actions`)).json())
      .items as FeedbackAction[];
    assert.equal(results.length, 3);
    assert.equal(results.filter((a) => a.kind === 'CORRECTION').length, 1);
    const candidate = results.find((a) => a.kind === 'EXPERIENCE_CANDIDATE')!;
    const experienceResponse = await request.get(
      `/api/v1/tenants/${tenant}/workspaces/${workspace}/experiences/${candidate.targetId}`,
    );
    assert.equal(experienceResponse.status(), 200);
    const experience = await experienceResponse.json();
    assert.equal(experience.status, 'CANDIDATE');
    assert.equal(experience.version.evaluation, 'NOT_EVALUATED');
    assert.equal(experience.version.content.accessMode, 'SOURCE_BOUND');
    assert.ok(experience.version.content.basis.includes(saved.id));
    await panel.getByRole('button', { name: '撤回评价', exact: true }).click();
    await expect(panel).toContainText('评价已撤回');
    const history = (await (await request.get(root + `/${saved.id}/history`)).json()).items;
    assert.equal(history[0].status, 'WITHDRAWN');
    assert.equal(history[0].revision, 4);
    assert.equal(history.length, 4);
    assert.equal((await (await request.get(root + `/${saved.id}/actions`)).json()).items.length, 3);
    await page.screenshot({ path: join(artifacts, 'feedback-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'feedback-mobile.png'), fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      'Actual feedback route must fit mobile viewport',
    );
    return {
      feedbackId: saved.id,
      feedbackRevision: 4,
      correctionTask: correction.targetId,
      candidateId: candidate.targetId,
      actions: results.length,
      requestRetries: 'same-key',
      executionClass: saved.snapshot.executionClass,
    };
  } catch (error) {
    await page.screenshot({path:join(artifacts,'feedback-failure.png'),fullPage:true});
    await writeFile(join(artifacts,'feedback-failure.txt'),await page.locator('body').innerText());
    throw error;
  } finally {
    await page.unroute(pattern);
  }
}
