import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const load = async (path) =>
  JSON.parse(await readFile(new URL('../../contracts/' + path, import.meta.url), 'utf8'));
const schema = await load('engine-api/dataset-comparison.schema.json'),
  briefing = await load('engine-api/briefing-delivery.schema.json');
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } });
ajv.addSchema(schema);
ajv.addSchema(briefing);
test('dataset calculation accepts fixed identifiers and exact columns but no caller data or query language', () => {
  const valid = ajv.compile({ $ref: schema.$id + '#/$defs/request' });
  const id = '00000000-0000-4000-8000-000000000001';
  const request = {
    datasetId: id,
    snapshotId: id,
    groupColumn: '门店',
    periodColumn: '期间',
    valueColumn: '收款（元）',
    baseline: '前期',
    current: '本期',
  };
  assert.ok(valid(request));
  for (const bad of [
    { rows: [] },
    { sql: 'SELECT *' },
    { tenantId: id },
    { snapshotId: undefined },
    { valueColumn: '' },
  ])
    assert.equal(valid({ ...request, ...bad }), false);
});
test('dataset card is a distinct source kind and requires explicit business coverage availability', async () => {
  const valid = ajv.compile({ $ref: briefing.$id + '#/$defs/document' }),
    doc = await load('fixtures/dataset-briefing.json');
  assert.ok(valid(doc), JSON.stringify(valid.errors));
  const missing = structuredClone(doc);
  delete missing.content.datasetSource.coverageThrough;
  assert.equal(valid(missing), false);
  const confused = structuredClone(doc);
  confused.content.schemaVersion = 'briefing-data-v1';
  assert.equal(valid(confused), false);
});

test('text dataset insight retains source identity but cannot claim a chart calculation', async () => {
  const valid = ajv.compile({ $ref: briefing.$id + '#/$defs/document' });
  const doc = await load('fixtures/dataset-briefing.json');
  Object.assign(doc.content, {
    schemaVersion: 'briefing-text-v1',
    businessType: 'INSIGHT',
    chart: null,
    calculationArtifactId: null,
    calculationSha256: null,
    datasetBasis: null,
  });
  assert.ok(valid(doc), JSON.stringify(valid.errors));
  doc.content.datasetBasis = { groupColumn: '门店', periodColumn: '期间', matchedRows: 5, ignoredRows: 1 };
  assert.equal(valid(doc), false);
});
