// Loopback-only verification: actual Harness, synthetic model, no provider traffic.
import assert from 'node:assert/strict';
import { CompanyAnalysis } from '../../dist/runtime/company-analysis.js';
import { createEngineServer } from '../../dist/server.js';
const [token] = process.argv.slice(2);
if (!token?.startsWith('synthetic-')) throw Error('Local fixture only');
const company = new CompanyAnalysis({
  executionClass: 'verification',
  modelName: 'synthetic-company-bridge',
  createModel: () => ({
    lastUsage: null,
    async *generate(request) {
      const results = request.messages
        .flatMap((m) => m.content)
        .filter((c) => c.type === 'tool_result')
        .map((c) => JSON.parse(JSON.parse(c.content)[0].text));
      let name, args;
      if (!results.length) {
        const context = request.messages
          .flatMap((m) => m.content)
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        const chunkId = /"chunkId"\s*:\s*"([0-9a-f-]+)"/.exec(context)?.[1];
        assert.ok(chunkId);
        name = 'company_input';
        args = { chunkId };
      } else if (results.length === 1) {
        assert.equal(results[0].text, '本企业从事体育教育。');
        assert.equal(results[0].authority, false);
        name = 'company_group';
        args = { field: 'INDUSTRY' };
      } else {
        assert.equal(results.length, 2);
        assert.equal(results[1].field, 'INDUSTRY');
        name = 'submit_company_candidates';
        args = {
          candidates: [
            {
              field: 'INDUSTRY',
              targetId: null,
              label: '体育教育',
              meaning: '',
              evidence: [{ chunkId: results[0].chunkId, quote: '本企业从事体育教育。' }],
            },
          ],
        };
      }
      this.lastUsage = { inputTokens: 10, outputTokens: 2 };
      yield { type: 'tool_call', id: 'company-' + results.length, name, arguments: JSON.stringify(args) };
      yield { type: 'finish', reason: 'tool_calls' };
    },
  }),
});
const server = createEngineServer({ token, company });
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
process.on('SIGTERM', () => {
  company.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
