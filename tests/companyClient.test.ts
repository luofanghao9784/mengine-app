import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanyClient } from '../src/profile/company-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const page = {
  tenantId: id,
  canMaintain: true,
  groups: ['NAME', 'INDUSTRY', 'BUSINESS', 'TERM'].map((field) => ({
    field,
    revision: 0,
    manuallyCleared: false,
    tags: [],
  })),
};
test('optional company fields remain empty and incomplete or foreign payloads are rejected', async () => {
  assert.deepEqual(await createCompanyClient(async () => Response.json(page)).get(id), page);
  for (const wrong of [
    { ...page, tenantId: '00000000-0000-4000-8000-000000000002' },
    { ...page, groups: page.groups.slice(1) },
    { ...page, groups: page.groups.map(() => page.groups[0]) },
  ])
    await assert.rejects(
      createCompanyClient(async () => Response.json(wrong)).get(id),
      (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});
test('tag changes use current group revision and customer CSRF with exact receipt', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const change = {
    requestId: id,
    field: 'TERM' as const,
    expectedRevision: 3,
    action: 'REMOVE' as const,
    tagId: id,
    label: '',
    meaning: '',
  };
  const result = { requestId: id, field: 'TERM', revision: 4, action: 'REMOVE', tagId: id };
  const api = createCompanyClient(async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : null });
    return Response.json(
      String(url).endsWith('/csrf') ? { token: 'synthetic', headerName: 'X-CSRF-TOKEN' } : result,
    );
  });
  assert.deepEqual(await api.change(id, change), result);
  assert.equal(calls[0].url, '/api/v1/auth/csrf');
  assert.deepEqual(calls[1].body, change);
  await assert.rejects(
    createCompanyClient(async () => Response.json({ ...result, revision: 3 })).change(id, change),
  );
});
