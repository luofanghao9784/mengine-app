import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { configuredModel } from '../dist/runtime/model-config.js';

const safeFailures = new Map([
  ['INVALID_MODEL_CONFIG', 'invalid_configuration'],
  ['INVALID_MODEL_PROVIDER', 'invalid_configuration'],
  ['CANCELLED', 'cancelled'],
  ['REMOTE_ACCESS_DENIED', 'remote_access_denied'],
  ['REMOTE_UNAVAILABLE', 'remote_unavailable'],
  ...['MODEL_RATE_LIMITED','MODEL_PROVIDER_UNAVAILABLE','MODEL_REQUEST_REJECTED','MODEL_TIMEOUT','MODEL_NETWORK_ERROR'].map(code=>[code,'remote_unavailable']),
  ['INVALID_REMOTE_RESPONSE', 'invalid_response'],
  ['INVALID_MODEL_RESPONSE', 'invalid_response'],
  ['REMOTE_OUTPUT_LIMIT', 'output_limit'],
  ['MODEL_INPUT_LIMIT', 'input_limit'],
  ['SMOKE_RESPONSE_INVALID', 'invalid_response'],
  ['SMOKE_OUTPUT_LIMIT', 'output_limit'],
  ['SMOKE_TOOL_MISMATCH', 'tool_verification_failed'],
]);
const failure = (code) => Object.assign(new Error('Model smoke failed'), { code });

/** Explicit one-shot cloud probe. No files, user data, retries, fallback or tool execution runtime. */
export async function runSmoke(env, { tools = false, signal = new AbortController().signal } = {}) {
  const started = performance.now();
  const report = {
    status: 'failed', provider: null, model: null, durationMs: 0,
    usage: null, requestCount: 0, liveVerified: false,
  };
  let backend;
  try {
    const configured = configuredModel(env);
    if (!configured) {
      report.status = 'off';
      report.provider = 'off';
      return report;
    }
    // A misplaced secret in the otherwise syntactically valid model name must not be reflected.
    if (configured.modelName.includes(env.AGENT_MODEL_API_KEY))
      throw failure('INVALID_MODEL_CONFIG');
    report.provider = configured.provider;
    report.model = configured.modelName;
    backend = configured.createModel();
    const generate = async (messages, availableTools) => {
      signal.throwIfAborted();
      if (report.requestCount >= (tools ? 2 : 1)) throw failure('SMOKE_RESPONSE_INVALID');
      report.requestCount++;
      const parts = [];
      for await (const part of backend.generate({ messages, tools: availableTools, maxTokens: 64, signal }))
        parts.push(part);
      const finished = parts.at(-1);
      if (finished?.type !== 'finish' || parts.slice(0, -1).some((part) => part.type === 'finish'))
        throw failure('SMOKE_RESPONSE_INVALID');
      if (finished.reason === 'length') throw failure('SMOKE_OUTPUT_LIMIT');
      return { content: parts.slice(0, -1), reason: finished.reason };
    };
    const text = (content) => content.filter((part) => part.type === 'text').map((part) => part.text).join('').trim();
    const messages = [{ role: 'user', content: [{ type: 'text', text: tools
      ? 'This is a synthetic connectivity check. Call smoke_marker exactly once with no arguments. Then reply with only the marker returned by that tool. Do not guess the marker.'
      : 'This is a synthetic connectivity check. Reply with the single word READY.' }] }];
    if (tools) {
      const first = await generate(messages, [{
        name: 'smoke_marker',
        description: 'Read a fresh, synthetic marker held only in this process. Takes no arguments and changes nothing.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      }]);
      const calls = first.content.filter((part) => part.type === 'tool_call');
      if (first.reason !== 'tool_calls' || calls.length !== 1 || calls[0].name !== 'smoke_marker')
        throw failure('SMOKE_TOOL_MISMATCH');
      let args;
      try { args = JSON.parse(calls[0].arguments); } catch { throw failure('SMOKE_TOOL_MISMATCH'); }
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length)
        throw failure('SMOKE_TOOL_MISMATCH');
      const marker = `smoke-${randomUUID()}`;
      const final = await generate([
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: [{ type: 'tool_result', id: calls[0].id, content: JSON.stringify({ marker }) }] },
      ], []);
      if (final.reason !== 'stop' || final.content.some((part) => part.type !== 'text') || text(final.content) !== marker)
        throw failure('SMOKE_TOOL_MISMATCH');
    } else {
      const final = await generate(messages, []);
      if (final.reason !== 'stop' || !text(final.content) || final.content.some((part) => part.type !== 'text'))
        throw failure('SMOKE_RESPONSE_INVALID');
    }
    report.status = 'succeeded';
    report.liveVerified = true;
  } catch (error) {
    report.status = signal.aborted ? 'cancelled' : safeFailures.get(error?.code) ?? 'failed';
  } finally {
    report.durationMs = Math.round(performance.now() - started);
    report.usage = backend?.usage ?? null;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const valid = args.length === 0 || (args.length === 1 && args[0] === '--tools');
  const report = valid
    ? await runSmoke(process.env, { tools: args[0] === '--tools', signal: controller.signal })
    : { status: 'invalid_arguments', provider: null, model: null, durationMs: 0, usage: null, requestCount: 0, liveVerified: false };
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  console.log(JSON.stringify(report));
  process.exitCode = report.liveVerified ? 0 : report.status === 'off' ? 1
    : ['invalid_configuration', 'invalid_arguments'].includes(report.status) ? 2
      : report.status === 'cancelled' ? 130 : 3;
}
