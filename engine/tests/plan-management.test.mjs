import test from 'node:test';
import assert from 'node:assert/strict';
import { planManagementTool, validPlanCommand } from '../dist/runtime/plan-management.js';
const id = '00000000-0000-4000-8000-000000000001';
const create = {
  action: 'create',
  workspaceId: id,
  goal: '销售简报',
  query: '整理销售资料',
  dailyTime: '09:00',
  evidence: '本月每天09:00根据个人资料整理销售简报。',
};
test('continuing work is bounded before callback and never accepts model-supplied authority', async () => {
  assert.ok(validPlanCommand(create));
  assert.ok(validPlanCommand({ action: 'read' }));
  assert.ok(validPlanCommand({ action: 'pause', planId: id, expectedRevision: 1, evidence: '暂停销售简报' }));
  for (const input of [
    { ...create, recipient: id },
    { ...create, dailyTime: '25:00' },
    { ...create, evidence: 'x'.repeat(2001) },
    { ...create, query: '' },
    { action: 'resume', planId: id, evidence: '恢复计划' },
    { action: 'read', ownerId: id },
  ])
    assert.equal(validPlanCommand(input), false);
  let called = false;
  const tool = planManagementTool(
    async () => {
      called = true;
      return {};
    },
    async () => {},
  );
  await assert.rejects(() => tool.execute({ ...create, ownerId: id }));
  assert.equal(called, false);
});
test('accepted commands require platform plan identity and revision; missing conditions remain unsaved', async () => {
  for (const response of [{ text: '已安排' }, { saved: true, receipt: {} }])
    await assert.rejects(() =>
      planManagementTool(
        async () => response,
        async () => {},
      ).execute(create),
    );
  const refusal = { saved: false, reason: 'END_DATE_REQUIRED' };
  assert.deepEqual(
    await planManagementTool(
      async () => refusal,
      async () => {},
    ).execute(create),
    refusal,
  );
  const receipt = { saved: true, receipt: { acceptedRevision: 2, plan: { id } } };
  assert.deepEqual(
    await planManagementTool(
      async () => receipt,
      async () => {},
    ).execute(create),
    receipt,
  );
});

test('actual Harness registers interactive plan commands and records start before the callback', async (t) => {
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { createServer } = await import('node:http');
  const { randomUUID } = await import('node:crypto');
  const { listen, close, body, json } = await import('./fixtures/agent.mjs');
  const { usageFixture } = await import('./fixtures/usage.mjs');
  for (const background of [false, true]) {
    let started = false,
      calls = 0,
      invoked = false;
    const server = createServer(async (req, res) => {
      if (usageFixture(req, res)) return;
      const input = await body(req);
      if (req.url.endsWith('/check'))
        return json(res, {
          allowed: true,
          executionClass: 'verification',
          taskWorkVersion: '1.0',
          planManagementVersion: '1.0',
          planAllowed: background,
        });
      if (req.url.endsWith('/execution/open')) {
        assert.equal(input.tools.includes('manage_plan'), !background);
        return json(res, { accepted: true, policy: 'SCOPED_PRIVATE_V2' });
      }
      if (req.url.endsWith('/execution/tool')) {
        if (input.name === 'manage_plan' && input.status === 'STARTED') started = true;
        return json(res, { accepted: true });
      }
      if (req.url.endsWith('/manage-plan')) {
        assert.ok(started);
        assert.equal(background, false);
        invoked = true;
        return json(res, { saved: true, receipt: { acceptedRevision: 2, plan: { id } } });
      }
      return json(res, { code: 'UNEXPECTED' }, 404);
    });
    const url = await listen(server);
    t.after(() => close(server));
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'synthetic-plan',
      createModel: () => ({
        usage: null,
        async *generate(req) {
          calls++;
          assert.equal(
            req.tools.some((t) => t.name === 'manage_plan'),
            !background,
          );
          if (calls === 1 && !background) {
            yield { type: 'tool_call', id: 'plan-1', name: 'manage_plan', arguments: JSON.stringify(create) };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            yield { type: 'text', text: '合成计划协议验证完成。' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      }),
    });
    const result = await agent.run(
      { contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(), prompt: create.evidence },
      new AbortController().signal,
    );
    assert.equal(result.outcome, 'COMPLETE');
    assert.equal(invoked, !background);
  }
});
