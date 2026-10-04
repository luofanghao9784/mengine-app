import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/governance.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const schema = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
test('owner handover has explicit tenant role choices and independently versioned closing endpoints', () => {
  const offer = schema('Offer'),
    body = { requestId: 'synthetic', accountId: 'synthetic', expectedVersion: 1 };
  assert.ok(offer({ ...body, previousOwnerRole: 'MEMBER' }));
  assert.ok(offer(body)); // legacy default preserves administrator membership
  assert.equal(offer({ ...body, previousOwnerRole: 'PLATFORM_ADMIN' }), false);
  for (const action of ['accept', 'reject', 'cancel']) {
    const op = spec.paths[`/api/v1/tenants/{tenant}/governance/handover/{id}/${action}`].post;
    const ref = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
    const change = schema(ref);
    assert.ok(change({ requestId: 'synthetic', expectedVersion: 1 }));
    assert.equal(change({ requestId: 'synthetic' }), false);
  }
});
test('pending and closed handovers are separate metadata projections without conversation content', () => {
  const check = schema('Snapshot');
  const h = {
    id: 'synthetic',
    fromAccount: 'synthetic',
    toAccount: 'synthetic',
    fromName: '原负责人',
    toName: '接任者',
    previousOwnerRole: 'TENANT_ADMIN',
    status: 'PENDING',
  };
  const body = {
    tenantId: 'synthetic',
    ownerId: 'synthetic',
    ownerName: '原负责人',
    revision: 1,
    owner: true,
    canConfigure: true,
    canEnterManagement: true,
    canAcceptInitialResponsibility: false,
    capabilities: [],
    pendingHandover: h,
    latestHandover: null,
  };
  assert.ok(check(body), JSON.stringify(check.errors));
  assert.ok(check({ ...body, pendingHandover: null, latestHandover: { ...h, status: 'REJECTED' } }));
  assert.equal(check({ ...body, pendingHandover: { ...h, status: 'ACCEPTED' } }), false);
  assert.equal(check({ ...body, pendingHandover: { ...h, conversation: 'private content' } }), false);
});
