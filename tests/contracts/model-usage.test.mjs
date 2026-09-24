import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const schema = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/model-usage.schema.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false });
const start = ajv.compile({ ...schema, $ref: '#/$defs/Start' });
const receipt = new Ajv2020({ strict: false }).compile({ ...schema, $ref: '#/$defs/Receipt' });
test('request reservation is bounded; receipts are metadata only and preserve unknown vs zero', () => {
  assert.ok(start({ sequence: 8, maxOutputTokens: 2048 }));
  assert.equal(start({ sequence: 9, maxOutputTokens: 2048 }), false);
  assert.equal(start({ sequence: 1, maxOutputTokens: 2049 }), false);
  const base = { sequence: 1, outcome: 'CANCELLED', inputTokens: null, outputTokens: null };
  assert.ok(receipt(base));
  assert.ok(receipt({ ...base, inputTokens: 0, outputTokens: 0 }));
  for (const bad of [
    { ...base, inputTokens: 0 },
    { ...base, outcome: 'raw-error' },
    { ...base, taskId: 'private' },
    { ...base, inputTokens: -1, outputTokens: 0 },
  ])
    assert.equal(receipt(bad), false);
});
