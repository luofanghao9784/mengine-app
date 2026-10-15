import type { ExecutionReceipts } from './runtime/execution-receipts.js';
import { ENGINE_VERSION, TASK_PROTOCOLS } from './release.js';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AgentTasks } from './runtime/agent-task.js';
import { ConversationTitleTasks } from './runtime/conversation-title.js';
import { RuntimeError } from './runtime/ports.js';
import type { CompanyAnalysis } from './runtime/company-analysis.js';
import type { ExperienceGeneralization } from './runtime/experience-generalization.js';
import type { ExperienceAnalysis } from './runtime/experience-analysis.js';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Authenticated internal task transport. Agent execution requires an explicitly supplied runtime. */
export function createEngineServer(
  options: {
    token?: string;
    receipts?: ExecutionReceipts;
    agent?: AgentTasks;
    company?: CompanyAnalysis;
    experience?: ExperienceAnalysis;
    generalization?: ExperienceGeneralization;
  } = {},
) {
  const titles = options.agent ? new ConversationTitleTasks(options.agent.config.routineModel ?? options.agent.config) : undefined;
  const enabled = !!options.token && options.token.length >= 32;
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/healthz') return send(200, { status: 'UP' });
    const expected = Buffer.from(`Bearer ${options.token}`);
    const provided = Buffer.from(request.headers.authorization || '');
    const authorized = enabled && provided.length === expected.length && timingSafeEqual(provided, expected);
    const feature = request.url?.startsWith('/internal/v1/experience-generalization')
      ? {
          path: '/internal/v1/experience-generalization',
          runtime: options.generalization,
          prefix: 'GENERALIZATION',
        }
      : request.url?.startsWith('/internal/v1/experience')
        ? { path: '/internal/v1/experience', runtime: options.experience, prefix: 'EXPERIENCE' }
        : request.url?.startsWith('/internal/v1/company-information')
          ? { path: '/internal/v1/company-information', runtime: options.company, prefix: 'COMPANY' }
          : undefined;
    if (feature) {
      if (!authorized) return send(401, { code: 'UNAUTHORIZED' });
      if (request.method === 'GET' && request.url === feature.path + '/runtime')
        return send(200, {
          contractVersion: '1.0',
          engineVersion: ENGINE_VERSION,
          configured: !!feature.runtime,
          executionClass: feature.runtime?.config.executionClass ?? null,
        });
      if (!feature.runtime) return send(503, { code: 'MODEL_NOT_CONFIGURED' });
      const match = new RegExp('^' + feature.path + '/results/([0-9a-f-]+)/([0-9a-f-]+)$').exec(
        request.url ?? '',
      );
      if (match && uuid(match[1]) && uuid(match[2])) {
        if (request.method === 'DELETE') {
          feature.runtime.cancel(match[1], match[2]);
          return send(200, { accepted: true });
        }
        if (request.method === 'GET') {
          const result = feature.runtime.lookup(match[1], match[2]);
          return result
            ? send(200, result)
            : send(feature.runtime.known(match[1], match[2]) ? 202 : 404, {
                code: feature.prefix + '_RESULT_PENDING',
              });
        }
      }
      if (request.method !== 'POST' || request.url !== feature.path + '/results')
        return send(404, { code: 'NOT_FOUND' });
      if (request.headers['x-dreamcore-engine-version'] !== ENGINE_VERSION)
        return send(409, { code: 'TASK_RUNTIME_INCOMPATIBLE' });
      try {
        const parts: Buffer[] = [];
        let bytes = 0;
        for await (const part of request) {
          bytes += part.length;
          if (bytes > 524288) {
            request.resume();
            return send(413, { code: 'TOO_LARGE' });
          }
          parts.push(part);
        }
        const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
        const result = await (options.receipts && feature.prefix==='COMPANY'
          ? options.receipts.run<unknown>('COMPANY',input?.job?.id,input?.job?.lease,input,()=>feature.runtime!.run(input))
          : feature.runtime.run(input));
        if (!response.destroyed) return send(200, result);
      } catch (error) {
        const code = error instanceof RuntimeError ? error.code : 'INVALID_' + feature.prefix + '_REQUEST';
        return send(
          code === 'EXECUTION_RECEIPT_UNAVAILABLE' ? 500 : code === 'ENGINE_BUSY' ? 429 : code === feature.prefix + '_ATTEMPT_CONFLICT' ? 409 : 400,
          { code },
        );
      }
      return;
    }
    const runtimeMode = enabled
      ? options.agent
        ? `agent-${options.agent.config.executionClass}`
        : 'local-retrieval'
      : 'contract-only';
    if (request.method === 'GET' && request.url === '/internal/v1/runtime') {
      if (!authorized) return send(401, { code: 'UNAUTHORIZED' });
      return send(200, {
        contractVersion: '1.0',
        engineVersion: ENGINE_VERSION,
        runtimeMode,
        protocols: TASK_PROTOCOLS,
      });
    }
    if (
      request.method === 'POST' &&
      ['/internal/v1/agent-results', '/internal/v1/source-results', '/internal/v1/conversation-title'].includes(request.url || '')
    ) {
      if (!authorized) return send(401, { code: 'UNAUTHORIZED' });
      // A process may change after preflight. Refuse the wrong artifact before parsing input or calling tools/model.
      const selected = request.headers['x-dreamcore-engine-version'];
      if (selected !== undefined && selected !== ENGINE_VERSION)
        return send(409, { code: 'TASK_RUNTIME_INCOMPATIBLE' });
    }
    if (request.method === 'POST' && ['/internal/v1/agent-results', '/internal/v1/conversation-title'].includes(request.url || '')) {
      const expected = Buffer.from(`Bearer ${options.token}`),
        provided = Buffer.from(request.headers.authorization || '');
      if (!enabled || provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return send(401, { code: 'UNAUTHORIZED' });
      if (!options.agent) return send(503, { code: 'MODEL_NOT_CONFIGURED' });
      const abort = new AbortController();
      response.once('close', () => {
        if (!response.writableFinished) abort.abort();
      });
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 100000) return send(413, { code: 'TOO_LARGE' });
          chunks.push(chunk);
        }
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const execute=()=>(request.url === '/internal/v1/conversation-title' ? titles! : options.agent!).run(input,abort.signal);
        const result=await (options.receipts && request.url==='/internal/v1/agent-results'
          ? options.receipts.run<unknown>('AGENT',input?.taskId,input?.attemptId,input,execute) : execute());
        if (!abort.signal.aborted) return send(200, result);
      } catch (error) {
        if (!abort.signal.aborted) {
          const code = error instanceof RuntimeError ? error.code : 'INVALID_AGENT_REQUEST';
          console.warn(
            JSON.stringify({
              event: 'ENGINE_REQUEST_FAILED',
              route: request.url === '/internal/v1/conversation-title' ? 'title' : 'agent',
              code,
              errorType: error instanceof Error ? error.name : typeof error,
              frames: error instanceof Error ? error.stack?.split('\n').slice(1, 4).map(line => line.match(/(?:dist|node_modules)\/[\w./-]+:\d+:\d+/)?.[0] ?? 'runtime') : [],
            }),
          );
          return send(code === 'INVALID_AGENT_REQUEST' ? 400 : code === 'ATTEMPT_ALREADY_SEEN' ? 409 : 503, {
            code,
          });
        }
      }
      return;
    }
    if (request.method === 'GET' && request.url === '/internal/v1/capabilities')
      return send(200, {
        contractVersion: '1.0',
        engineVersion: ENGINE_VERSION,
        runtimeMode: enabled
          ? options.agent
            ? `agent-${options.agent.config.executionClass}`
            : 'local-retrieval'
          : 'contract-only',
        capabilities: enabled ? (options.agent ? ['source-lookup', 'agent-task'] : ['source-lookup']) : [],
      });
    if (request.method === 'POST' && request.url === '/internal/v1/source-results' && enabled) {
      const expected = Buffer.from(`Bearer ${options.token}`),
        provided = Buffer.from(request.headers.authorization || '');
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return send(401, { code: 'UNAUTHORIZED' });
      let bytes = 0;
      const parts: Buffer[] = [];
      try {
        for await (const part of request) {
          bytes += part.length;
          if (bytes > 8192) {
            send(413, { code: 'TOO_LARGE' });
            request.resume();
            return;
          }
          parts.push(part);
        }
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (
          value.contractVersion !== '1.0' ||
          !uuid(value.taskId) ||
          !uuid(value.attemptId) ||
          !Array.isArray(value.sourceIds) ||
          value.sourceIds.length > 10 ||
          !value.sourceIds.every(uuid) ||
          new Set(value.sourceIds).size !== value.sourceIds.length ||
          Object.keys(value).some((k) => !['contractVersion', 'taskId', 'attemptId', 'sourceIds'].includes(k))
        )
          return send(400, { code: 'INVALID_REQUEST' });
        return send(200, {
          contractVersion: '1.0',
          engineVersion: ENGINE_VERSION,
          taskId: value.taskId,
          attemptId: value.attemptId,
          mode: 'SOURCE_LOOKUP',
          summaryCode: value.sourceIds.length ? 'SOURCES_FOUND' : 'NO_SOURCES',
          sourceIds: value.sourceIds,
        });
      } catch {
        return send(400, { code: 'INVALID_REQUEST' });
      }
    }
    send(request.method === 'GET' ? 404 : 405, {
      code: request.method === 'GET' ? 'NOT_FOUND' : 'METHOD_NOT_ALLOWED',
    });
  });
}
