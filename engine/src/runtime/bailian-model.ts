import { RuntimeError } from './ports.js';
import { ChatCompletionsModel } from './chat-completions-model.js';

// Explicit text/tool calling model IDs. Aliases may change upstream; receipts retain the requested ID.
// This list is an adapter capability boundary, not a claim of live quality acceptance.
export const BAILIAN_MODELS = Object.freeze([
  'qwen3.7-plus',
  'qwen3.7-flash',
  'qwen3.7-plus-2026-05-26',
  'qwen3.7-flash-2026-07-15',
  'qwen3.8-max-0902',
]);
export class BailianModel extends ChatCompletionsModel {
  constructor(config: {
    model: string;
    apiKey: string;
    workspaceId: string;
    localVerification?: boolean;
    endpoint?: string;
    timeoutMs?: number;
  }) {
    if (
      !BAILIAN_MODELS.includes(config.model) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.workspaceId)
    )
      throw new RuntimeError('INVALID_MODEL_CONFIG');
    const path = '/compatible-mode/v1/chat/completions';
    // Numeric console workspace IDs use the fixed Beijing shared endpoint.
    // The supplied workspace-scoped API key remains the cloud authorization.
    const host = /^\d+$/.test(config.workspaceId) ? 'dashscope.aliyuncs.com'
      : `${config.workspaceId}.cn-beijing.maas.aliyuncs.com`;
    let endpoint = new URL(`https://${host}${path}`);
    // Test-only loopback transport is never exposed through production environment variables.
    if (config.localVerification) {
      try {
        endpoint = new URL(config.endpoint ?? '');
      } catch {
        throw new RuntimeError('INVALID_MODEL_CONFIG');
      }
      if (
        endpoint.protocol !== 'http:' ||
        endpoint.hostname !== '127.0.0.1' ||
        endpoint.pathname !== path ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.username ||
        endpoint.password
      )
        throw new RuntimeError('INVALID_MODEL_CONFIG');
    } else if (config.endpoint !== undefined) throw new RuntimeError('INVALID_MODEL_CONFIG');
    super({
      ...config,
      endpoint,
      timeoutMs: config.timeoutMs ?? 45000,
      modeParameters: { enable_thinking: false },
    });
  }
}
