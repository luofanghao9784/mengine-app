// Explicit local HTTP/DB + actual Harness fixture. No model API, credentials or external network.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { createEngineServer } from '../../dist/server.js';
const platformBaseUrl = process.argv[2],
  token = process.argv[3];
if (new URL(platformBaseUrl).hostname !== '127.0.0.1' || !token?.startsWith('synthetic-'))
  throw Error('Local fixture only');
const agent = new AgentTasks({
  platformBaseUrl,
  executionClass: 'verification',
  modelName: 'synthetic-context-bridge',
  createModel() {
    return {
      usage: null,
      async *generate(request) {
        const current = request.messages.find((m) => m.role === 'user');
        assert.ok(current.content.at(-1).text.includes('只写当前草稿，不发送'));
        assert.ok(current.content[0].text.includes('continuity reference'));
        assert.ok(request.tools.some((t) => t.name === 'task_context'));
        assert.ok(!request.tools.some((t) => t.name === 'run_javascript'));
        const results = request.messages
          .flatMap((m) => m.content)
          .filter((c) => c.type === 'tool_result')
          .map((c) => JSON.parse(JSON.parse(c.content)[0].text).result);
        let args;
        if (results.length === 0) args = { action: 'profiles', scope: 'PERSONAL' };
        else if (results.length === 1) {
          assert.equal(results[0].items[0].authority, false);
          args = { action: 'experience_search', query: '预算' };
        } else if (results.length === 2) {
          assert.equal(results[1].items.length, 1);
          const e = results[1].items[0];
          args = { action: 'experience_read', referenceId: e.id, versionId: e.versionId };
        } else if (results.length === 3) {
          const e = results[2];
          assert.equal(e.requiresApplicabilityCheck, true);
          args = {
            action: 'experience_use',
            referenceId: e.entryId,
            versionId: e.versionId,
            requestId: randomUUID(),
            decision: 'ADAPTED',
            conditions: '合成任务具备预算口径与输入，仅用当前只读工具；排除条件不适用',
            adjustments: '采用私人草稿格式，不发布、不发送',
          };
        } else {
          assert.equal(results[3].applicationOutcome, 'UNKNOWN');
          assert.equal(results[3].businessActionPerformed, false);
          yield {
            type: 'text',
            text: '已按本次问题整理私人草稿，引用精确方法版本；未发送、未发布，业务效果尚未验证。',
          };
          yield { type: 'finish', reason: 'stop' };
          return;
        }
        yield {
          type: 'tool_call',
          id: 'context-' + results.length,
          name: 'task_context',
          arguments: JSON.stringify(args),
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
  },
});
const server = createEngineServer({ token, agent });
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
process.on('SIGTERM', () => {
  agent.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
