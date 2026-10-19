import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFoundationProcessing } from '../src/admin/prototype/processing-client.ts';
const value = {
  assetId: 'dataset-synthetic',
  name: '合成订单',
  version: 1,
  revision: 'synthetic-r1',
  recordKind: 'DATASET_ROWS',
  recordCount: 1,
  fields: [
    {
      name: '订单号',
      type: 'TEXT',
      meaning: '来源订单标识',
      unit: '',
      origin: 'SOURCE_COLUMN',
      evidence: '合成来源字典',
    },
  ],
  records: [['001']],
  offset: 0,
  hasMore: false,
  stages: [
    {
      key: 'structure',
      name: '解析与结构化',
      state: 'READY',
      at: '2026-10-19T00:00:00Z',
      detail: '已保存结构',
      outputs: ['1 条记录'],
      fields: ['订单号'],
    },
  ],
  history: [
    {
      id: 'synthetic-run',
      stage: '采集',
      state: 'SUCCEEDED',
      createdAt: '2026-10-19T00:00:00Z',
      finishedAt: '2026-10-19T00:00:01Z',
      detail: '快照 v1',
    },
  ],
  notes: [],
};
test('processing contract accepts stored fields and nullable cells', () => {
  assert.equal(isFoundationProcessing(value), true);
  assert.equal(isFoundationProcessing({ ...value, records: [[null]] }), true);
});
test('processing contract rejects row misalignment, duplicate fields and invalid timestamps', () => {
  for (const invalid of [
    { ...value, records: [['001', 'unbound']] },
    { ...value, fields: [value.fields[0], value.fields[0]], records: [] },
    { ...value, stages: [{ ...value.stages[0], at: 'invalid' }] },
    { ...value, recordCount: -1 },
  ])
    assert.equal(isFoundationProcessing(invalid), false);
});
