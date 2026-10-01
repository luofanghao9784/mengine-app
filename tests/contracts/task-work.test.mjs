import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8')),
  spec = await read('../../contracts/public-api/task-work.openapi.json'),
  internal = await read('../../contracts/engine-api/task-work.schema.json'),
  execution = await read('../../contracts/engine-api/task-execution-control.schema.json');
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } }),
  id = '00000000-0000-4000-8000-000000000001';
test('only current owner receipt reads and exact CSRF undo are public', () => {
  assert.equal(Object.keys(spec.paths).length, 3);
  for (const p of Object.values(spec.paths))
    if (p.post)
      assert.ok(p.post.parameters.some((p) => p.in === 'header' && p.name === 'X-CSRF-TOKEN' && p.required));
  assert.ok(ajv.compile(spec.components.schemas.Undo)({ requestId: id }));
  assert.equal(ajv.compile(spec.components.schemas.Undo)({ requestId: id, expectedRevision: 999 }), false);
});
test('plan callback accepts one scheduled time but forbids identity, authority and budget mutations', () => {
  const check = ajv.compile(internal.$defs.planRequest),
    value = {
      action: 'schedule',
      requestId: id,
      expectedRevision: 1,
      checkAt: '2026-10-02T00:00:00Z',
      reason: '核对原委托',
    };
  assert.ok(check(value));
  for (const field of ['owner', 'workspaceId', 'query', 'budget', 'maxTotalRuns', 'recipient', 'expiresAt'])
    assert.equal(check({ ...value, [field]: 'changed' }), false);
  assert.equal(check({ ...value, expectedRevision: 0 }), false);
});
test('preference callback is finite and old registration cannot gain either write tool', () => {
  const check = ajv.compile(internal.$defs.preferenceRequest);
  const input = {
    action: 'save',
    requestId: id,
    expectedRevision: 0,
    category: 'RESPONSE_LENGTH',
    choice: 'CONCISE',
    evidenceSource: 'PROMPT',
    evidenceOffset: 0,
    evidence: '请记住，以后回答简洁一些',
  };
  assert.ok(check(input));
  for (const extra of [
    { category: 'ROLE' },
    { choice: 'AUTO_PUBLISH' },
    { evidenceSource: 'HISTORY' },
    { scope: 'TENANT' },
    { value: 'arbitrary user text' },
  ])
    assert.equal(check({ ...input, ...extra }), false);
  const open = ajv.compile(execution.$defs.open);
  assert.ok(open({ contractVersion: '1.6', tools: ['task_preference'] }));
  assert.equal(open({ contractVersion: '1.5', tools: ['task_preference'] }), false);
  assert.equal(open({ contractVersion: '1.5', tools: ['task_plan'] }), false);
});
test('interactive continuing plan requires current evidence and exact version, without user-supplied authority',async()=>{
 const schema=await read('../../contracts/engine-api/plan-management.schema.json'),check=ajv.compile(schema);
 const create={action:'create',workspaceId:id,goal:'销售简报',query:'整理资料',dailyTime:'09:00',evidence:'本月每天09:00根据个人资料整理销售简报。'};
 assert.ok(check(create));assert.ok(check({action:'read'}));assert.equal(check({...create,recipient:id}),false);
 assert.equal(check({action:'pause',planId:id,evidence:'暂停计划'}),false);assert.equal(check({...create,dailyTime:'29:00'}),false);assert.equal(check({action:'read',evidence:'无关内容'}),false);
});
