import { DeepSeekModel } from './deepseek-model.js';
import { BailianModel } from './bailian-model.js';
import { RuntimeError } from './ports.js';

/** Validates configuration without networking. No fallback, provider auto-detection or secret logging. */
export function configuredModel(env: NodeJS.ProcessEnv) {
  const provider = env.AGENT_MODEL_PROVIDER ?? 'off';
  if (provider === 'off') return undefined;
  const config = { model: env.AGENT_MODEL_NAME ?? '', apiKey: env.AGENT_MODEL_API_KEY ?? '' };
  let createModel: () => DeepSeekModel | BailianModel;
  if (provider === 'bailian') {
    const workspaceId = env.AGENT_BAILIAN_WORKSPACE_ID ?? '';
    createModel = () => new BailianModel({ ...config, workspaceId });
  } else if (provider === 'deepseek') {
    createModel = () => new DeepSeekModel(config);
  } else throw new RuntimeError('INVALID_MODEL_PROVIDER');
  createModel();
  return { provider, modelName: config.model, createModel };
}
