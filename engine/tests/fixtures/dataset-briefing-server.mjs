// Actual HTTP + Harness, synthetic model only, local endpoint only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { createEngineServer } from '../../dist/server.js';
const [platformBaseUrl, token, mode, audienceKey] = process.argv.slice(2);
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
          } else if (results.length === 2 && request.tools.some(t=>t.name==='select_briefing_topic')) {
            assert.equal(results[1].result.completeDataset, false);
            assert.match(audienceKey ?? '', /^[a-f0-9]{32}$/);
            name = 'select_briefing_topic';
            args = {
              candidates: [{
                question: '两家门店本期登记收款各是多少',
                evidenceNeeded: '已获权固定快照中的门店、期间与收款列，按完整记录计算',
                requiresCalculation: true,
                difference: '首次按已发布方法核对本期门店收款',
                businessType: 'DATA',
                goal: '核对各店同一期间收款变化',
                destination: 'BRIEFING',
                userValue: '支持核对门店收款与凭证',
              }],
              selectedIndex: 0,
              editorialPlan: {
                batchId: randomUUID(), audienceKey,
                items: [{ goalRef: 'responsibilities', questionKey: 'store-period-receipts',
                  scope: '当前获权门店', period: '本期', shape: 'COMPARISON',
                  decision: 'EMIT', mergeInto: -1, reason: '按完整记录比较已获权门店收款' }],
              },
            };
          } else if (!results.some(r=>r.calculation)) {
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
            if(mode==='composition')args={datasetId:source.datasetId,snapshotId:source.snapshotId,operation:'COMPOSITION',groupColumns:['门店'],valueColumn:'收款（元）'};
            if(audienceKey)args=source.nativeAnalysisPlans.items[0].selection;
          } else if (!results.some(r=>r.status==='PREPARED'||r.status==='NO_NEW_CONTENT')) {
            const verified=results.find(r=>r.calculation);
            if(!mode){assert.equal(audienceKey?verified.calculation.total:verified.calculation.totals.current, '1.20');assert.equal(verified.calculation.ignoredRows, audienceKey?4:1);}
            name = 'deliver_briefing';
            args = {
              businessType: 'DATA',
              presentation: {
                version: 'briefing-presentation-v1',
                layout: audienceKey ? 'EDITORIAL' : 'KEY_METRIC',
                chartStyle: audienceKey ? 'CURRENT_BAR' : 'DUMBBELL',
                focusGroup: audienceKey ? null : '甲',
                focusValue: audienceKey ? null : 'CURRENT',
                sections: [],
              },
              calculationArtifactId: verified.artifact.id,
              title: mode==='composition'?'甲店收款占比高于乙店':audienceKey?'本期门店登记收款':'门店两期收款比较',
              summary: audienceKey?'两家门店本期登记收款合计一点二元，不能据此认定银行到账。':'两家门店的同口径收款合计由零点六元增长到一点二元。',
              analysis: [
                '两家门店均采用固定数据版本中的完整记录进行比较，其他期间未纳入统计。',
                '当前数字只能说明两期收款变化，经营原因仍需结合其他业务资料判断。',
              ],
            };
            if(mode)delete args.presentation;
          } else {
            assert.equal(results.at(-1).status, 'PREPARED');
            this.lastUsage = { inputTokens: 10, outputTokens: 2 };
            this.usage.inputTokens += 10;
            this.usage.outputTokens += 2;
            yield { type: 'text', text: '画报已生成。' };
            yield { type: 'finish', reason: 'stop' };
            return;
          }
        }
        assert.ok(request.tools.some((t) => t.name === name), `Tool ${name} must be available in the current phase`);
        if (request.requiredTool) assert.equal(name, request.requiredTool);
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
