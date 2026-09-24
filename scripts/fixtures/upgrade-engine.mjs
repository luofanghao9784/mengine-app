// Synthetic model transport around the selected REAL engine artifact. Never a production entrypoint.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.env.UPGRADE_ENGINE_ROOT;
const { AgentTasks } = await import(pathToFileURL(join(root, 'dist/runtime/agent-task.js')));
const { DeepSeekModel } = await import(pathToFileURL(join(root, 'dist/runtime/deepseek-model.js')));
const { LocalNodeSandbox } = await import(pathToFileURL(join(root, 'dist/runtime/sandbox.js')));
const { createEngineServer } = await import(pathToFileURL(join(root, 'dist/server.js')));
let calls = 0;
const mock = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw);
  calls++;
  process.send?.({ type: 'calls', count: calls });
  if (process.env.UPGRADE_HOLD_MODEL === 'true') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    return;
  }
  const results = input.messages.filter((m) => m.role === 'tool');
  const call = (name, args) => ({
    id: `step-${results.length}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  let toolCalls;
  if (!results.length) toolCalls = [call('search_sources', { query: 'amount' })];
  else if (results.length === 1)
    toolCalls = [
      call('run_javascript', {
        script:
          'import fs from "node:fs";const total=[1001,999].reduce((a,b)=>a+b,0);fs.writeFileSync("summary.json",JSON.stringify({totalCents:String(total)}));',
      }),
    ];
  const body = {
    choices: [
      {
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: toolCalls ? null : '合成升级演练：工具合计 2000 分；没有云模型调用。',
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
mock.listen(0, '127.0.0.1');
await once(mock, 'listening');
const agent = new AgentTasks({
  platformBaseUrl: process.env.UPGRADE_PLATFORM_URL,
  executionClass: 'verification',
  modelName: 'upgrade-fixture',
  createModel: () =>
    new DeepSeekModel({
      model: 'upgrade-fixture',
      apiKey: 'synthetic-upgrade-key',
      endpoint: `http://127.0.0.1:${mock.address().port}/chat/completions`,
      localVerification: true,
    }),
  sandbox: new LocalNodeSandbox({ python: process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3' }),
});
const server = createEngineServer({ token: process.env.TASK_ENGINE_TOKEN, agent });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
process.send?.({ type: 'ready', url: `http://127.0.0.1:${server.address().port}` });
const close = (s) =>
  new Promise((resolve) => {
    s.close(resolve);
    s.closeAllConnections();
  });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    agent.stop();
    await close(server);
    await close(mock);
    process.exit(0);
  });
