import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { uploadArtifact, ARTIFACT_CHUNK_BYTES } from '../dist/runtime/artifact-transfer.js';
import { RuntimeError } from '../dist/runtime/ports.js';
const file = () => {
  const bytes = Buffer.alloc(600000, 42);
  return { name: 'report.html', bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
};
test('large artifact survives lost prepare and chunk responses with identical retries', async () => {
  const f = file(),
    id = randomUUID(),
    seen = new Map();
  let stored = Buffer.alloc(0),
    key;
  const invoke = async (action, body) => {
    const previous = seen.get(action);
    seen.set(action, body);
    if (action === 'artifacts/prepare') {
      if (key) assert.equal(body.clientKey, key);
      key = body.clientKey;
    }
    if (action.endsWith('/chunk')) {
      const part = Buffer.from(body.contentBase64, 'base64');
      assert.ok(part.length <= ARTIFACT_CHUNK_BYTES);
      if (body.offset === stored.length) stored = Buffer.concat([stored, part]);
      else assert.deepEqual(stored.subarray(body.offset, body.offset + part.length), part);
    }
    if (!previous && !action.endsWith('/complete')) throw new RuntimeError('REMOTE_UNAVAILABLE');
    return {
      contractVersion: '1.0',
      uploadId: id,
      state: action.endsWith('/complete') ? 'READY' : 'UPLOADING',
      receivedBytes: stored.length,
      bytes: f.bytes.length,
      sha256: f.sha256,
      chunkBytes: ARTIFACT_CHUNK_BYTES,
    };
  };
  assert.deepEqual(await uploadArtifact(invoke, f, new AbortController().signal), {
    name: f.name,
    sha256: f.sha256,
    uploadId: id,
  });
  assert.deepEqual(stored, f.bytes);
});
test('invalid digest, cancelled work and inconsistent receipts fail closed', async () => {
  const f = file();
  let calls = 0;
  const invoke = async () => {
    calls++;
    return {};
  };
  await assert.rejects(
    uploadArtifact(invoke, { ...f, sha256: '0'.repeat(64) }, new AbortController().signal),
    { code: 'INVALID_ARTIFACT' },
  );
  assert.equal(calls, 0);
  const control = new AbortController();
  control.abort();
  await assert.rejects(uploadArtifact(invoke, f, control.signal), { code: 'CANCELLED' });
  assert.equal(calls, 0);
  await assert.rejects(uploadArtifact(invoke, f, new AbortController().signal), {
    code: 'INVALID_ARTIFACT_RECEIPT',
  });
});

import { createServer } from 'node:http';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, json, body } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
test('runner negotiates references only for v1.5 and preserves legacy size limit', async (t) => {
  const f = file(),
    uploadId = randomUUID();
  let stored = Buffer.alloc(0),
    uploads = 0;
  const platform = createServer(async (req, res) => {
    const input = await body(req);
    if (usageFixture(req, res)) return;
    if (req.url.endsWith('/check'))
      return json(res, { allowed: true, executionClass: 'verification', artifactTransferVersion: '1.0' });
    if (req.url.endsWith('/execution/open'))
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/execution/control')) return json(res, { stopRequested: false });
    if (req.url.includes('/artifacts/')) {
      uploads++;
      if (req.url.endsWith('/chunk')) {
        assert.equal(input.offset, stored.length);
        stored = Buffer.concat([stored, Buffer.from(input.contentBase64, 'base64')]);
      }
      return json(res, {
        contractVersion: '1.0',
        uploadId,
        state: req.url.endsWith('/complete') ? 'READY' : 'UPLOADING',
        receivedBytes: stored.length,
        bytes: f.bytes.length,
        sha256: f.sha256,
        chunkBytes: ARTIFACT_CHUNK_BYTES,
      });
    }
    json(res, { accepted: true });
  });
  const platformBaseUrl = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl,
    executionClass: 'verification',
    modelName: 'synthetic',
    sandbox: {
      async run() {
        return { stdout: '', artifacts: [{ ...f }] };
      },
    },
    createModel: () => {
      let n = 0;
      return {
        async *generate(request) {
          assert.ok(!JSON.stringify(request.messages).includes(uploadId));
          assert.ok(!JSON.stringify(request.messages).includes(f.bytes.toString("base64")));
          if (n++ === 0) {
            yield {
              type: 'tool_call',
              id: 'render',
              name: 'run_javascript',
              arguments: JSON.stringify({ script: '/* synthetic renderer */' }),
            };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            yield { type: 'text', text: 'Synthetic artifact ready.' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      };
    },
  });
  t.after(() => agent.stop());
  const run = (contractVersion) =>
    agent.run(
      { contractVersion, taskId: randomUUID(), attemptId: randomUUID(), prompt: 'Generate fixture' },
      new AbortController().signal,
    );
  const result = await run('1.5');
  assert.deepEqual(result.artifacts, [{ name: f.name, sha256: f.sha256, uploadId }]);
  assert.deepEqual(stored, f.bytes);
  const count = uploads;
  await assert.rejects(run('1.4'), { code: 'TASK_TOOL_FAILED' });
  assert.equal(uploads, count);
});
