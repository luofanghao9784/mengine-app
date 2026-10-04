// Local HTTP + real Harness + synthetic model only; no external service calls.
import assert from 'node:assert/strict';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { createEngineServer } from '../../dist/server.js';
const [platformBaseUrl, token] = process.argv.slice(2);
if (new URL(platformBaseUrl).hostname !== '127.0.0.1' || !token?.startsWith('synthetic-')) throw Error('Local fixture only');
const agent = new AgentTasks({ platformBaseUrl, executionClass: 'verification', modelName: 'synthetic-dataset-bridge',
  createModel: () => ({ usage: null, async *generate(request) {
    assert.ok(request.tools.find(t => t.name === 'task_context').parameters.properties.action.enum.includes('dataset_read'));
    const results = request.messages.flatMap(m => m.content).filter(c => c.type === 'tool_result')
      .map(c => JSON.parse(JSON.parse(c.content)[0].text).result);
    let args;
    if (results.length === 0) args = { action: 'dataset_search', query: '销售' };
    else {
      const source = results[0].items[0];
      assert.equal(source.name, '销售数据'); assert.equal(source.authority, false); assert.equal(source.version, 1);
      if (results.length === 1) args = { action: 'dataset_read', referenceId: source.datasetId, versionId: source.snapshotId };
      else if (results.length === 2) {
        assert.equal(results[1].source.snapshotId, source.snapshotId); assert.equal(results[1].rows.length, 5);
        assert.equal(results[1].completeDataset, false); assert.equal(results[1].source.coverageThrough, null);
        args = { action: 'dataset_read', referenceId: source.datasetId, versionId: source.snapshotId, offset: results[1].nextOffset };
      } else {
        assert.equal(results[2].source.snapshotId, source.snapshotId); assert.equal(results[2].rows.length, 1); assert.equal(results[2].hasMore, false);
        yield { type: 'text', text: '已按固定销售数据版本 1 读取 6 行合成数据；业务覆盖时间未提供。本次形成私人草稿，没有发送或发布。' };
        yield { type: 'finish', reason: 'stop' }; return;
      }
    }
    yield { type: 'tool_call', id: 'data-' + results.length, name: 'task_context', arguments: JSON.stringify(args) };
    yield { type: 'finish', reason: 'tool_calls' };
  } }),
});
const server = createEngineServer({ token, agent });
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
process.on('SIGTERM', () => { agent.stop(); server.closeAllConnections(); server.close(() => process.exit(0)); });
