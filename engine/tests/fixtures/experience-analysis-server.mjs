// Loopback-only adapter integration: actual Harness, synthetic model, no provider traffic.
import { ExperienceAnalysis } from '../../dist/runtime/experience-analysis.js';
import { createEngineServer } from '../../dist/server.js';
const [token] = process.argv.slice(2);
if (!token?.startsWith('synthetic-')) throw Error('Local fixture only');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const evidence = [{ inputId: id(6), quote: '两期覆盖范围不一致，未计算不可靠的增长率' }];
const candidate = {
  targetVersionId: null,
  title: '比较前先核对覆盖范围',
  summary: '缺少可比口径时不计算增长率。',
  steps: ['检查两期覆盖范围，差异无法排除时说明限制。'],
  applicable: ['有固定期间及数据来源'],
  excluded: ['缺少可比口径'],
  tags: ['数据比较'],
  evidence,
};
const experience = new ExperienceAnalysis({
  executionClass: 'verification',
  modelName: 'synthetic-experience-bridge',
  createModel() {
    let calls = 0;
    return {
      lastUsage: null,
      async *generate(request) {
        const verify = request.tools.some((t) => t.name === 'verify_experience');
        const sequence = [
          ['experience_input', { id: id(5) }],
          ['experience_input', { id: id(6) }],
          ['existing_experiences', {}],
          ...(verify
            ? [
                ['experience_candidate', {}],
                [
                  'verify_experience',
                  {
                    checks: Object.fromEntries(
                      ['grounded', 'reusable', 'bounded', 'privacySafe', 'novel'].map((k) => [k, 'PASS']),
                    ),
                    basis: 'OBSERVED_EXECUTION',
                    evidence,
                  },
                ],
              ]
            : [['submit_experience', { candidate }]]),
        ];
        const step = sequence[calls++];
        if (!step) throw Error('Unexpected synthetic model call');
        this.lastUsage = { inputTokens: 10, outputTokens: 2 };
        yield {
          type: 'tool_call',
          id: 'experience-' + calls,
          name: step[0],
          arguments: JSON.stringify(step[1]),
        };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    };
  },
});
const server = createEngineServer({ token, experience });
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
process.on('SIGTERM', () => {
  experience.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
