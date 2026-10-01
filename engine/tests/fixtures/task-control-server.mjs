// Explicit local HTTP/DB + real Harness integration fixture. No production import or model provider.
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { createEngineServer } from '../../dist/server.js';
const platformBaseUrl = process.argv[2],
  token = process.argv[3];
if (new URL(platformBaseUrl).hostname !== '127.0.0.1' || !token?.startsWith('synthetic-'))
  throw new Error('Local synthetic fixture only');
const agent = new AgentTasks({
  platformBaseUrl,
  executionClass: 'verification',
  modelName: 'synthetic-task-control',
  createModel() {
    let calls = 0;
    return {
      usage: null,
      async *generate(request) {
        calls++;
        const supplemented = request.messages.some((m) =>
          m.content.some((c) => c.type === 'text' && c.text.includes('补充到周五')),
        );
        if (calls === 1 && !supplemented) {
          yield {
            type: 'tool_call',
            id: 'input-1',
            name: 'task_control',
            arguments: JSON.stringify({ outcome: 'WAITING_INPUT', message: '请补充截止日期' }),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          yield {
            type: 'text',
            text: supplemented
              ? '依据补充完成合成任务；未执行外部业务写入。'
              : '已取得合成信息，等待截止日期。',
          };
          yield { type: 'finish', reason: 'stop' };
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
