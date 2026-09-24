import { json } from './agent.mjs';
// Legacy scenario fixtures acknowledge metering; accounting behavior is tested separately.
export function usageFixture(req, res) {
  if (!req.url.includes('/model-usage/')) return false;
  json(
    res,
    req.url.endsWith('/open')
      ? { contractVersion: '1.0', maxModelCalls: 8, maxOutputTokens: 2048 }
      : { accepted: true },
  );
  return true;
}
