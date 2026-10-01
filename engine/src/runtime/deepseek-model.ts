import { RuntimeError } from './ports.js';
import { ChatCompletionsModel } from './chat-completions-model.js';

/** Explicit DeepSeek non-thinking adapter. Provider addresses are not interchangeable. */
export class DeepSeekModel extends ChatCompletionsModel {
  constructor(config: {
    model: string;
    apiKey: string;
    endpoint?: string;
    localVerification?: boolean;
    timeoutMs?: number;
  }) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint ?? 'https://api.deepseek.com/chat/completions');
    } catch {
      throw new RuntimeError('INVALID_MODEL_CONFIG');
    }
    const valid = config.localVerification
      ? endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1'
      : endpoint.origin === 'https://api.deepseek.com';
    if (
      !valid ||
      endpoint.pathname !== '/chat/completions' ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password
    )
      throw new RuntimeError('INVALID_MODEL_CONFIG');
    super({
      ...config,
      endpoint,
      timeoutMs: config.timeoutMs ?? 45000,
      modeParameters: { thinking: { type: 'disabled' } },
    });
  }
}
