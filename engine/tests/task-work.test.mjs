import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runHarness } from '../dist/runtime/harness.js';
import { workTools, workResponse } from '../dist/runtime/task-work.js';
import { TASK_RULES_VERSION, capabilityDirectory } from '../dist/runtime/task-rules.js';
test('ordinary task gets no plan tool and both tool schemas register with actual Harness', async () => {
  assert.equal(
    workTools(
      async () => ({}),
      async () => {},
      false,
    ).some((t) => t.name === 'task_plan'),
    false,
  );
  const tools = workTools(
    async () => ({}),
    async () => {},
    true,
  );
  const r = await runHarness({
    prompt: '合成协议验证',
    tools,
    model: {
      async *generate(req) {
        assert.ok(req.tools.some((t) => t.name === 'task_plan'));
        yield { type: 'text', text: '只验证工具注册，不执行任何写入。' };
        yield { type: 'finish', reason: 'stop' };
      },
    },
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.modelCalls, 1);
  assert.equal(TASK_RULES_VERSION, '1.4.1');
  assert.match(capabilityDirectory(['task_preference']), /explicit current-user/);
});
test('invalid schedule and oversized evidence are rejected before calling platform', async () => {
  let calls = 0;
  const tools = workTools(
    async () => {
      calls++;
      return {};
    },
    async () => {},
    true,
  );
  for (const args of [
    { action: 'schedule', requestId: randomUUID(), expectedRevision: 1, checkAt: 'not-date', reason: 'x' },
    {
      action: 'schedule',
      requestId: randomUUID(),
      expectedRevision: 0,
      checkAt: new Date().toISOString(),
      reason: 'x',
    },
  ])
    await assert.rejects(tools[1].execute(args), /INVALID_TASK_WORK_REQUEST/);
  await assert.rejects(
    tools[0].execute({
      action: 'save',
      requestId: randomUUID(),
      expectedRevision: 0,
      evidenceOffset: 0,
      evidence: 'x'.repeat(201),
    }),
    /INVALID_TASK_WORK_REQUEST/,
  );
  assert.equal(calls, 0);
});
test('write result is a checked server envelope and cannot claim success from arbitrary text', async () => {
  assert.throws(
    () => workResponse({ contractVersion: '1.0', action: 'save', result: 'saved' }, 'save'),
    /INVALID_TASK_WORK_RESPONSE/,
  );
  const tool = workTools(
    async () => ({
      contractVersion: '1.0',
      action: 'save',
      result: { saved: false, reason: 'EXPLICIT_CURRENT_INPUT_REQUIRED' },
    }),
    async () => {},
    false,
  )[0];
  const result = await tool.execute({
    action: 'save',
    requestId: randomUUID(),
    expectedRevision: 0,
    evidenceOffset: 0,
    evidence: '不明确',
  });
  assert.equal(result.result.saved, false);
});
