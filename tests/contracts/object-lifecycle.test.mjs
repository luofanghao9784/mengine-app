import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(
    new URL('../../contracts/public-api/object-lifecycle.openapi.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const compile = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
test('permanent online deletion requires an explicit decision and optimistic revision', () => {
  const v = compile('Action');
  assert(v({ requestId: id, expectedRevision: 1, action: 'PURGE', irreversibleConfirmed: true }));
  assert(!v({ requestId: id, expectedRevision: 1, action: 'PURGE', irreversibleConfirmed: false }));
  assert(!v({ requestId: id, action: 'PURGE', irreversibleConfirmed: true }));
  assert(!v({ requestId: id, expectedRevision: 1, action: 'PURGE', irreversibleConfirmed: true, runAs: id }));
  for (const path of Object.values(spec.paths))
    if (path.post) assert(path.post.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
});
test('platform technical aggregate has no customer content identity or prose', () => {
  const v = compile('Technical');
  assert(v({ kind: 'TASK', state: 'PURGED', count: 3 }));
  assert(!v({ kind: 'TASK', state: 'PURGED', count: 3, tenantId: id }));
  assert(!v({ kind: 'TASK', state: 'PURGED', count: 3, body: 'customer text' }));
});
