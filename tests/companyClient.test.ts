import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanyClient } from '../src/profile/company-client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
test('analysis state preserves disabled and unknown activity without inventing completion', async () => {
  const status = { state: 'DISABLED', pending: 0, running: 0, attention: 0, lastCompletedAt: null };
  assert.deepEqual(await createCompanyClient(async () => Response.json(status)).analysis(id), status);
  for (const wrong of [
    { ...status, state: 'HEALTHY' },
    { ...status, pending: -1 },
    { ...status, lastCompletedAt: 'unknown' },
  ])
    await assert.rejects(
      createCompanyClient(async () => Response.json(wrong)).analysis(id),
      (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
});
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
test('suggestion evidence and choice receipts are validated without converting KEEP into ADOPT', async () => {
  const suggestion = {
    id,
    revision: 1,
    field: 'INDUSTRY',
    targetId: null,
    label: '体育教育',
    meaning: '',
    createdAt: '2026-10-04T00:00:00Z',
    evidence: [{ chunkId: id, versionId: id, filename: '合成资料.txt', locator: '第1段', quote: '体育教育' }],
  };
  assert.deepEqual(await createCompanyClient(async () => Response.json([suggestion])).suggestions(id), [
    suggestion,
  ]);
  await assert.rejects(
    createCompanyClient(async () => Response.json([{ ...suggestion, evidence: [] }])).suggestions(id),
  );
  const body = { requestId: id, expectedRevision: 1, expectedGroupRevision: 3, action: 'KEEP' as const };
  const receipt = { requestId: id, suggestionId: id, action: 'KEEP', revision: 2 };
  const sent: unknown[] = [];
  const api = createCompanyClient(async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return Response.json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    sent.push(JSON.parse(String(init?.body)));
    return Response.json(receipt);
  });
  assert.deepEqual(await api.decide(id, id, body), receipt);
  assert.deepEqual(sent, [body]);
  await assert.rejects(
    createCompanyClient(async (url) =>
      Response.json(
        String(url).endsWith('/csrf')
          ? { token: 'synthetic', headerName: 'X-CSRF-TOKEN' }
          : { ...receipt, action: 'ADOPT' },
      ),
    ).decide(id, id, body),
  );
});
