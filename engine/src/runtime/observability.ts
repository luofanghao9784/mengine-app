import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { setLangfuseTracerProvider, startObservation, type LangfuseSpan } from '@langfuse/tracing';

/** Observability is optional, metadata-only and never an execution receipt. */
export interface TaskObservation {
  call<T>(action: string, run: () => Promise<T>): Promise<T>;
  model(name: string, sequence: number): (outcome: string, usage?: { inputTokens: number; outputTokens: number } | null) => void;
  end(): void;
}
export interface Observability {
  task(taskId: string, attemptId: string): TaskObservation | undefined;
  close(): Promise<void>;
}
function safe(action: () => void) { try { action(); } catch { /* Telemetry cannot fail business work. */ } }
export function taskObservation(root: LangfuseSpan): TaskObservation {
  return {
    async call(action, run) {
      let child: ReturnType<typeof root.startObservation> | undefined;
      safe(() => { child = root.startObservation('platform-call', { metadata: { action: /^[a-z/-]{1,64}$/.test(action) ? action : 'other' } }); });
      try { const value = await run(); safe(() => { child?.update({ metadata: { outcome: 'RETURNED' } }); }); return value; }
      catch (error) { safe(() => { child?.update({ level: 'ERROR', metadata: { outcome: 'FAILED' } }); }); throw error; }
      finally { safe(() => { child?.end(); }); }
    },
    model(name, sequence) {
      let child: ReturnType<typeof startObservation> | undefined;
      safe(() => { child = root.startObservation('model-call', { model: name, metadata: { sequence } }, { asType: 'generation' }); });
      return (outcome, usage) => safe(() => {
        // Tokens are numeric receipts only. No model input/output or raw exceptions.
        const usageDetails = usage && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens)
          && usage.inputTokens >= 0 && usage.outputTokens >= 0 ? { input: usage.inputTokens, output: usage.outputTokens } : undefined;
        child?.update({ metadata: { outcome }, ...(usageDetails ? { usageDetails } : {}) });
        child?.end();
      });
    },
    end() { safe(() => { root.end(); }); },
  };
}
export function configuredObservability(env: NodeJS.ProcessEnv): Observability | undefined {
  if (env.AGENT_LANGFUSE_ENABLED !== 'true') return undefined;
  let base: URL;
  try { base = new URL(env.LANGFUSE_BASE_URL ?? ''); } catch { throw new Error('LANGFUSE_CONFIGURATION_INVALID'); }
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || base.username || base.password || base.search || base.hash
    || base.pathname !== '/' || !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))))
    throw new Error('LANGFUSE_CONFIGURATION_INVALID');
  const processor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY, baseUrl: base.origin,
    flushAt: 64, flushInterval: 5, timeout: 2, mediaUploadEnabled: false,
    shouldExportSpan: ({ otelSpan }) => ['task-attempt', 'model-call', 'platform-call'].includes(otelSpan.name),
  });
  // Isolated provider avoids exporting unrelated automatic HTTP/db spans or their payloads.
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);
  return {
    task(taskId, attemptId) {
      try { return taskObservation(startObservation('task-attempt', { metadata: { taskId, attemptId } })); }
      catch { return undefined; }
    },
    async close() { try { await provider.shutdown(); } catch { /* Bounded by process shutdown deadline. */ } },
  };
}
