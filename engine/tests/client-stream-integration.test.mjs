import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';

test('combined answer and realtime capabilities use one authoritative output sequence', async (t) => {
  const outputs = [];
  let answerWrites = 0;
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, {
      allowed: true, executionClass: 'verification', realtimeVersion: '1.0', answerStreamVersion: '1.0',
    });
    if (req.url.endsWith('/execution/open')) return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/live/control')) return json(res, { stop: false, inputs: [] });
    if (req.url.endsWith('/live/output')) outputs.push(input);
    if (req.url.endsWith('/answer')) answerWrites++;
    return json(res, { accepted: true });
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({ platformBaseUrl: url, executionClass: 'verification',
    modelName: 'synthetic', createModel: () => ({ usage: null, async *generate() {
      yield { type: 'text', text: '第一段' };
      await delay(300);
      yield { type: 'text', text: '，完整合成回复' };
      yield { type: 'finish', reason: 'stop' };
    } }),
  });
  const result = await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成输出序列检查'},new AbortController().signal);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(answerWrites, 0);
  assert.ok(outputs.length >= 2);
  assert.deepEqual(outputs.map(o => o.version), outputs.map((_, i) => i + 1));
  assert.equal(outputs.at(-1).state, 'COMPLETE');
  assert.equal(outputs.at(-1).text, '第一段，完整合成回复');
});
