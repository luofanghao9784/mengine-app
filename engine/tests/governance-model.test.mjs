import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { GovernanceModel } from '../dist/runtime/governance-model.js';
import { createEngineServer } from '../dist/server.js';
import { listen, close } from './fixtures/agent.mjs';
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const input = (extra = {}) => {
  const context = { kind: 'DATASET', columns: ['编号'], rowCount: 1, ...extra };
  const prompt = '合成元数据治理测试';
  const messages = [{ role: 'system', content: [{ type: 'text', text: prompt }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify(canonical(context)) }] }];
  return { contractVersion: '2.0', jobId: randomUUID(), attempt: 1, executor: 'SYSTEM_MODEL', context, prompt, messages,
    inputHash: createHash('sha256').update(JSON.stringify(canonical(messages))).digest('hex') };
};
const output = { title: '合成草稿', summary: '只核对元数据', limitations: ['口径未知'],
  fields: [{ column: '编号', decision: 'UNKNOWN', meaning: '待核实', unit: '', evidence: '无来源依据' }], evidence: [], knowledge: [] };
test('same job shares one model call and returns a bound draft, never publication', async () => {
  let calls = 0;
  const runtime = new GovernanceModel({ modelName: 'fixture', createModel: () => ({ async *generate(r) {
    calls++; assert.deepEqual(r.tools, []); assert.equal(r.maxTokens, 8192);
    yield { type: 'text', text: JSON.stringify(output) }; yield { type: 'finish', reason: 'stop' };
  } }) });
  const req = input();
  const [a, b] = await Promise.all([runtime.run(req), runtime.run(req)]);
  assert.deepEqual(a, b); assert.equal(calls, 1); assert.equal(a.inputHash, req.inputHash);
  assert.deepEqual(a.output, output); assert.equal(a.published, undefined);
  await runtime.run(req); assert.equal(calls, 1);
  await runtime.run({ ...req, attempt: 3 }); assert.equal(calls, 2);
  await assert.rejects(runtime.run({ ...input({ rowCount: 2 }), jobId: req.jobId }), { code: 'GOVERNANCE_INPUT_MISMATCH' });
});
test('reject raw rows, tampered messages and unsupported executors before model execution', async () => {
  const runtime = new GovernanceModel({ modelName: 'fixture', createModel: () => { throw Error('must not call'); } });
  await assert.rejects(runtime.run(input({ rows: [['private']] })), { code: 'INVALID_GOVERNANCE_REQUEST' });
  await assert.rejects(runtime.run({ ...input(), executor: 'CODEX' }), { code: 'INVALID_GOVERNANCE_REQUEST' });
  const req = input(); req.messages[1].content[0].text = 'tampered';
  await assert.rejects(runtime.run(req), { code: 'GOVERNANCE_INPUT_MISMATCH' });
});
test('malformed or truncated model responses never become successful drafts; explicit retry can run again', async () => {
  let calls = 0;
  const runtime = new GovernanceModel({ modelName: 'fixture', createModel: () => ({ async *generate() {
    calls++; yield { type: 'text', text: '{bad secret response' }; yield { type: 'finish', reason: 'length' };
  } }) });
  const req = input();
  for (let i = 0; i < 2; i++) await assert.rejects(runtime.run(req), { code: 'GOVERNANCE_OUTPUT_INVALID' });
  assert.equal(calls, 2);
});
test('governance transport requires authentication and a live configured runtime', async t => {
  const token = 'synthetic-token-'.repeat(4);
  const disabled = createEngineServer({ token }); const disabledURL = await listen(disabled); t.after(() => close(disabled));
  assert.equal((await fetch(disabledURL + '/internal/v1/governance-model', { method: 'POST' })).status, 401);
  assert.equal((await fetch(disabledURL + '/internal/v1/governance-model', { method: 'POST', headers: { authorization: 'Bearer ' + token } })).status, 503);
  const live = createEngineServer({ token, agent: { config: { executionClass: 'live', modelName: 'synthetic', createModel: () => ({ async *generate() {
    yield { type: 'text', text: JSON.stringify(output) }; yield { type: 'finish', reason: 'stop' };
  } }) } } }); const url = await listen(live); t.after(() => close(live));
  const result = await fetch(url + '/internal/v1/governance-model', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).output, output);
});
