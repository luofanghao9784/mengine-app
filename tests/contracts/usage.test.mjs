import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/usage.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true, date: true } });
const check = ajv.compile({ ...spec.components.schemas.Cost, components: spec.components });
test('usage reads preserve independent realm and exclude procurement fields from tenant response', () => {
  assert.equal(Object.keys(spec.paths).length, 3);
  assert.equal(spec.components.securitySchemes.sessionCookie.name, 'DREAMCORE_SESSION');
  assert.equal(spec.components.securitySchemes.platformSessionCookie.name, 'DREAMCORE_PLATFORM');
  for (const [path, route] of Object.entries(spec.paths)) {
    assert.deepEqual(Object.keys(route), ['get']);
    const platform = path.includes('/platform-admin/');
    assert.deepEqual(route.get.security, [{ [platform ? 'platformSessionCookie' : 'sessionCookie']: [] }]);
    assert.equal(
      route.get.responses['200'].content['application/json'].schema.$ref,
      `#/components/schemas/${platform ? 'Platform' : 'Usage'}`,
    );
    assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
  }
  assert.equal(spec.components.schemas.Usage.additionalProperties, false);
  assert.equal(spec.components.schemas.Usage.properties.cost, undefined);
});
test('cost and quota remain unconfigured instead of fictional zero balances', () => {
  const c = {
    state: 'NOT_CONNECTED',
    currency: null,
    verifiedMinor: null,
    estimatedMinor: null,
    sharedAllocation: 'NOT_CONFIGURED',
  };
  assert.ok(check(c));
  assert.equal(check({ ...c, verifiedMinor: 0 }), false);
  assert.equal(check({ ...c, supplierKey: 'private' }), false);
  assert.deepEqual(spec.components.schemas.Quota.properties.remaining, { type: 'null' });
});
