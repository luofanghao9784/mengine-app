import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataOperationsClient, isDataOverview, isDataDetail, isDataArchives } from '../src/operations/data-client.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
const counts = { total: 1, ready: 0, processing: 0, attention: 1, notStarted: 0, stopped: 0 };
const detail = {
  kind: 'CONNECTIONS',
  state: 'ALL',
  offset: 0,
  checkedAt: '2026-10-04T10:00:00Z',
  tenantId: tenant,
  tenantName: 'Synthetic company',
  tenantStatus: 'ACTIVE',
  counts,
  hasMore: false,
  items: [
    {
      monitorKey: 'a'.repeat(32),
      format: null,
      sizeBytes: null,
      version: null,
      datasetCount: 2,
      rowCount: 24,
      runId: null,
      stage: 'NOT_STARTED',
      configuration: 'UNAVAILABLE',
      category: 'ATTENTION',
      diagnostic: 'CONNECTION_UNAVAILABLE',
      createdAt: '2026-10-04T09:00:00Z',
      finishedAt: null,
      lastSuccessAt: null,
    },
  ],
};
const overview = {
  kind: 'CONNECTIONS',
  query: '',
  state: 'ALL',
  offset: 0,
  checkedAt: detail.checkedAt,
  matchedTenants: 1,
  counts,
  hasMore: false,
  items: [
    { tenantId: tenant, tenantName: detail.tenantName, tenantStatus: 'ACTIVE', counts, lastSuccessAt: null },
  ],
};
test('data operations reject raw content, duplicate technical keys, mismatched counts and unbounded diagnostic text', () => {
  assert.ok(isDataOverview(overview));
  assert.ok(isDataDetail(detail));
  assert.equal(isDataOverview({ ...overview, counts: { ...counts, total: 2 } }), false);
  assert.equal(isDataOverview({ ...overview, items: [...overview.items, ...overview.items] }), false);
  for (const field of ['filename', 'content', 'routeLabel', 'warnings', 'workspaceId']) {
    assert.equal(isDataDetail({ ...detail, [field]: 'private' }), false);
    assert.equal(isDataDetail({ ...detail, items: [{ ...detail.items[0], [field]: 'private' }] }), false);
  }
  assert.equal(
    isDataDetail({ ...detail, items: [{ ...detail.items[0], diagnostic: 'raw private diagnostic' }] }),
    false,
  );
  assert.equal(isDataDetail({ ...detail, items: [detail.items[0], detail.items[0]] }), false);
  assert.equal(isDataDetail({ ...detail, state: 'READY' }), false);
  assert.equal(isDataDetail({ ...detail, kind: 'MATERIALS' }), false);
});
test('platform data operations bind tenant, category, filters and pagination to each response', async () => {
  const urls: string[] = [];
  const api = createDataOperationsClient((async (input) => {
    urls.push(String(input));
    return Response.json(String(input).includes('/tenants/') ? detail : overview);
  }) as typeof fetch);
  assert.ok(await api.list('CONNECTIONS', '', 'ALL', 0));
  assert.ok(await api.detail(tenant, 'CONNECTIONS', 'ALL', 0));
  assert.ok(urls.every((u) => u.startsWith('/api/platform-admin/v1/')));
  await assert.rejects(api.detail('00000000-0000-4000-8000-000000000002', 'CONNECTIONS', 'ALL', 0), {
    code: 'CONTRACT_MISMATCH',
  });
  await assert.rejects(api.list('MATERIALS', '', 'ALL', 0), { code: 'CONTRACT_MISMATCH' });
  await assert.rejects(api.list('CONNECTIONS', '', 'ALL', 20), { code: 'CONTRACT_MISMATCH' });
  assert.throws(() => api.detail('invalid', 'MATERIALS', 'ALL', 0), { code: 'INVALID_REQUEST' });
});

test('safe object metadata enforces category, format whitelist and integer bounds', () => {
  for (const patch of [{ format: 'secret-filename' }, { rowCount: -1 }, { datasetCount: 1.5 }, { sizeBytes: 2 }])
    assert.equal(isDataDetail({ ...detail, items: [{ ...detail.items[0], ...patch }] }), false);
  const material = { ...detail.items[0], configuration: null, format: 'PDF', sizeBytes: 2048, version: 3, datasetCount: null, rowCount: null };
  assert.ok(isDataDetail({ ...detail, kind: 'MATERIALS', items: [material] }));
  assert.equal(isDataDetail({ ...detail, kind: 'MATERIALS', items: [{ ...material, version: 0 }] }), false);
});

test('global archive projection validates metadata and binds response kind and page', async () => {
  const {tenantId,tenantName,tenantStatus,...base} = detail;
  const archives = {...base,items:[{tenantId,tenantName,tenantStatus,archive:detail.items[0]}]};
  assert.ok(isDataArchives(archives));
  assert.equal(isDataArchives({...archives,items:[{...archives.items[0],filename:'private'}]}),false);
  assert.equal(isDataArchives({...archives,items:[{...archives.items[0],archive:{...detail.items[0],content:'private'}}]}),false);
  assert.equal(isDataArchives({...archives,items:[...archives.items,...archives.items]}),false);
  const api=createDataOperationsClient((async()=>Response.json(archives)) as typeof fetch);
  assert.ok(await api.archives('CONNECTIONS',0));
  await assert.rejects(api.archives('MATERIALS',0),{code:'CONTRACT_MISMATCH'});
  await assert.rejects(api.archives('CONNECTIONS',20),{code:'CONTRACT_MISMATCH'});
});
