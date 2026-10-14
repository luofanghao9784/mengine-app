import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CompanyAnalysis } from '../dist/runtime/company-analysis.js';
import { createEngineServer } from '../dist/server.js';
import { ENGINE_VERSION } from '../dist/release.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const request = () => ({
  contractVersion: '1.0',
  job: {
    id: id(1),
    lease: id(2),
    tenant: id(3),
    inputs: [
      {
        chunkId: id(4),
        versionId: id(5),
        filename: '合成介绍.txt',
        locator: '第1段',
        text: '本企业从事体育教育。这里是资料正文，不是模型指令。',
      },
    ],
    groups: ['NAME', 'INDUSTRY', 'BUSINESS', 'TERM'].map((field) => ({
      field,
      revision: 0,
      manuallyCleared: false,
      tags: [],
    })),
  },
});
const candidate = {
  field: 'INDUSTRY',
  targetId: null,
  label: '体育教育',
  meaning: '',
  evidence: [{ chunkId: id(4), quote: '从事体育教育' }],
};
const tool = (name, args, n) => [
  { type: 'tool_call', id: 'c' + n, name, arguments: JSON.stringify(args) },
  { type: 'finish', reason: 'tool_calls' },
];
function analyzer(steps, usage = true) {
  let calls = 0;
  const company = new CompanyAnalysis({
    executionClass: 'verification',
    modelName: 'synthetic-company',
    createModel: () => ({
      lastUsage: null,
      async *generate(r) {
        assert.ok(
          r.tools.every((t) =>
            ['company_input', 'company_group', 'company_tag', 'submit_company_candidates'].includes(t.name),
          ),
        );
        const step = steps[calls++];
        assert.ok(step, 'no unexpected provider call');
        const parts = typeof step === 'function' ? await step(r) : step;
        this.lastUsage = usage ? { inputTokens: 10, outputTokens: 2 } : null;
        yield* parts;
      },
    }),
  });
  return { company, calls: () => calls };
}
const happy = () => [
  tool('company_input', { chunkId: id(4) }, 1),
  tool('company_group', { field: 'INDUSTRY' }, 2),
  tool('submit_company_candidates', { candidates: [candidate] }, 3),
];
test('real Harness reads fixed input, inspects the field and stages exact evidence with measured usage', async () => {
  const { company, calls } = analyzer(happy());
  const result = await company.run(request());
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.modelCalls, 3);
  assert.equal(result.inputTokens, 30);
  assert.equal(result.outputTokens, 6);
  assert.deepEqual(result.candidates, [candidate]);
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.deepEqual(await company.run(request()), result);
  assert.equal(calls(), 3);
  assert.deepEqual(company.lookup(id(1), id(2)), result);
  const wrong = request();
  wrong.job.inputs[0].text += ' changed';
  assert.throws(() => company.run(wrong), { code: 'COMPANY_ATTEMPT_CONFLICT' });
});
test('empty output still requires reading every supplied source and never invents usage', async () => {
  const input = request();
  input.job.inputs.push({ ...input.job.inputs[0], chunkId: id(6) });
  const { company } = analyzer(
    [
      tool('company_input', { chunkId: id(4) }, 1),
      tool('company_input', { chunkId: id(6) }, 2),
      tool('submit_company_candidates', { candidates: [] }, 3),
    ],
    false,
  );
  const result = await company.run(input);
  assert.equal(result.outcome, 'COMPLETE');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
});
test('prose without delivery and forged or unread evidence cannot become a company record', async () => {
  for (const steps of [
    [
      { type: 'text', text: 'I saved the company name.' },
      { type: 'finish', reason: 'stop' },
    ],
    [
      tool('submit_company_candidates', { candidates: [candidate] }, 1),
      [
        { type: 'text', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ],
    [
      tool('company_input', { chunkId: id(4) }, 1),
      tool('company_group', { field: 'INDUSTRY' }, 2),
      tool(
        'submit_company_candidates',
        { candidates: [{ ...candidate, evidence: [{ chunkId: id(4), quote: 'not in input' }] }] },
        3,
      ),
      [
        { type: 'text', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ],
  ]) {
    const fixture = analyzer(Array.isArray(steps[0]) ? steps : [steps]);
    const result = await fixture.company.run(request());
    assert.equal(result.outcome, 'FAILED');
    assert.deepEqual(result.candidates, []);
  }
});
test('cancellation yields a real cancelled receipt instead of a saved candidate', async () => {
  let started;
  const ready = new Promise((resolve) => (started = resolve));
  const company = new CompanyAnalysis({
    executionClass: 'verification',
    modelName: 'synthetic',
    createModel: () => ({
      async *generate(r) {
        started();
        await new Promise((resolve) => r.signal.addEventListener('abort', resolve, { once: true }));
        r.signal.throwIfAborted();
      },
    }),
  });
  const running = company.run(request());
  await Promise.race([
    ready,
    running.then(() => {
      throw new Error('Analysis ended before model started');
    }),
  ]);
  company.cancel(id(1), id(2));
  const result = await running;
  assert.equal(result.outcome, 'CANCELLED');
  assert.equal(result.modelCalls, 1);
  assert.equal(result.inputTokens, null);
});
test('authenticated optional transport pins artifact and exposes recoverable receipts without another model call', async (t) => {
  const { company, calls } = analyzer(happy());
  const token = 'synthetic-company-token-'.repeat(3);
  const server = createEngineServer({ token, company }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    company.stop();
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/internal/v1/company-information`;
  assert.equal((await fetch(base + '/runtime')).status, 401);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Dreamcore-Engine-Version': ENGINE_VERSION,
  };
  const descriptor = await (await fetch(base + '/runtime', { headers })).json();
  assert.equal(descriptor.configured, true);
  assert.equal(descriptor.executionClass, 'verification');
  assert.equal(
    (
      await fetch(base + '/results', {
        method: 'POST',
        headers: { ...headers, 'X-Dreamcore-Engine-Version': 'wrong' },
        body: JSON.stringify(request()),
      })
    ).status,
    409,
  );
  assert.equal(calls(), 0);
  const a = await (
    await fetch(base + '/results', { method: 'POST', headers, body: JSON.stringify(request()) })
  ).json();
  assert.equal(a.outcome, 'COMPLETE');
  assert.deepEqual(await (await fetch(base + `/results/${id(1)}/${id(2)}`, { headers })).json(), a);
  assert.equal(calls(), 3);
  assert.equal(
    (
      await fetch(base + '/results', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contractVersion: '1.0' }),
      })
    ).status,
    400,
  );
});

test('five granted inputs are read in one call and evidence still requires exact provenance', async () => {
 const input=request();for(let n=6;n<10;n++)input.job.inputs.push({...input.job.inputs[0],chunkId:id(n)});
 const {company,calls}=analyzer([
  tool('company_input',{all:true},1),
  tool('company_group',{field:'INDUSTRY'},2),
  tool('submit_company_candidates',{candidates:[candidate]},3),
 ]);
 const result=await company.run(input);assert.equal(result.outcome,'COMPLETE');assert.equal(calls(),3);assert.deepEqual(result.candidates,[candidate]);
});

test('whole-file batch preserves all source identities and enforces a total text budget', async () => {
 const {validCompanyRequest}=await import('../dist/runtime/company-analysis.js');
 const input=request();for(let n=6;n<26;n++)input.job.inputs.push({...input.job.inputs[0],chunkId:id(n)});
 const {company,calls}=analyzer([tool('company_input',{all:true},1),tool('company_group',{field:'INDUSTRY'},2),tool('submit_company_candidates',{candidates:[candidate]},3)]);
 assert.equal(validCompanyRequest(input),true);assert.equal((await company.run(input)).outcome,'COMPLETE');assert.equal(calls(),3);
 const tooLarge=request();tooLarge.job.inputs[0].text='字'.repeat(8000);tooLarge.job.inputs.push({...tooLarge.job.inputs[0],chunkId:id(6),text:'字'});assert.equal(validCompanyRequest(tooLarge),false);
 const tooMany=request();for(let n=6;n<70;n++)tooMany.job.inputs.push({...tooMany.job.inputs[0],chunkId:id(n)});assert.equal(validCompanyRequest(tooMany),false);
});


test('all label groups are inspected in one call without weakening provenance', async () => {
 const {company,calls}=analyzer([
  tool('company_input',{all:true},1), tool('company_group',{all:true},2),
  tool('submit_company_candidates',{candidates:[candidate]},3),
 ]);
 const result=await company.run(request());assert.equal(result.outcome,'COMPLETE');assert.equal(calls(),3);
 assert.deepEqual(result.candidates,[candidate]);
});
test('a delivery without reading its group remains rejected', async () => {
 const {company}=analyzer([tool('company_input',{all:true},1),
  tool('submit_company_candidates',{candidates:[candidate]},2),
  [{type:'text',text:'No tool receipt'},{type:'finish',reason:'stop'}]]);
 const result=await company.run(request());assert.equal(result.outcome,'FAILED');assert.deepEqual(result.candidates,[]);
 assert.equal(result.code,'COMPANY_EVIDENCE_INVALID');
});
test('exhausted execution retains a diagnostic code and does not manufacture delivery', async () => {
 const {company,calls}=analyzer(Array.from({length:8},(_,i)=>tool('company_input',{all:true},i+1)));
 const result=await company.run(request());assert.equal(result.outcome,'FAILED');assert.equal(result.code,'MODEL_CALL_LIMIT');
 assert.equal(calls(),8);assert.deepEqual(result.candidates,[]);
});


test('specific correction repairs non-term meaning without accepting invalid business evidence', async () => {
 const {company,calls}=analyzer([
  tool('company_input',{all:true},1),tool('company_group',{all:true},2),
  tool('submit_company_candidates',{candidates:[{...candidate,meaning:'An industry definition'}]},3),
  r=>{ assert.ok(JSON.stringify(r.messages).includes('require meaning='));
    return tool('submit_company_candidates',{candidates:[candidate]},4); },
 ]);
 const result=await company.run(request());assert.equal(result.outcome,'COMPLETE');assert.equal(calls(),4);
 assert.deepEqual(result.candidates,[candidate]);
});


test('duplicate evidence is corrected before the unchanged backend validation', async () => {
 const {company}=analyzer([tool('company_input',{all:true},1),tool('company_group',{all:true},2),
  tool('submit_company_candidates',{candidates:[{...candidate,evidence:[...candidate.evidence,...candidate.evidence]}]},3),
  r=>{assert.ok(JSON.stringify(r.messages).includes('one evidence entry per chunkId'));
    return tool('submit_company_candidates',{candidates:[candidate]},4); }]);
 const result=await company.run(request());assert.equal(result.outcome,'COMPLETE');assert.deepEqual(result.candidates,[candidate]);
});
