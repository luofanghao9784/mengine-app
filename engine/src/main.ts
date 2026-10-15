import { ExecutionReceipts } from './runtime/execution-receipts.js';
import { PresentationRenderer } from './runtime/presentation-renderer.js';
import { createEngineServer } from './server.js';
import { AgentTasks } from './runtime/agent-task.js';
import { BingNewsSearch } from './runtime/news-search.js';
import { configuredPublicReader } from './runtime/public-routing.js';
import { SearxSearch } from './runtime/public-web.js';
import { configuredModel } from './runtime/model-config.js';
import { CompanyAnalysis } from './runtime/company-analysis.js';
import { ExperienceGeneralization } from './runtime/experience-generalization.js';
import { ExperienceAnalysis } from './runtime/experience-analysis.js';

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
const proxyEndpoint = process.env.AGENT_PUBLIC_WEB_PROXY;
const reader = configuredPublicReader(proxyEndpoint, process.env.AGENT_PUBLIC_WEB_DNS ?? 'system');
const newsProvider = process.env.AGENT_NEWS_SEARCH_PROVIDER ?? 'off';
if (!['off', 'bing-rss', 'searx'].includes(newsProvider)) throw new Error('INVALID_NEWS_SEARCH_PROVIDER');
if (newsProvider === 'searx' && !searchEndpoint) throw new Error('PUBLIC_SEARCH_NOT_CONFIGURED');
const publicWeb = webEnabled
  ? {
      reader,
      ...(searchEndpoint
        ? { search: new SearxSearch(searchEndpoint, reader) }
        : newsProvider === 'bing-rss'
          ? { search: new BingNewsSearch(reader) }
          : {}),
    }
  : undefined;
const presentationRenderer =
  process.env.AGENT_PPT_RENDERER_ENABLED === 'true' ? new PresentationRenderer() : undefined;
if (presentationRenderer) await presentationRenderer.check();
const agent = model
  ? new AgentTasks({
      platformBaseUrl: process.env.AGENT_PLATFORM_URL ?? '',
      executionClass: 'live',
      modelName: model.modelName,
      routineModel: model.routineModel,
      briefingUsePrimary: process.env.AGENT_BRIEFING_USE_PRIMARY_MODEL === 'true',
      publicWeb,
      presentationRenderer,
      createModel: model.createModel,
    })
  : undefined;
const company = model
  ? new CompanyAnalysis({
      executionClass: 'live',
      modelName: (model.routineModel ?? model).modelName,
      createModel: (model.routineModel ?? model).createModel,
    })
  : undefined;
const experience = model
  ? new ExperienceAnalysis({
      executionClass: 'live',
      modelName: model.modelName,
      createModel: model.createModel,
    })
  : undefined;
const generalization = model
  ? new ExperienceGeneralization({
      executionClass: 'live',
      modelName: model.modelName,
      createModel: model.createModel,
    })
  : undefined;
const server = createEngineServer({
  token: process.env.TASK_ENGINE_TOKEN,
  receipts: model ? new ExecutionReceipts(process.env.AGENT_PLATFORM_URL ?? '', process.env.TASK_ENGINE_TOKEN ?? '') : undefined,
  agent,
  company,
  experience,
  generalization,
});
server.listen(port, host, () => {
  console.log(`Dreamcore engine listening on ${host}:${port}; model gateway ${agent ? 'configured' : 'off'}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    agent?.stop();
    company?.stop();
    experience?.stop();
    generalization?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
