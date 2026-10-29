import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { computeRecipe, originalRecipeTool } from '../dist/runtime/file-recipes.js';
import { OriginalInputs } from '../dist/runtime/original-inputs.js';
import { LocalNodeSandbox } from '../dist/runtime/sandbox.js';

const csv = (text, options = {}) => computeRecipe(text, 'csv_summary', options).summary;
test('CSV handles quoted commas/newlines/escaped quotes and exact large decimal sums', () => {
  const result = csv(
    'team,amount,note\r\n"A,B",0.1,"two\r\nlines"\r\n"A,B",0.2,"a""b"\r\nC,9007199254740993.123456789012,x\r\nC,-0.000000000012,y\r\n',
    { operation: 'sum', column: 'amount', groupBy: 'team' },
  );
  assert.equal(result.totalRows, 4);
  assert.equal(result.total, '9007199254740993.423456789');
  assert.equal(result.groups[0].key, 'A,B');
  assert.equal(result.groups[0].total, '0.3');
  assert.equal(result.groups[1].total, '9007199254740993.123456789');
});
test('numeric interpretation is explicit; blanks are never silently zero and filters are exact', () => {
  const input = 'kind;amount\nA;0.01\nA;\nB;999\nA;-0.01\n';
  assert.throws(() => csv(input, { delimiter: ';', operation: 'sum', column: 'amount' }), /DATA/);
  const result = csv(input, {
    delimiter: ';',
    operation: 'sum',
    column: 'amount',
    blankNumbers: 'skip',
    filterColumn: 'kind',
    filterValue: 'A',
  });
  assert.equal(result.totalRows, 4);
  assert.equal(result.matchedRows, 3);
  assert.equal(result.numericRows, 2);
  assert.equal(result.skippedBlankNumbers, 1);
  assert.equal(result.total, '0');
  for (const number of ['1e2', '=1+1', ' 10', '1,000', '￥10', '20%', '01', 'NaN', '1.1234567890123'])
    assert.throws(() => csv('amount\n"' + number + '"', { operation: 'sum', column: 'amount' }), /DATA/);
  assert.equal(csv('a,b\nx,y\n', { filterColumn: 'a', filterValue: 'X' }).matchedRows, 0);
});
test('malformed tables, missing columns and ambiguous headers fail instead of truncating', () => {
  for (const input of ['a,a\n1,2', ',b\n1,2', 'a,b\n1', 'a\n"unfinished', 'a\n"closed"text', 'a\nx"y'])
    assert.throws(() => csv(input), /DATA/);
  assert.throws(() => csv('a\nx', { operation: 'sum', column: 'missing' }), /INVALID/);
  assert.throws(() => csv('a\nx', { filterColumn: 'a' }), /INVALID/);
  assert.throws(() => csv('a\nx', { path: '/private' }), /INVALID/);
  assert.throws(() => csv('a\n' + 'x\n'.repeat(20001)), /LIMIT/);
  assert.throws(
    () => csv('a\n' + Array.from({ length: 101 }, (_, i) => i).join('\n'), { groupBy: 'a' }),
    /LIMIT/,
  );
});
test('text recipe preserves literal content and source line boundaries with explicit output limits', () => {
  const result = computeRecipe('标题\r\n<script>literal</script>\r\n第三行\r\n', 'text_extract', {
    lineStart: 2,
    lineEnd: 3,
  });
  assert.equal(result.body, '<script>literal</script>\n第三行');
  assert.deepEqual(result.summary, { totalLines: 3, lineStart: 2, lineEnd: 3, selectedLines: 2 });
  assert.throws(() => computeRecipe('one\ntwo', 'text_extract', { lineEnd: 3 }), /INVALID/);
  assert.throws(() => computeRecipe('中'.repeat(11000), 'text_extract', {}), /LIMIT/);
});

async function setup(filename, bytes) {
  const metadata = {
    materialId: randomUUID(),
    versionId: randomUUID(),
    filename,
    version: 4,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    read: false,
  };
  let enabled = true,
    allowed = true,
    failure;
  const authorize = async () => {
    if (!allowed) throw Error('revoked');
  };
  const originals = new OriginalInputs(
    async (action) =>
      action === 'originals'
        ? { items: [metadata] }
        : { versionId: metadata.versionId, sha256: metadata.sha256, contentBase64: bytes.toString('base64') },
    authorize,
  );
  const sandbox = new LocalNodeSandbox({
    python: process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3',
  });
  const tool = originalRecipeTool({
    originals,
    sandbox,
    authorize,
    enabled: () => enabled,
    failed: (code) => {
      failure = code;
    },
  });
  return {
    metadata,
    originals,
    load: () => originals.tools()[1].execute({ versionId: metadata.versionId }),
    run: (recipe, options = {}) =>
      tool.execute({ versionId: metadata.versionId, recipe, options }, new AbortController().signal),
    disable: () => {
      enabled = false;
    },
    deny: () => {
      allowed = false;
    },
    failure: () => failure,
  };
}
test(
  'actual sandbox emits bounded private artifacts with immutable version and exact parameters',
  { skip: process.platform !== 'darwin' },
  async () => {
  const f = await setup('table.csv', Buffer.from('team,amount\nA,0.1\nA,0.2\n'));
  try {
    await assert.rejects(f.run('csv_summary'), { code: 'INPUT_NOT_GRANTED' });
    await f.load();
    const options = { operation: 'sum', column: 'amount', groupBy: 'team' };
    const result = await f.run('csv_summary', options);
    assert.equal(result.summary.total, '0.3');
    const report = JSON.parse(
      Buffer.from(
        result.artifacts.find((x) => x.name === 'processing-report-1.json').contentBase64,
        'base64',
      ),
    );
    assert.equal(report.versionId, f.metadata.versionId);
    assert.equal(report.version, 4);
    assert.equal(report.inputSha256, f.metadata.sha256);
    assert.deepEqual(report.options, options);
    for (const artifact of result.artifacts)
      assert.equal(
        createHash('sha256').update(Buffer.from(artifact.contentBase64, 'base64')).digest('hex'),
        artifact.sha256,
      );
    const second = await f.run('csv_summary', { operation: 'count' });
    assert.equal(new Set([...result.artifacts, ...second.artifacts].map((file) => file.name)).size, 6);
    assert.equal(
      report.output.sha256,
      result.artifacts.find((file) => file.name === 'table-summary-1.json').sha256,
    );
    f.disable();
    await assert.rejects(f.run('csv_summary'), { code: 'SKILL_NOT_ACTIVE' });
    f.deny();
    await assert.rejects(f.run('csv_summary'), /revoked/);
  } finally {
    f.originals.close();
  }
});
test(
  'unsupported, invalid encoding and malformed numeric input deliver specific failures without artifacts',
  { skip: process.platform !== 'darwin' },
  async () => {
  for (const [filename, bytes, recipe, options, code] of [
    ['file.xlsx', Buffer.from('not a workbook'), 'csv_summary', {}, 'UNSUPPORTED'],
    ['file.txt', Buffer.from([255, 254, 255]), 'text_extract', {}, 'ENCODING'],
    [
      'file.csv',
      Buffer.from('amount\n"1,000"'),
      'csv_summary',
      { operation: 'sum', column: 'amount' },
      'DATA',
    ],
    ['file.md', Buffer.from('one\ntwo'), 'text_extract', { lineEnd: 8 }, 'INVALID'],
    ['file.csv', Buffer.from('group\nbad\u0001value'), 'csv_summary', { groupBy: 'group' }, 'DATA'],
    [
      'file.csv',
      Buffer.from('group\n"' + 'line\n'.repeat(100) + '"'),
      'csv_summary',
      { groupBy: 'group' },
      'LIMIT',
    ],
  ]) {
    const f = await setup(filename, bytes);
    try {
      await f.load();
      await assert.rejects(f.run(recipe, options), { code: 'TASK_FILE_' + code });
      assert.equal(f.failure(), 'TASK_FILE_' + code);
    } finally {
      f.originals.close();
    }
  }
});
