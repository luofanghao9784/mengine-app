import { configuredModel } from '../dist/runtime/model-config.js';
try {
  const model = configuredModel(process.env);
  console.log(
    JSON.stringify(
      model
        ? {
            status: 'configured',
            provider: model.provider,
            model: model.modelName,
            ...(model.provider === 'bailian' ? { region: 'cn-beijing' } : {}),
            modelRequests: 0,
            liveVerified: false,
          }
        : { status: 'off', modelRequests: 0, liveVerified: false },
    ),
  );
  if (!model) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: 'invalid', code: 'INVALID_MODEL_CONFIG', modelRequests: 0 }));
  process.exitCode = 2;
}
