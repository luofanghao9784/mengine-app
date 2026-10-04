import {
  ExperienceGeneralization,
  privacyChecks,
  qualityChecks,
} from '../../dist/runtime/experience-generalization.js';
import { createEngineServer } from '../../dist/server.js';
const [token] = process.argv.slice(2);
if (!token?.startsWith('synthetic-')) throw Error('Local fixture only');
let stage = 0;
const generalization = new ExperienceGeneralization({
  executionClass: 'verification',
  modelName: 'synthetic-generalization',
  createModel() {
    const index = stage++ % 3;
    let call = 0;
    return {
      lastUsage: null,
      async *generate(args) {
        const methods = [
          ['original_method', 'submit_general_method'],
          ['original_method', 'cleaned_method', 'check_generalization_privacy'],
          ['cleaned_method', 'check_generalization_quality'],
        ][index];
        const name = methods[call++];
        if (!name) throw Error('Unexpected model call');
        if (index === 2 && JSON.stringify(args.messages).includes('private-original-sentinel'))
          throw Error('Private input leaked');
        const parameters =
          name === 'submit_general_method'
            ? {
                method: {
                  title: '比较前先核对覆盖范围',
                  summary: '保留覆盖口径和计算限制',
                  steps: ['核对两个期间的覆盖范围，不一致时停止计算增长率'],
                  applicable: ['两个期间的数值比较'],
                  excluded: ['不能证明全部场景的业务效果'],
                  tags: ['数据比较'],
                  basis: 'OBSERVED_EXECUTION',
                },
              }
            : name.startsWith('check_')
              ? {
                  checks: Object.fromEntries(
                    (index === 1 ? privacyChecks : qualityChecks).map((k) => [k, 'PASS']),
                  ),
                }
              : {};
        this.lastUsage = { inputTokens: 10, outputTokens: 2 };
        yield {
          type: 'tool_call',
          id: 'synthetic-' + index + '-' + call,
          name,
          arguments: JSON.stringify(parameters),
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
  },
});
const server = createEngineServer({ token, generalization }).listen(0, '127.0.0.1', () =>
  console.log(`http://127.0.0.1:${server.address().port}`),
);
process.on('SIGTERM', () => {
  generalization.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
