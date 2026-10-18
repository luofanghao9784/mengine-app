import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { setLangfuseTracerProvider, startObservation } from '@langfuse/tracing';
import { configuredObservability, taskObservation } from '../dist/runtime/observability.js';
import { meteredModel } from '../dist/runtime/metered-model.js';

test('disabled telemetry does not need credentials, enabled requires explicit origin', () => {
  assert.equal(configuredObservability({}), undefined);
  for (const url of ['', 'https://user:secret@example.test', 'http://example.test', 'https://example.test/path'])
    assert.throws(() => configuredObservability({ AGENT_LANGFUSE_ENABLED: 'true', LANGFUSE_BASE_URL: url, LANGFUSE_PUBLIC_KEY:'test', LANGFUSE_SECRET_KEY:'test' }), /LANGFUSE_CONFIGURATION_INVALID/);
});

test('model and callback observations are parented and contain no request, response or error content', async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  setLangfuseTracerProvider(provider);
  try {
    const root = startObservation('task-attempt', { metadata: { taskId:'synthetic-task', attemptId:'synthetic-attempt' } });
    const observation = taskObservation(root);
    const secret = 'PRIVATE-CONTENT-MUST-NOT-BE-EXPORTED';
    assert.equal(await observation.call('knowledge/search', async () => secret), secret);
    await assert.rejects(observation.call('knowledge/search', async () => { throw Error(secret); }));
    const backend = { lastUsage:null, async *generate(request) { assert.equal(request.messages[0].content,secret); this.lastUsage={inputTokens:12,outputTokens:3}; yield {type:'finish',reason:'stop'}; } };
    const receipts=[];
    const model=meteredModel(backend,async(action,body)=>{receipts.push({action,body});return {accepted:true};},observation,'synthetic-model');
    for await (const _ of model.generate({messages:[{role:'user',content:secret}],tools:[],maxTokens:100,signal:new AbortController().signal})) {}
    observation.end();await provider.forceFlush();
    const spans=exporter.getFinishedSpans();assert.equal(spans.length,4);
    assert.ok(!JSON.stringify(spans.map(s=>({attributes:s.attributes,events:s.events}))).includes(secret));
    for(const child of spans.filter(s=>s.name!=='task-attempt')) assert.equal(child.parentSpanContext.spanId,root.otelSpan.spanContext().spanId);
    const generation=spans.find(s=>s.name==='model-call');assert.match(JSON.stringify(generation.attributes),/12/);
    assert.equal(receipts[1].body.outcome,'RETURNED');assert.equal(receipts[1].body.inputTokens,12);
  } finally { setLangfuseTracerProvider(null);await provider.shutdown(); }
});

test('telemetry exporter failure cannot change business result', async () => {
  const provider=new NodeTracerProvider({spanProcessors:[new SimpleSpanProcessor({export(_spans,done){done({code:1,error:Error('unavailable')});},async shutdown(){}})]});
  setLangfuseTracerProvider(provider);
  try { const observation=taskObservation(startObservation('task-attempt')); assert.equal(await observation.call('check',async()=>42),42);observation.end(); }
  finally {setLangfuseTracerProvider(null);await provider.shutdown();}
});
