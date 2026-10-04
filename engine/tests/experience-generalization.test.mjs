import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  ExperienceGeneralization,
  validGeneralizationRequest,
  privacyChecks,
  qualityChecks,
} from '../dist/runtime/experience-generalization.js';
import { createEngineServer } from '../dist/server.js';
import { ENGINE_VERSION } from '../dist/release.js';
const spec = JSON.parse(
  readFileSync(
    new URL('../../contracts/engine-api/experience-generalization.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true } });
ajv.addSchema(spec);
const validResult = ajv.compile({ $ref: spec.$id + '#/$defs/Result' }),
  validRequest = ajv.compile({ $ref: spec.$id + '#/$defs/Request' });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const method = () => ({
  title: '先核对期间覆盖范围',
  summary: '比较前核对两个期间的覆盖口径。',
  steps: ['核对两期覆盖范围；不一致时说明限制并停止计算增长率。'],
  applicable: ['两个期间的数值比较'],
  excluded: ['无法判断覆盖范围时不推断同比'],
  tags: ['数据比较'],
  basis: 'OBSERVED_EXECUTION',
});
const request = () => ({
  contractVersion: '1.0',
  job: {
    id: id(1),
    lease: id(2),
    tenant: id(3),
    source: id(4),
    original: {
      ...method(),
      title: '合成客户甲的期间核对',
      summary: 'private-original-sentinel: 合成客户甲，2026年5月销售额为1234567。',
    },
    protectedValues: ['合成客户甲', '1234567', 'private-original-sentinel'],
  },
});
const checks = (keys) => Object.fromEntries(keys.map((k) => [k, 'PASS']));
const tool = (name, args = {}) => [
  { type: 'tool_call', id: name + Math.random(), name, arguments: JSON.stringify(args) },
  { type: 'finish', reason: 'tool_calls' },
];
const stop = [
  { type: 'text', text: '我已经处理好了' },
  { type: 'finish', reason: 'stop' },
];
const happy = () => ({
  CLEAN: [tool('original_method'), tool('submit_general_method', { method: method() })],
  PRIVACY: [
    tool('original_method'),
    tool('cleaned_method'),
    tool('check_generalization_privacy', { checks: checks(privacyChecks) }),
  ],
  QUALITY: [tool('cleaned_method'), tool('check_generalization_quality', { checks: checks(qualityChecks) })],
});
function fixture(steps = happy(), usage = true) {
  const sessions = [],
    calls = [];
  const runtime = new ExperienceGeneralization({
    executionClass: 'verification',
    modelName: 'synthetic-generalization',
    createModel() {
      const stage = ['CLEAN', 'PRIVACY', 'QUALITY'][sessions.length];
      sessions.push(stage);
      let n = 0;
      return {
        lastUsage: null,
        async *generate(args) {
          calls.push(stage);
          const names = args.tools.map((t) => t.name).sort();
          assert.deepEqual(
            names,
            (stage === 'CLEAN'
              ? ['original_method', 'submit_general_method', 'skip_generalization']
              : stage === 'PRIVACY'
                ? ['original_method', 'cleaned_method', 'check_generalization_privacy']
                : ['cleaned_method', 'check_generalization_quality']
            ).sort(),
          );
          const messages = JSON.stringify(args.messages);
          if (stage === 'QUALITY')
            for (const secret of ['private-original-sentinel', '合成客户甲', '1234567', id(3), id(4)])
              assert.equal(messages.includes(secret), false, secret + ' leaked to quality');
          // Fresh histories never contain earlier tool decisions.
          if (stage !== 'CLEAN') assert.equal(messages.includes('submit_general_method'), false);
          if (stage === 'QUALITY') assert.equal(messages.includes('check_generalization_privacy'), false);
          const step = steps[stage]?.[n++];
          assert.ok(step, 'unexpected model call ' + stage);
          this.lastUsage = usage ? { inputTokens: 10, outputTokens: 2 } : null;
          yield* typeof step === 'function' ? await step(args) : step;
        },
      };
    },
  });
  return { runtime, sessions, calls };
}
test('three independent Harness sessions return only cleaned method with honest basis, not admission', async () => {
  const f = fixture(),
    input = request();
  assert.ok(validRequest(input));
  assert.ok(validGeneralizationRequest(input));
  const r = await f.runtime.run(input);
  assert.ok(validResult(r), JSON.stringify(validResult.errors));
  assert.equal(r.outcome, 'QUALIFIED');
  assert.deepEqual(r.method, method());
  assert.equal(r.admitted, false);
  assert.equal(r.executionClass, 'verification');
  assert.deepEqual(f.sessions, ['CLEAN', 'PRIVACY', 'QUALITY']);
  assert.deepEqual(
    r.stages.map((s) => [s.stage, s.modelCalls, s.inputTokens, s.outputTokens]),
    [
      ['CLEAN', 2, 20, 4],
      ['PRIVACY', 3, 30, 6],
      ['QUALITY', 2, 20, 4],
    ],
  );
  for (const secret of [
    'private-original-sentinel',
    '合成客户甲',
    '1234567',
    'original',
    'quote',
    'protectedValues',
  ])
    assert.equal(JSON.stringify(r).includes(secret), false);
  assert.deepEqual(await f.runtime.run(input), r);
  assert.equal(f.calls.length, 7);
  r.method.title = 'mutated';
  assert.equal(f.runtime.lookup(id(1), id(2)).method.title, method().title);
  assert.throws(
    () =>
      f.runtime.run({
        ...input,
        job: { ...input.job, original: { ...input.job.original, title: 'different' } },
      }),
    { code: 'GENERALIZATION_ATTEMPT_CONFLICT' },
  );
});
test('requests cannot include raw conversation, unknown authority, unsupported basis or oversized fields', () => {
  for (const mutate of [
    (r) => (r.job.rawConversation = 'private'),
    (r) => (r.job.original.evidence = ['quote']),
    (r) => (r.job.original.basis = 'MANUAL_APPROVAL'),
    (r) => (r.job.original.steps = ['x'.repeat(801)]),
    (r) => (r.job.protectedValues = ['']),
    (r) => (r.job.original.tags = ['same', 'same']),
  ]) {
    const r = request();
    mutate(r);
    assert.equal(validRequest(r), false);
    assert.equal(validGeneralizationRequest(r), false);
    assert.throws(() => fixture().runtime.run(r), { code: 'INVALID_GENERALIZATION_REQUEST' });
  }
});
test('privacy checks gate all later processing; uncertainty never becomes a human review request', async () => {
  for (const key of privacyChecks)
    for (const verdict of ['FAIL', 'UNKNOWN']) {
      const steps = happy();
      steps.PRIVACY[2] = tool('check_generalization_privacy', {
        checks: { ...checks(privacyChecks), [key]: verdict },
      });
      const f = fixture(steps),
        r = await f.runtime.run(request());
      assert.equal(r.outcome, 'REJECTED');
      assert.equal(r.code, 'PRIVACY_NOT_ESTABLISHED');
      assert.equal(r.method, null);
      assert.equal(r.quality, null);
      assert.deepEqual(f.sessions, ['CLEAN', 'PRIVACY']);
      assert.ok(validResult(r));
    }
});
test('every general quality check is mandatory and failure never returns publishable content', async () => {
  for (const key of qualityChecks) {
    const steps = happy();
    steps.QUALITY[1] = tool('check_generalization_quality', {
      checks: { ...checks(qualityChecks), [key]: 'UNKNOWN' },
    });
    const r = await fixture(steps).runtime.run(request());
    assert.equal(r.code, 'QUALITY_NOT_ESTABLISHED');
    assert.equal(r.method, null);
    assert.ok(validResult(r));
  }
});
test('all publishable fields are checked for known and normalized identifiers before another model runs', async () => {
  for (const secret of [
    '合成客户甲',
    '１２３４５６７',
    'synthetic@example.test',
    'https://private.test',
    '13800138000',
    id(99),
  ]) {
    for (const field of ['title', 'summary', 'steps', 'applicable', 'excluded', 'tags']) {
      const steps = happy(),
        m = method();
      m[field] = Array.isArray(m[field]) ? [secret] : secret;
      steps.CLEAN[1] = tool('submit_general_method', { method: m });
      const f = fixture(steps),
        r = await f.runtime.run(request());
      assert.equal(r.code, 'PROTECTED_CONTENT', field + ':' + secret);
      assert.equal(r.method, null);
      assert.deepEqual(f.sessions, ['CLEAN']);
      assert.ok(validResult(r));
    }
  }
});
test('cannot promote correction basis to execution evidence or smuggle original references', async () => {
  for (const extra of [
    { basis: 'FEEDBACK_CORRECTION' },
    { source: id(4) },
    { quotes: ['private-original-sentinel'] },
    { evidence: ['private'] },
    { published: true },
  ]) {
    const steps = happy();
    steps.CLEAN = [
      tool('original_method'),
      tool('submit_general_method', { method: { ...method(), ...extra } }),
      stop,
    ];
    const f = fixture(steps),
      r = await f.runtime.run(request());
    assert.equal(r.outcome, 'FAILED');
    assert.equal(r.method, null);
    assert.deepEqual(f.sessions, ['CLEAN']);
  }
});
test('private-context-dependent methods skip without further models or retained originals', async () => {
  for (const reason of ['REQUIRES_PRIVATE_CONTEXT', 'INSUFFICIENT_EVIDENCE', 'NO_GENERAL_VALUE']) {
    const f = fixture({ CLEAN: [tool('original_method'), tool('skip_generalization', { reason })] }),
      r = await f.runtime.run(request());
    assert.equal(r.outcome, 'SKIPPED');
    assert.equal(r.code, reason);
    assert.equal(r.method, null);
    assert.equal(r.privacy, null);
    assert.ok(validResult(r));
    assert.deepEqual(f.sessions, ['CLEAN']);
  }
});
test('each stage requires its own authorized reads and rejects free-text review fields', async () => {
  const cases = [
    { CLEAN: [tool('submit_general_method', { method: method() }), stop] },
    {
      ...happy(),
      PRIVACY: [
        tool('cleaned_method'),
        tool('check_generalization_privacy', { checks: checks(privacyChecks) }),
        stop,
      ],
    },
    { ...happy(), QUALITY: [tool('check_generalization_quality', { checks: checks(qualityChecks) }), stop] },
    {
      ...happy(),
      PRIVACY: [
        tool('original_method'),
        tool('cleaned_method'),
        tool('check_generalization_privacy', {
          checks: checks(privacyChecks),
          explanation: 'private-original-sentinel',
        }),
        stop,
      ],
    },
    { ...happy(), QUALITY: [tool('original_method'), stop] },
  ];
  for (const steps of cases) {
    const r = await fixture(steps).runtime.run(request());
    assert.equal(r.outcome, 'FAILED');
    assert.equal(r.method, null);
    assert.ok(validResult(r));
    assert.equal(JSON.stringify(r).includes('private-original-sentinel'), false);
  }
});
test('provider errors, missing usage and self-reported success stay truthful', async () => {
  const steps = happy();
  steps.CLEAN = [
    () => {
      throw Error('private-provider-error');
    },
  ];
  const failed = await fixture(steps).runtime.run(request());
  assert.equal(failed.outcome, 'FAILED');
  assert.equal(JSON.stringify(failed).includes('private-provider-error'), false);
  const self = await fixture({ CLEAN: [stop] }).runtime.run(request());
  assert.equal(self.outcome, 'FAILED');
  const noUsage = await fixture(happy(), false).runtime.run(request());
  assert.equal(noUsage.outcome, 'QUALIFIED');
  assert.ok(noUsage.stages.every((s) => s.inputTokens === null && s.outputTokens === null));
});
test('running receipt can be cancelled and unknown receipt is never recreated by lookup', async () => {
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  const steps = happy();
  steps.CLEAN = [
    async () => {
      await wait;
      return tool('original_method');
    },
    stop,
  ];
  const f = fixture(steps),
    pending = f.runtime.run(request());
  assert.equal(f.runtime.known(id(1), id(2)), true);
  assert.equal(f.runtime.lookup(id(1), id(2)), undefined);
  f.runtime.cancel(id(1), id(2));
  release();
  const r = await pending;
  assert.equal(r.outcome, 'CANCELLED');
  assert.equal(r.method, null);
  assert.equal(f.runtime.lookup(id(99), id(2)), undefined);
  assert.equal(f.runtime.known(id(99), id(2)), false);
  assert.ok(validResult(r));
});
test('internal generalization transport authenticates, fences artifact identity and retains one receipt', async () => {
  const f = fixture(),
    token = 'synthetic-generalization-token-'.repeat(3),
    server = createEngineServer({ token, generalization: f.runtime }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const root = `http://127.0.0.1:${server.address().port}/internal/v1/experience-generalization`,
      headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-dreamcore-engine-version': ENGINE_VERSION,
      };
    assert.equal((await fetch(root + '/runtime')).status, 401);
    const info = await fetch(root + '/runtime', { headers });
    assert.equal((await info.json()).configured, true);
    assert.equal(
      (
        await fetch(root + '/results', {
          method: 'POST',
          headers: { ...headers, 'x-dreamcore-engine-version': 'old' },
          body: JSON.stringify(request()),
        })
      ).status,
      409,
    );
    assert.equal(f.calls.length, 0);
    const response = await fetch(root + '/results', {
      method: 'POST',
      headers,
      body: JSON.stringify(request()),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const r = await response.json();
    assert.equal(r.outcome, 'QUALIFIED');
    assert.deepEqual(await (await fetch(root + `/results/${id(1)}/${id(2)}`, { headers })).json(), r);
    assert.equal((await fetch(root + `/results/${id(99)}/${id(2)}`, { headers })).status, 404);
    assert.equal(
      (
        await fetch(root + '/results', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...request(), job: { ...request().job, protectedValues: [] } }),
        })
      ).status,
      409,
    );
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  }
});

test('bounded concurrent jobs share identical attempts and stop aborts all active work', async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const runtime = new ExperienceGeneralization({
    executionClass: 'verification',
    modelName: 'synthetic',
    createModel() {
      return {
        lastUsage: null,
        async *generate() {
          calls++;
          await waiting;
          yield* stop;
        },
      };
    },
  });
  const first = request(),
    second = request();
  second.job.id = id(8);
  const a = runtime.run(first),
    replay = runtime.run(first),
    b = runtime.run(second);
  const third = request();
  third.job.id = id(9);
  assert.throws(() => runtime.run(third), { code: 'ENGINE_BUSY' });
  runtime.stop();
  release();
  const results = await Promise.all([a, replay, b]);
  assert.ok(results.every((r) => r.outcome === 'CANCELLED' && r.method === null));
  assert.deepEqual(results[0], results[1]);
  assert.ok(calls <= 2);
});

const platformRequest = () => {
  const input = request();
  input.job.tenant = null;
  input.job.scope = 'PLATFORM';
  input.job.original = { ...method(), basis: 'FEEDBACK_CORRECTION' };
  return input;
};
test('platform cleaned correction keeps feedback evidence strength across three isolated stages', async () => {
  const input = platformRequest(),
    steps = happy();
  steps.CLEAN = [tool('original_method'), tool('submit_general_method', { method: input.job.original })];
  const f = fixture(steps);
  assert.ok(validGeneralizationRequest(input));
  assert.ok(validRequest(input));
  const result = await f.runtime.run(input);
  assert.equal(result.outcome, 'QUALIFIED');
  assert.equal(result.method.basis, 'FEEDBACK_CORRECTION');
  assert.equal(result.admitted, false);
  assert.deepEqual(f.sessions, ['CLEAN', 'PRIVACY', 'QUALITY']);
  assert.equal(result.scope, 'PLATFORM');
  assert.ok(validResult(result));
  const replay = structuredClone(input);
  delete replay.job.scope;
  replay.job.tenant = id(3);
  assert.throws(() => f.runtime.run(replay), /GENERALIZATION_ATTEMPT_CONFLICT/);
});
test('platform generalization rejects borrowed tenant identity, missing scope and invented execution basis', () => {
  const bad = (change) => {
    const input = platformRequest();
    change(input.job);
    return input;
  };
  for (const input of [
    bad((j) => {
      j.tenant = id(3);
    }),
    bad((j) => {
      delete j.scope;
    }),
    bad((j) => {
      delete j.tenant;
    }),
    bad((j) => {
      j.scope = 'TENANT';
    }),
    bad((j) => {
      j.original.basis = 'OBSERVED_EXECUTION';
    }),
    bad((j) => {
      j.original.evidence = [{ quote: 'private' }];
    }),
  ]) {
    assert.equal(validGeneralizationRequest(input), false, JSON.stringify(input));
    assert.equal(validRequest(input), false, JSON.stringify(input));
  }
});
