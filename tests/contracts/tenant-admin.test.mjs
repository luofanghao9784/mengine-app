import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/identity.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const schema = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
test('managed spaces exclude personal content and undeclared fields', () => {
  const check = schema('SharedWorkspace'),
    space = {
      id: 'synthetic',
      tenantId: 'synthetic',
      name: '团队资料',
      kind: 'SHARED',
      version: 0,
      memberCount: 0,
    };
  assert.ok(check(space));
  assert.equal(check({ ...space, kind: 'PERSONAL' }), false);
  assert.equal(check({ ...space, documents: [] }), false);
  assert.equal(check({ ...space, version: -1 }), false);
});
test('membership and space mutations require optimistic version and idempotency key', () => {
  for (const [name, body] of [
    ['ChangeMemberStatus', { status: 'DISABLED' }],
    ['ChangeWorkspaceGrant', { enabled: true }],
    ['RenameManagedResource', { name: '新名称' }],
  ]) {
    const check = schema(name);
    assert.ok(check({ ...body, requestId: 'synthetic', expectedVersion: 0 }));
    assert.equal(check({ ...body, requestId: 'synthetic' }), false);
    assert.equal(check({ ...body, expectedVersion: 0 }), false);
    assert.equal(
      check({ ...body, requestId: 'synthetic', expectedVersion: 0, role: 'PLATFORM_ADMIN' }),
      false,
    );
  }
});
