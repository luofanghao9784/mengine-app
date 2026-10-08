import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workBusinesses } from '../src/operations/engine-stage/work-business.ts';
import { channelInfo } from '../src/operations/engine-dashboard-model.ts';

test('business nodes partition every processing channel exactly once', () => {
  const codes = workBusinesses.flatMap((b) => b.codes);
  const expected = Object.entries(channelInfo)
    .filter(([, value]) => value.stage === 'pr')
    .map(([code]) => code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual([...codes].sort(), expected.sort());
  assert.deepEqual(
    workBusinesses.map((b) => b.codes.length),
    [1, 1, 3],
  );
});
