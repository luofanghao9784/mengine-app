import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanySourceClient } from '../src/profile/company-source-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const entry = {
  id: tenant,
  versionId: '00000000-0000-4000-8000-000000000002',
  revision: 1,
  field: 'TERM',
  label: '到账',
  meaning: '银行确认',
  origin: 'HUMAN',
  humanProtected: true,
  provenance: '人工调整',
  updatedAt: '2026-10-18T00:00:00Z',
};
const source = {
  tenantId: tenant,
  sourceId: `company-background:${tenant}`,
  type: 'COMPANY_BACKGROUND',
  state: 'AVAILABLE',
  version: 'a'.repeat(64),
  knowledgeIntegration: 'PENDING_INTEGRATION',
  entries: [entry],
};
test('internal source preserves versions and explicit pending integration instead of inventing no references', async () => {
  let requested = '';
  const client = createCompanySourceClient(async (input) => {
    requested = String(input);
    return Response.json(source);
  });
  assert.deepEqual(await client.get(tenant), source);
  assert.equal(requested, `/api/v1/tenants/${tenant}/company-information/source`);
  assert.deepEqual(
    await createCompanySourceClient(async () =>
      Response.json({ ...source, state: 'NO_READABLE_ENTRIES', entries: [] }),
    ).get(tenant),
    { ...source, state: 'NO_READABLE_ENTRIES', entries: [] },
  );
});
test('rejects foreign source, invented integration status and inconsistent or duplicate entries', async () => {
  for (const bad of [
    { ...source, tenantId: entry.versionId },
    { ...source, sourceId: 'other' },
    { ...source, knowledgeIntegration: 'READY' },
    { ...source, entries: [] },
    { ...source, entries: [entry, entry] },
    { ...source, entries: [{ ...entry, revision: 0 }] },
  ]) {
    await assert.rejects(
      createCompanySourceClient(async () => Response.json(bad)).get(tenant),
      (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
});
