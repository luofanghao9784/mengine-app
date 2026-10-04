// Only synthetic ModelPort output, used by persistent-dispatch integration tests.
import { ExperienceAnalysis } from '../../dist/runtime/experience-analysis.js';
import { createEngineServer } from '../../dist/server.js';
const [token, mode] = process.argv.slice(2);
if (!token?.startsWith('synthetic-') || !['skip', 'qualify', 'adjust'].includes(mode))
  throw Error('Local fixture only');
const experience = new ExperienceAnalysis({
  executionClass: 'verification',
  modelName: 'synthetic-dispatch',
  createModel() {
    return {
      lastUsage: null,
      async *generate(r) {
        const outputs = r.messages
          .flatMap((m) => m.content)
          .filter((c) => c.type === 'tool_result')
          .map((c) => JSON.parse(JSON.parse(c.content)[0].text));
        const verify = r.tools.some((t) => t.name === 'verify_experience');
        const send = (name, args, n) => ({
          type: 'tool_call',
          id: 'c' + n,
          name,
          arguments: JSON.stringify(args),
        });
        this.lastUsage = { inputTokens: 10, outputTokens: 2 };
        if (!outputs.length) {
          const content = r.messages
            .flatMap((m) => m.content)
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          const ids = [...content.matchAll(/"id"\s*:\s*"([0-9a-f-]+)"\s*,\s*"kind"/g)].map((m) => m[1]);
          if (!ids.length) throw Error('No fixed inputs');
          for (const [n, id] of ids.entries()) yield send('experience_input', { id }, n);
        } else if (!outputs.some((o) => Array.isArray(o.items))) yield send('existing_experiences', {}, 10);
        else if (!verify && mode === 'skip')
          yield send('skip_experience', { reason: 'NO_REUSABLE_METHOD' }, 11);
        else if (verify && !outputs.some((o) => o.candidate)) yield send('experience_candidate', {}, 11);
        else {
          const record = outputs.find((o) => o.kind === 'EXECUTION_RECORD');
          if (!record && mode !== 'adjust') throw Error('No execution record');
          const evidence =
            mode === 'adjust'
              ? outputs
                  .filter((o) => ['FEEDBACK', 'SOURCE_EXCERPT'].includes(o.kind))
                  .map((o) => ({ inputId: o.id, quote: o.text.slice(0, 700) }))
              : [{ inputId: record.id, quote: record.text }];
          if (verify)
            yield send(
              'verify_experience',
              {
                checks: Object.fromEntries(
                  ['grounded', 'reusable', 'bounded', 'privacySafe', 'novel'].map((k) => [k, 'PASS']),
                ),
                basis: mode === 'adjust' ? 'FEEDBACK_CORRECTION' : 'OBSERVED_EXECUTION',
                evidence,
              },
              12,
            );
          else
            yield send(
              'submit_experience',
              {
                candidate: {
                  targetVersionId:
                    mode === 'adjust' ? outputs.find((o) => Array.isArray(o.items)).items[0].versionId : null,
                  title: '区分工具执行与业务结果',
                  summary: '工具回执不直接证明业务正确性。',
                  steps: ['先读取实际工具状态，再核对业务结果依据。'],
                  applicable: ['有平台工具回执'],
                  excluded: ['没有回执时不能推断执行成功'],
                  tags: ['执行状态'],
                  evidence,
                },
              },
              12,
            );
        }
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
