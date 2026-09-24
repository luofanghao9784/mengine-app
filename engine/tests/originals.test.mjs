import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { OriginalInputs } from '../dist/runtime/original-inputs.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { LocalNodeSandbox } from '../dist/runtime/sandbox.js';
import { createServer } from 'node:http';
import { body, json, listen, close, fixtureEngine } from './fixtures/agent.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(bytes = Buffer.from([0, 255, 1])) {
  const selected = {
    materialId: randomUUID(),
    versionId: randomUUID(),
    filename: 'input.bin',
    version: 1,
    bytes: bytes.length,
    sha256: hash(bytes),
    read: false,
  };
  const calls = [];
  let content = {
    versionId: selected.versionId,
    sha256: selected.sha256,
    contentBase64: bytes.toString('base64'),
  };
  let items = [selected],
    denied = false;
  const grant = new OriginalInputs(
    async (action, args) => {
      calls.push({ action, args });
      return action === 'originals' ? { items } : content;
    },
    async () => {
      if (denied) throw Error('revoked');
    },
  );
  const tool = (name, args = {}) =>
    grant
      .tools()
      .find((t) => t.name === name)
      .execute(args, new AbortController().signal);
  return {
    grant,
    selected,
    calls,
    tool,
    content: (v) => (content = v),
    items: (v) => (items = v),
    deny: () => (denied = true),
  };
}
test('complete binary originals are hash verified but model output contains metadata only; close clears bytes', async () => {
  const f = fixture(Buffer.from('RAW_PRIVATE_BYTES\0\xff'));
  const response = await f.tool('read_original', { versionId: f.selected.versionId });
  assert.equal(response.scope, 'complete-original');
  assert.equal(response.contentsSentToModel, false);
  assert.ok(!JSON.stringify(response).includes('RAW_PRIVATE_BYTES'));
  assert.ok(!('contentBase64' in response));
  assert.deepEqual(f.grant.ids(), [f.selected.versionId]);
  assert.equal(f.grant.files()[0].bytes.length, f.selected.bytes);
  const bytes = f.grant.files()[0].bytes;
  f.grant.close();
  assert.ok(bytes.every((v) => v === 0));
  assert.deepEqual(f.grant.ids(), []);
});
test('unselected originals, forged bytes and changing version manifests fail without a usable grant', async () => {
  let f = fixture();
  await assert.rejects(f.tool('read_original', { versionId: randomUUID() }), {
    code: 'ORIGINAL_NOT_SELECTED',
  });
  assert.ok(!f.calls.some((c) => c.action === 'read-original'));
  for (const changed of [
    { sha256: '0'.repeat(64) },
    { contentBase64: 'AAAA' },
    { contentBase64: '@@@@' },
    { versionId: randomUUID() },
  ]) {
    f = fixture();
    f.content({
      versionId: f.selected.versionId,
      sha256: f.selected.sha256,
      contentBase64: Buffer.from([0, 255, 1]).toString('base64'),
      ...changed,
    });
    await assert.rejects(f.tool('read_original', { versionId: f.selected.versionId }), {
      code: 'INVALID_ORIGINAL_RESPONSE',
    });
    assert.deepEqual(f.grant.ids(), []);
  }
  f = fixture();
  await f.tool('list_originals');
  f.items([{ ...f.selected, filename: 'changed.bin' }]);
  await assert.rejects(f.tool('list_originals'), { code: 'ORIGINAL_SELECTION_CHANGED' });
});
test('limits and revocation prevent staging unauthorized originals', async () => {
  for (const kind of ['large', 'duplicate', 'total']) {
    const f = fixture();
    f.items(
      kind === 'large'
        ? [{ ...f.selected, bytes: 262145 }]
        : kind === 'duplicate'
          ? [f.selected, f.selected]
          : Array.from({ length: 3 }, () => ({
              ...f.selected,
              materialId: randomUUID(),
              versionId: randomUUID(),
              bytes: 262144,
            })),
    );
    await assert.rejects(f.tool('list_originals'), { code: 'INVALID_ORIGINAL_RESPONSE' });
  }
  const f = fixture();
  await f.tool('list_originals');
  f.deny();
  await assert.rejects(f.tool('read_original', { versionId: f.selected.versionId }));
  assert.deepEqual(f.grant.ids(), []);
});
test('actual Harness and sandbox process a whole selected original without sending its bytes to model HTTP', async (t) => {
  const bytes = Buffer.from('RAW_ONLY_MARKER,value\n0,1001\n1,999'),
    versionId = randomUUID();
  const selected = {
    materialId: randomUUID(),
    versionId,
    filename: 'full.csv',
    version: 1,
    bytes: bytes.length,
    sha256: hash(bytes),
    read: false,
  };
  const platform = createServer(async (req, res) => {
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'verification' });
    if (req.url.endsWith('/originals')) return json(res, { items: [selected] });
    assert.equal(input.versionId, versionId);
    json(res, { versionId, sha256: selected.sha256, contentBase64: bytes.toString('base64') });
  });
  const endpoint = await listen(platform);
  t.after(() => close(platform));
  const engine = await fixtureEngine(endpoint, 'synthetic-task-service-token-123456789');
  t.after(() => engine.stop());
  const response = await fetch(engine.url + '/internal/v1/agent-results', {
    method: 'POST',
    headers: {
      authorization: 'Bearer synthetic-task-service-token-123456789',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contractVersion: '1.4',
      taskId: randomUUID(),
      attemptId: randomUUID(),
      prompt: 'ORIGINAL_FILE',
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.originalIds, [versionId]);
  assert.deepEqual(JSON.parse(Buffer.from(result.artifacts[0].contentBase64, 'base64')), {
    rows: 2,
    total: '2000',
  });
  assert.ok(!JSON.stringify(engine.stats.requests).includes('RAW_ONLY_MARKER'));
});
test('loaded originals require explicit handles; unselected, unread and duplicate handles cannot reach execution', async (t) => {
  const bytes = Buffer.from('selected original');
  const selected = [0, 1].map(() => ({
    materialId: randomUUID(),
    versionId: randomUUID(),
    filename: 'input.txt',
    version: 1,
    bytes: bytes.length,
    sha256: hash(bytes),
    read: false,
  }));
  const platform = createServer(async (req, res) => {
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'verification' });
    if (req.url.endsWith('/originals')) return json(res, { items: selected });
    assert.equal(input.versionId, selected[0].versionId);
    json(res, { versionId: input.versionId, sha256: hash(bytes), contentBase64: bytes.toString('base64') });
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const handle = (id) => 'original-' + id + '.bin';
  const loaded = handle(selected[0].versionId);
  for (const [inputHandles, expected] of [
    [undefined, []],
    [[loaded], [loaded]],
    [[handle(selected[1].versionId)], null],
    [[handle(randomUUID())], null],
    [[loaded, loaded], null],
    [[], null],
  ]) {
    let step = 0,
      runs = 0;
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'fixture',
      createModel: () => ({
        async *generate() {
          step++;
          if (step <= 2)
            yield {
              type: 'tool_call',
              id: 'handle-' + step,
              name: step === 1 ? 'read_original' : 'run_javascript',
              arguments: JSON.stringify(
                step === 1 ? { versionId: selected[0].versionId } : { script: 'test', inputHandles },
              ),
            };
          else yield { type: 'text', text: 'fixture result' };
          yield { type: 'finish', reason: step <= 2 ? 'tool_calls' : 'stop' };
        },
      }),
      sandbox: {
        async run(_script, files) {
          runs++;
          assert.deepEqual(
            files.map((f) => f.handle),
            expected,
          );
          if (files.length) assert.deepEqual(Buffer.from(files[0].bytes), bytes);
          return { stdout: '', artifacts: [] };
        },
      },
    });
    try {
      const result = agent.run(
        { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
        new AbortController().signal,
      );
      if (expected) await result;
      else await assert.rejects(result, { code: 'TASK_TOOL_FAILED' });
      assert.equal(runs, expected ? 1 : 0);
    } finally {
      agent.stop();
    }
  }
});
test(
  'original grant revocation while actual code runs aborts execution and returns no result',
  { timeout: 10000 },
  async (t) => {
    let allowed = true,
      started;
    const running = new Promise((r) => (started = r)),
      id = randomUUID(),
      bytes = Buffer.from('private');
    const selected = {
      materialId: randomUUID(),
      versionId: id,
      filename: 'private.txt',
      version: 1,
      bytes: bytes.length,
      sha256: hash(bytes),
    };
    const platform = createServer(async (req, res) => {
      await body(req);
      if (!allowed) return json(res, { code: 'TASK_ACCESS_DENIED' }, 403);
      if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'verification' });
      if (req.url.endsWith('/originals')) return json(res, { items: [selected] });
      json(res, { versionId: id, sha256: selected.sha256, contentBase64: bytes.toString('base64') });
    });
    const url = await listen(platform);
    t.after(() => close(platform));
    let step = 0;
    const local = new LocalNodeSandbox({
      python: process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3',
    });
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'fixture',
      createModel: () => ({
        async *generate() {
          step++;
          yield {
            type: 'tool_call',
            id: 'call-' + step,
            name: step === 1 ? 'read_original' : 'run_javascript',
            arguments: JSON.stringify(
              step === 1
                ? { versionId: id }
                : { script: 'while(true){}', inputHandles: ['original-' + id + '.bin'] },
            ),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        },
      }),
      sandbox: {
        run(script, files, signal) {
          started();
          return local.run(script, files, signal);
        },
      },
    });
    t.after(() => agent.stop());
    const result = agent.run(
      { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
      new AbortController().signal,
    );
    const rejection = assert.rejects(result, { code: 'TASK_ACCESS_DENIED' });
    await running;
    allowed = false;
    await rejection;
  },
);
