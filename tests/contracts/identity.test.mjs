import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/identity.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const validate = ajv.compile({ ...spec.components.schemas.Me, components: spec.components });

test('identity contract has distinct platform role and tenant membership without credentials', () => {
  const identity = {
    account: { id: 'synthetic', email: 'user@example.test', displayName: '合成' },
    platformAdmin: true,
    memberships: [],
  };
  assert.equal(validate(identity), true);
  assert.equal(validate({ ...identity, password: 'never-in-a-response' }), false);
  assert.equal(
    validate({
      ...identity,
      memberships: [{ tenantId: 'synthetic', tenantName: '合成', role: 'PLATFORM_ADMIN' }],
    }),
    false,
  );
});

test('all documented writes require CSRF including anonymous invitation acceptance', () => {
  for (const path of Object.values(spec.paths)) {
    for (const method of ['post', 'delete', 'put', 'patch']) {
      if (path[method])
        assert.ok(path[method].parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
    }
  }
  assert.deepEqual(spec.paths['/api/v1/auth/invitations/accept'].post.security, []);
  for (const path of Object.keys(spec.paths)) assert.doesNotMatch(path, /impersonate|content|conversation/);
});
