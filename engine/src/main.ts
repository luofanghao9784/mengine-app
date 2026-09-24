import { createEngineServer } from './server.js';
import { AgentTasks } from './runtime/agent-task.js';
import { PublicReader, SearxSearch } from './runtime/public-web.js';
import { configuredModel } from './runtime/model-config.js';

if (process.env.AGENT_CANDIDATE_TRIALS_ENABLED === 'true')
  throw new Error('Candidate trials are available only through the local verification fixture');

const port = Number(process.env.ENGINE_PORT ?? 18182);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('ENGINE_PORT must be an integer between 1 and 65535');
}
const host = process.env.ENGINE_HOST ?? '127.0.0.1';
const model = configuredModel(process.env);
const webEnabled = process.env.AGENT_PUBLIC_WEB_ENABLED === 'true';
const searchEndpoint = process.env.AGENT_SEARCH_ENDPOINT;
const reader = new PublicReader();
const publicWeb = webEnabled
  ? { reader, ...(searchEndpoint ? { search: new SearxSearch(searchEndpoint, reader) } : {}) }
  : undefined;
const agent = model
  ? new AgentTasks({
      platformBaseUrl: process.env.AGENT_PLATFORM_URL ?? '',
      executionClass: 'live',
      modelName: model.modelName,
      publicWeb,
      createModel: model.createModel,
    })
  : undefined;
const server = createEngineServer({ token: process.env.TASK_ENGINE_TOKEN, agent });
server.listen(port, host, () => {
  console.log(`Dreamcore engine listening on ${host}:${port}; model gateway ${agent ? 'configured' : 'off'}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    agent?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
