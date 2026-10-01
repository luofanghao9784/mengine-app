import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/forwarding.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } });
ajv.addSchema(spec, 'forwarding');
const schema = (name) => ajv.getSchema('forwarding#/components/schemas/' + name),
  id = '00000000-0000-4000-8000-000000000001';
test('explicit forwarding is bounded, exact-version and cannot extend permissions or recipients', () => {
  const validate = schema('Send'),
    body = { requestId: id, publicationId: id, materialVersionId: id, recipients: [id], note: '' };
  assert.ok(validate(body));
  for (const patch of [
    { recipients: [] },
    { recipients: Array(21).fill(id) },
    { recipients: [id, id] },
    { canRead: true },
    { sourceTask: id },
    { privateDocument: id },
    { note: 'a'.repeat(501) },
  ])
    assert.equal(validate({ ...body, ...patch }), false);
});
test('accepted is not opened and public schemas contain no private source provenance', () => {
  const recipient = {
    receiptId: id,
    accountId: id,
    name: '同事',
    state: 'ACCEPTED',
    openedAt: null,
    currentlyAccessible: true,
  };
  assert.ok(schema('Recipient')(recipient));
  assert.equal(schema('Recipient')({ ...recipient, state: 'OPENED' }), false);
  assert.equal(schema('Recipient')({ ...recipient, openedAt: '2026-10-01T00:00:00Z' }), false);
  assert.equal(
    Object.keys(spec.components.schemas.Source.properties).some((n) =>
      ['taskId', 'documentId', 'conversationId', 'prompt'].includes(n),
    ),
    false,
  );
});
test('all mutations need CSRF and reads remain scoped', () => {
  assert.equal(Object.keys(spec.paths).length, 5);
  for (const p of Object.values(spec.paths)) {
    if (p.post)
      assert.ok(p.post.parameters.some((v) => v.in === 'header' && v.name === 'X-CSRF-TOKEN' && v.required));
  }
  assert.equal(schema('Open')({ requestId: id, recipientId: id }), false);
});
