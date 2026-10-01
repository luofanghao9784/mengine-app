// Actual Harness -> local HTTP -> PostgreSQL, with a deterministic synthetic model. No model API.
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
  modelName: 'synthetic-task-work',
  createModel() {
    return {
      usage: null,
      async *generate(request) {
        try {
          const plan = request.tools.some((t) => t.name === 'task_plan');
          assert.ok(request.tools.some((t) => t.name === 'task_preference'));
          const results = request.messages
            .flatMap((m) => m.content)
            .filter((c) => c.type === 'tool_result')
            .map((c) => JSON.parse(JSON.parse(c.content)[0].text).result);
          let args;
          if (results.length === 0) args = { action: 'read' };
          else if (results.length === 1 && plan) {
            const p = results[0].plan;
            args = {
              action: 'schedule',
              requestId: randomUUID(),
              expectedRevision: p.revision,
              checkAt: new Date(Date.parse(p.lastDispatchedAt) + 65000).toISOString(),
              reason: '合成后续检查，沿用原委托边界',
            };
          } else if (results.length === 1) {
            assert.equal(results[0].scope, 'CURRENT_USER_PERSONAL');
            args = {
              action: 'save',
              requestId: randomUUID(),
              expectedRevision: 0,
              category: 'RESPONSE_LENGTH',
              choice: 'CONCISE',
              evidenceSource: 'PROMPT',
              evidenceOffset: 0,
              evidence: '请记住，以后回答简洁一些',
            };
          } else {
            if (plan) {
              assert.equal(results[1].currentlyEffective, true);
              assert.equal(results[1].state, 'PENDING');
            } else {
              assert.equal(results[1].saved, true);
              assert.equal(results[1].receipt.acceptedRevision, 1);
              assert.equal(results[1].receipt.canUndo, true);
            }
            yield {
              type: 'text',
              text: plan
                ? '已按原计划保存一次后续检查；这只证明安排被接受。'
                : '已保存个人表达偏好，可查看真实版本并撤销。',
            };
            yield { type: 'finish', reason: 'stop' };
            return;
          }
          yield {
            type: 'tool_call',
            id: 'work-' + results.length,
            name: plan ? 'task_plan' : 'task_preference',
            arguments: JSON.stringify(args),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } catch (error) {
          console.error(error);
          throw error;
        }
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
