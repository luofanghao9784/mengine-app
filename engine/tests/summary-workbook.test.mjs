import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { inspectWorkbook } from './helpers/workbook.mjs';
import { computeRecipe } from '../dist/runtime/file-recipes.js';
import { summaryWorkbook } from '../dist/runtime/summary-workbook.js';

const source = {
  filename: '合成统计.csv',
  version: 4,
  versionId: '00000000-0000-4000-8000-000000000001',
  materialId: '00000000-0000-4000-8000-000000000002',
  inputSha256: 'a'.repeat(64),
  inputBytes: 100,
  recipeVersion: '1.1.0',
  options: {},
};
const generate = (csv, options) => {
  const summary = computeRecipe(csv, 'csv_summary', options).summary;
  const bytes = summaryWorkbook(summary, { ...source, options }, deflateRawSync);
  return { summary, bytes, ...inspectWorkbook(bytes) };
};
test('XLSX has real typed cells, exact statistics, immutable source and readable workbook controls', () => {
  const { sheets, files, bytes } = generate('team,amount\n华东,0.1\n华东,0.2\n华南,10\n', {
    operation: 'sum',
    column: 'amount',
    groupBy: 'team',
  });
  assert.equal(files.length, 7);
  assert.equal(sheets[0].B8.value, '10.3');
  assert.equal(sheets[0].E11.value, '0.3');
  assert.equal(sheets[0].E11.type, 'n');
  assert.equal(sheets[0].A11.value, '华东');
  assert.equal(sheets[0].B5.value, '3');
  assert.equal(sheets[1].B4.value, '4');
  assert.equal(sheets[1].B5.value, source.versionId);
  assert.equal(sheets[1].B7.value, source.inputSha256);
  assert.ok(bytes.length < 24000);
});
test('large exact totals remain text; formula-like names, zeros and XML special characters stay literal', () => {
  const { sheets } = generate(
    'team,amount\n=1+1,9007199254740993.123456789012\n"A&B<中>\n第二行",-0.000000000012\n001,0\n',
    { operation: 'sum', column: 'amount', groupBy: 'team' },
  );
  assert.deepEqual(sheets[0].B8, { type: 'inlineStr', value: '9007199254740993.123456789' });
  assert.deepEqual(sheets[0].A11, { type: 'inlineStr', value: '=1+1' });
  assert.equal(sheets[0].A12.value, 'A&B<中>\n第二行');
  assert.deepEqual(sheets[0].A13, { type: 'inlineStr', value: '001' });
  assert.equal(sheets[0].E13.value, '0');
});
test('empty results, skip-blank and exact filters preserve zero vs absent arithmetic', () => {
  const none = generate('team,amount\nA,1\n', {
    operation: 'sum',
    column: 'amount',
    filterColumn: 'team',
    filterValue: 'B',
  });
  assert.equal(none.sheets[0].B8.value, '0');
  assert.equal(none.sheets[0].D5.value, '0');
  assert.match(none.sheets[0].A11.value, /无匹配/);
  const skipped = generate('team,amount\nA,\nA,0.01\nB,100\n', {
    operation: 'sum',
    column: 'amount',
    filterColumn: 'team',
    filterValue: 'A',
    blankNumbers: 'skip',
  });
  assert.equal(skipped.sheets[0].B6.value, '1');
  assert.equal(skipped.sheets[0].D6.value, '1');
  assert.equal(skipped.sheets[0].B8.value, '0.01');
  const count = generate('team\nA\nB\n', { operation: 'count' });
  assert.equal(count.sheets[0].B8.value, '2');
  assert.equal(count.sheets[0].E11.value, '—');
  const blank = generate('group,value\n,1\n（空值）,2', { operation: 'count', groupBy: 'group' });
  assert.equal(blank.sheets[0].A11.value, '');
  assert.equal(blank.sheets[0].A12.value, '（空值）');
});
test('workbook export is deterministic and rejects unrepresentable characters/layout instead of dropping data', () => {
  const summary = computeRecipe('team,amount\nA,0.3', 'csv_summary', {
    operation: 'sum',
    column: 'amount',
    groupBy: 'team',
  }).summary;
  assert.deepEqual(
    summaryWorkbook(summary, source, deflateRawSync),
    summaryWorkbook(summary, source, deflateRawSync),
  );
  for (const label of ['bad\u0001value', '\ud800'])
    assert.throws(
      () =>
        summaryWorkbook(
          { ...summary, groups: [{ ...summary.groups[0], key: label }] },
          source,
          deflateRawSync,
        ),
      /DATA/,
    );
  assert.throws(
    () =>
      summaryWorkbook(
        { ...summary, groups: [{ ...summary.groups[0], key: 'line\n'.repeat(100) }] },
        source,
        deflateRawSync,
      ),
    /LIMIT/,
  );
});
