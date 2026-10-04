import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneralExperienceClient,
  isGeneralDetail,
  isGeneralPage,
  isGeneralProcessing,
  generalProcessingLabels,
} from '../src/experience/general-client.ts';
const id = '00000000-0000-4000-8000-000000000001',
  version = '00000000-0000-4000-8000-000000000002';
const method = {
  title: '检查工具',
  summary: '核对真实回执',
  steps: ['读取回执'],
  applicable: ['有回执'],
  excluded: ['无回执'],
  tags: ['核对'],
  basis: 'OBSERVED_EXECUTION',
};
const detail = {
  id,
  versionId: version,
  number: 1,
  status: 'AVAILABLE',
  method,
  updatedAt: '2026-10-04T00:00:00Z',
};
test('public validators reject extra provenance at every level and unsupported evidence claims', () => {
  assert.ok(isGeneralDetail(detail));
  for (const field of ['tenantId', 'sourceId', 'evidence', 'actorId', 'runId']) {
    assert.equal(isGeneralDetail({ ...detail, [field]: id }), false);
    assert.equal(isGeneralDetail({ ...detail, method: { ...method, [field]: id } }), false);
  }
  assert.equal(isGeneralDetail({ ...detail, method: { ...method, basis: 'PROVEN_SUCCESS' } }), false);
  const { method: _, ...base } = detail;
  const row = { ...base, title: method.title, summary: method.summary, tags: method.tags };
  assert.ok(isGeneralPage({ items: [row], hasMore: false }));
  assert.equal(isGeneralPage({ items: [{ ...row, steps: ['private'] }], hasMore: false }), false);
});
test('aggregate observer never accepts source rows, invalid totals or raw errors', () => {
  const value = {
    enabled: false,
    counts: Object.fromEntries(Object.keys(generalProcessingLabels).map((k) => [k, 0])),
    available: 0,
    stopped: 0,
    withdrawn: 0,
    checkedAt: detail.updatedAt,
  };
  assert.ok(isGeneralProcessing(value));
  for (const field of ['items', 'reason', 'tenantId', 'method'])
    assert.equal(isGeneralProcessing({ ...value, [field]: [] }), false);
  assert.equal(isGeneralProcessing({ ...value, counts: { ...value.counts, WAITING: -1 } }), false);
  assert.equal(isGeneralProcessing({ ...value, available: 1.2 }), false);
});
test('realm and fixed version are explicit; customer does not accept stopped or substituted versions', async () => {
  let response = { ...detail };
  const calls: string[] = [];
  const api = createGeneralExperienceClient((async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    return Response.json(response);
  }) as typeof fetch);
  await api.detail(undefined, id, version);
  await api.detail(id, id, version);
  assert.match(calls[0], /^\/api\/platform-admin\/v1\/experience-library\//);
  assert.match(calls[1], new RegExp(`/api/v1/tenants/${id}/general-experiences/`));
  assert.ok(calls.every((c) => c.endsWith(`?version=${version}`)));
  response = { ...detail, versionId: id };
  await assert.rejects(api.detail(undefined, id, version));
  response = { ...detail, status: 'STOPPED' };
  await assert.rejects(api.detail(id, id, version));
  await api.detail(undefined, id, version);
  await assert.rejects(api.detail('', id, version));
});
test('search is encoded, paginated and never routed through the other realm', async () => {
  let called = '';
  const api = createGeneralExperienceClient((async (url) => {
    called = String(url);
    return Response.json({ items: [], hasMore: false });
  }) as typeof fetch);
  await api.contents(id, '销售 & 核对', 'AVAILABLE', 20);
  const url = new URL(called, 'http://fixture');
  assert.equal(url.searchParams.get('query'), '销售 & 核对');
  assert.equal(url.searchParams.get('offset'), '20');
  assert.ok(url.pathname.includes('/general-experiences'));
});
