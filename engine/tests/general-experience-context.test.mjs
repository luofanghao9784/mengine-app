import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { contextTool, contextResponse } from '../dist/runtime/task-context.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
const entry = randomUUID(),
  version = randomUUID(),
  key = randomUUID();
const summary = {
  entryId: entry,
  versionId: version,
  number: 1,
  title: '合成核对方法',
  summary: '查看执行依据',
  tags: ['核对'],
  authority: false,
};
const detail = {
  ...summary,
  steps: ['步骤一', '步骤二', '步骤三'],
  offset: 0,
  nextOffset: 3,
  totalSteps: 4,
  applicable: ['存在执行记录'],
  excluded: ['缺少记录'],
  basis: 'OBSERVED_EXECUTION',
  requiresApplicabilityCheck: true,
};
const selection = {
  id: randomUUID(),
  versionId: version,
  attempt: 1,
  decision: 'ADAPTED',
  conditions: '输入与工具匹配',
  adjustments: '按本任务格式调整',
  selectionRecorded: true,
  assessmentSource: 'MODEL_REPORTED',
  applicationOutcome: 'UNKNOWN',
  businessActionPerformed: false,
};
const envelope = (action, result) => ({ contractVersion: '1.0', action, referenceOnly: true, result });
const use = {
  action: 'general_experience_use',
  referenceId: entry,
  versionId: version,
  requestId: key,
  decision: 'ADAPTED',
  conditions: selection.conditions,
  adjustments: selection.adjustments,
};
test('general actions require an advertised bridge and strict reference-only arguments', async () => {
  let calls = 0;
  const invoke = async () => {
    calls++;
    return {};
  };
  const old = contextTool(invoke, async () => {}),
    tool = contextTool(invoke, async () => {}, false, true);
  assert.ok(!old.parameters.properties.action.enum.includes('general_experience_read'));
  assert.ok(tool.parameters.properties.action.enum.includes('general_experience_read'));
  await assert.rejects(old.execute(use), /INVALID_CONTEXT_REQUEST/);
  for (const input of [
    { ...use, actorId: entry },
    { ...use, tenantId: entry },
    { ...use, adjustments: '' },
    { ...use, decision: 'SUCCEEDED' },
    { action: 'general_experience_read', referenceId: entry, versionId: version, offset: 10 },
    { action: 'general_experience_search', query: '' },
  ])
    await assert.rejects(tool.execute(input), /INVALID_CONTEXT_REQUEST/);
  assert.equal(calls, 0);
});
test('general responses reject source provenance, fabricated outcomes and invalid step pages', () => {
  assert.doesNotThrow(() =>
    contextResponse(envelope('general_experience_read', detail), 'general_experience_read'),
  );
  for (const field of ['tenantId', 'sourceId', 'runId', 'actorId', 'evidence'])
    assert.throws(
      () =>
        contextResponse(
          envelope('general_experience_read', { ...detail, [field]: entry }),
          'general_experience_read',
        ),
      /INVALID_CONTEXT_RESPONSE/,
    );
  for (const invalid of [
    { ...detail, nextOffset: 2 },
    { ...detail, offset: 3 },
    { ...detail, steps: [] },
    { ...detail, basis: 'PROVEN_SUCCESS' },
  ])
    assert.throws(
      () => contextResponse(envelope('general_experience_read', invalid), 'general_experience_read'),
      /INVALID_CONTEXT_RESPONSE/,
    );
  for (const invalid of [
    { ...selection, applicationOutcome: 'SUCCEEDED' },
    { ...selection, businessActionPerformed: true },
    { ...selection, decision: 'UNKNOWN' },
    { ...selection, sourceId: entry },
  ])
    assert.throws(
      () => contextResponse(envelope('general_experience_use', invalid), 'general_experience_use'),
      /INVALID_CONTEXT_RESPONSE/,
    );
  assert.doesNotThrow(() =>
    contextResponse(envelope('general_experience_use', selection), 'general_experience_use'),
  );
});
test('tool rejects a different version or step offset even when the response is otherwise valid', async () => {
  const tool = contextTool(
    async () => envelope('general_experience_read', detail),
    async () => {},
    false,
    true,
  );
  await assert.rejects(
    tool.execute({ action: 'general_experience_read', referenceId: entry, versionId: randomUUID() }),
    /INVALID_CONTEXT_RESPONSE/,
  );
  await assert.rejects(
    tool.execute({ action: 'general_experience_read', referenceId: entry, versionId: version, offset: 1 }),
    /INVALID_CONTEXT_RESPONSE/,
  );
  assert.deepEqual(
    await tool.execute({ action: 'general_experience_read', referenceId: entry, versionId: version }),
    envelope('general_experience_read', detail),
  );
});
test('actual HTTP and Harness perform search, complete step reads and private selection without claiming business success', async (t) => {
  const actions = [];
  let calls = 0;
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check'))
      return json(res, {
        allowed: true,
        executionClass: 'verification',
        contextVersion: '1.0',
        generalExperienceVersion: '1.0',
      });
    if (req.url.endsWith('/execution/open'))
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/execution/tool')) return json(res, { accepted: true });
    if (req.url.endsWith('/context')) {
      actions.push(input.action);
      const result =
        input.action === 'bootstrap'
          ? {}
          : input.action === 'general_experience_search'
            ? { items: [summary], hasMore: false, scope: 'GENERAL_CLEANED', applicationOutcome: 'UNKNOWN' }
            : input.action === 'general_experience_use'
              ? selection
              : input.offset === 3
                ? { ...detail, steps: ['步骤四'], offset: 3, nextOffset: null }
                : detail;
      return json(res, envelope(input.action, result));
    }
    return json(res, {}, 404);
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'synthetic-general-context',
    createModel: () => ({
      usage: null,
      async *generate(request) {
        assert.ok(
          request.tools
            .find((t) => t.name === 'task_context')
            .parameters.properties.action.enum.includes('general_experience_use'),
        );
        const args = [
          { action: 'general_experience_search', query: '核对' },
          { action: 'general_experience_read', referenceId: entry, versionId: version },
          { action: 'general_experience_read', referenceId: entry, versionId: version, offset: 3 },
          use,
        ][calls++];
        if (args) {
          yield {
            type: 'tool_call',
            id: 'general-' + calls,
            name: 'task_context',
            arguments: JSON.stringify(args),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          yield { type: 'text', text: '按通用方法整理草稿，业务效果尚未验证。' };
          yield { type: 'finish', reason: 'stop' };
        }
      },
    }),
  });
  const result = await agent.run(
    { contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(), prompt: '仅整理草稿' },
    new AbortController().signal,
  );
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.tools.length, 4);
  assert.ok(result.tools.every((t) => t.status === 'succeeded'));
  assert.deepEqual(actions, [
    'bootstrap',
    'general_experience_search',
    'general_experience_read',
    'general_experience_read',
    'general_experience_use',
  ]);
});
