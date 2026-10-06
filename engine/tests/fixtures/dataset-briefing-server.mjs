// Actual HTTP + Harness, synthetic model only, local endpoint only.
import assert from 'node:assert/strict';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { createEngineServer } from '../../dist/server.js';
const [platformBaseUrl, token] = process.argv.slice(2);
if (new URL(platformBaseUrl).hostname !== '127.0.0.1' || !token?.startsWith('synthetic-'))
  throw Error('Local fixture only');
const agent = new AgentTasks({
  platformBaseUrl,
  executionClass: 'verification',
  modelName: 'synthetic-dataset-briefing',
  createModel: () => ({
    lastUsage: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    async *generate(request) {
      try {
        assert.ok(request.tools.some((t) => t.name === (request.requiredTool ?? 'compare_dataset')));
        if (request.requiredTool)
          assert.deepEqual(
            request.tools.map((t) => t.name),
            ['deliver_briefing'],
          );
        const results = request.messages
          .flatMap((m) => m.content)
          .filter((c) => c.type === 'tool_result')
          .map((c) => JSON.parse(JSON.parse(c.content)[0].text));
        let name, args;
        if (!results.length) {
          name = 'task_context';
          args = { action: 'dataset_search', query: '销售' };
        } else {
          const source = results[0].result.items[0];
          if (results.length === 1) {
            name = 'task_context';
            args = { action: 'dataset_read', referenceId: source.datasetId, versionId: source.snapshotId };
          } else if (results.length === 2) {
            assert.equal(results[1].result.completeDataset, false);
            name = 'compare_dataset';
            args = {
              datasetId: source.datasetId,
              snapshotId: source.snapshotId,
              groupColumn: '门店',
              periodColumn: '期间',
              valueColumn: '收款（元）',
              baseline: '前期',
              current: '本期',
            };
          } else if (results.length === 3) {
            assert.equal(results[2].calculation.totals.current, '1.20');
            assert.equal(results[2].calculation.ignoredRows, 1);
            name = 'deliver_briefing';
            args = {
              businessType: 'DATA',
              presentation: {
                version: 'briefing-presentation-v1',
                layout: 'KEY_METRIC',
                chartStyle: 'DUMBBELL',
                focusGroup: '甲',
                focusValue: 'CURRENT',
                sections: [],
              },
              calculationArtifactId: results[2].artifact.id,
              title: '门店两期收款比较',
              summary: '两家门店的同口径收款合计由零点六元增长到一点二元。',
              analysis: [
                '两家门店均采用固定数据版本中的完整记录进行比较，其他期间未纳入统计。',
                '当前数字只能说明两期收款变化，经营原因仍需结合其他业务资料判断。',
              ],
            };
          } else {
            assert.equal(results[3].status, 'PREPARED');
            this.lastUsage = { inputTokens: 10, outputTokens: 2 };
            this.usage.inputTokens += 10;
            this.usage.outputTokens += 2;
            yield { type: 'text', text: '画报已生成。' };
            yield { type: 'finish', reason: 'stop' };
            return;
          }
        }
        this.lastUsage = { inputTokens: 10, outputTokens: 2 };
        this.usage.inputTokens += 10;
        this.usage.outputTokens += 2;
        yield { type: 'tool_call', id: 'data-' + results.length, name, arguments: JSON.stringify(args) };
        yield { type: 'finish', reason: 'tool_calls' };
      } catch (error) {
        console.error('Synthetic briefing fixture failure:', error);
        throw error;
      }
    },
  }),
});
const server = createEngineServer({ token, agent });
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
process.on('SIGTERM', () => {
  agent.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
