/** Platform-owned v1 contract. Capability changes must update schemas and compatibility tests. */
export type EngineCapabilities = {
  contractVersion: '1.0';
  engineVersion: string;
  runtimeMode: 'contract-only' | 'local-retrieval' | 'agent-verification' | 'agent-live';
  capabilities: string[];
};
export type SystemInfo = {
  contractVersion: '1.0';
  service: 'dreamcore-platform';
  stage: 'foundation';
  dataSource: 'live' | 'demo';
  engine: EngineCapabilities;
  integrations: {
    harness: 'not-configured' | 'verification' | 'configured';
    weknora: 'not-configured';
    jev: 'not-configured';
  };
};

export type SystemErrorBody = {
  contractVersion: '1.0';
  code: 'ENGINE_UNAVAILABLE' | 'ENGINE_INCOMPATIBLE';
  message: string;
  retryable: boolean;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isSystemError(value: unknown): value is SystemErrorBody {
  return (
    record(value) &&
    value.contractVersion === '1.0' &&
    (value.code === 'ENGINE_UNAVAILABLE' || value.code === 'ENGINE_INCOMPATIBLE') &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    typeof value.retryable === 'boolean'
  );
}

export function isSystemInfo(value: unknown): value is SystemInfo {
  if (!record(value) || !record(value.engine) || !record(value.integrations)) return false;
  const engine = value.engine;
  return (
    value.contractVersion === '1.0' &&
    value.service === 'dreamcore-platform' &&
    value.stage === 'foundation' &&
    (value.dataSource === 'live' || value.dataSource === 'demo') &&
    engine.contractVersion === '1.0' &&
    typeof engine.engineVersion === 'string' &&
    engine.engineVersion.trim().length > 0 &&
    Array.isArray(engine.capabilities) &&
    ((engine.runtimeMode === 'contract-only' && engine.capabilities.length === 0) ||
      (engine.runtimeMode === 'local-retrieval' &&
        engine.capabilities.length === 1 &&
        engine.capabilities[0] === 'source-lookup') ||
      (['agent-verification', 'agent-live'].includes(String(engine.runtimeMode)) &&
        engine.capabilities.join(',') === 'source-lookup,agent-task')) &&
    value.integrations.harness ===
      (engine.runtimeMode === 'agent-verification'
        ? 'verification'
        : engine.runtimeMode === 'agent-live'
          ? 'configured'
          : 'not-configured') &&
    value.integrations.weknora === 'not-configured' &&
    value.integrations.jev === 'not-configured'
  );
}
