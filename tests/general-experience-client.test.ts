import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeneralExperienceClient,
  isGeneralActivity,
  isGeneralVersions,
  isGeneralHistorical,
  isGeneralDetail,
  isGeneralPage,
  isGeneralProcessing,
  generalProcessingLabels,
  isGeneralAvailability,
  isGeneralSuggestion,
  isGeneralSuggestions,
  isGeneralAdjustment,
  isGeneralAdjustments,
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

test('usage mutations use customer CSRF, exact version, revision and unchanged request identity', async () => {
  const calls: { url: string; body: unknown }[] = [];
  let bad = false;
  const api = createGeneralExperienceClient((async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.equal(init?.cache, 'no-store');
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    return Response.json({
      requestId: id,
      entryId: id,
      versionId: version,
      revision: bad ? 2 : 1,
      enabled: false,
    });
  }) as typeof fetch);
  const body = { requestId: id, versionId: version, expectedRevision: 0, enabled: false };
  await api.changeUsage(id, id, body);
  await api.changeUsage(id, id, body);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].url, `/api/v1/tenants/${id}/general-experiences/${id}/usage`);
  bad = true;
  await assert.rejects(api.changeUsage(id, id, body));
  await assert.rejects(api.changeUsage('', id, body));
});

test('platform availability never routes through customer identity and rejects mismatched operation receipts', async () => {
  const calls: { url: string; body: unknown }[] = [];
  let bad = false;
  const api = createGeneralExperienceClient((async (url, init) => {
    if (String(url).endsWith('/csrf')) {
      assert.equal(String(url), '/api/platform-admin/v1/auth/csrf');
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic-platform' });
    }
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic-platform');
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({
      requestId: id,
      entryId: id,
      versionId: bad ? id : version,
      revision: 2,
      status: 'STOPPED',
    });
  }) as typeof fetch);
  const body = {
    requestId: id,
    versionId: version,
    expectedRevision: 1,
    status: 'STOPPED' as const,
    reason: '合成停止原因',
  };
  await api.changeAvailability(id, body);
  await api.changeAvailability(id, body);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].url, `/api/platform-admin/v1/experience-library/${id}/availability`);
  bad = true;
  await assert.rejects(api.changeAvailability(id, body));
  await assert.rejects(api.changeAvailability(id, { ...body, reason: '' }));
  const state = {
    entryId: id,
    versionId: version,
    revision: 1,
    status: 'AVAILABLE',
    reason: null,
    changedAt: detail.updatedAt,
  };
  assert.ok(isGeneralAvailability(state));
  for (const field of ['actorId', 'tenantId', 'sourceId', 'method'])
    assert.equal(isGeneralAvailability({ ...state, [field]: id }), false);
  await assert.rejects(
    createGeneralExperienceClient(async () => Response.json({ ...state, versionId: id })).availability(
      id,
      version,
    ),
  );
});

test('suggestion projections accept only own finite metadata and exact submitted scope', async () => {
  const suggestion = {
    id,
    versionId: version,
    workspaceId: id,
    intent: 'ADAPTATION',
    state: 'WAITING',
    resultEntryId: null,
    resultVersionId: null,
    createdAt: detail.updatedAt,
  };
  assert.ok(isGeneralSuggestion(suggestion));
  for (const key of ['content', 'sourceId', 'actorId', 'candidate'])
    assert.equal(isGeneralSuggestion({ ...suggestion, [key]: 'private' }), false);
  assert.equal(isGeneralSuggestion({ ...suggestion, resultEntryId: id }), false);
  assert.ok(
    isGeneralSuggestions({
      enabled: false,
      canSubmit: true,
      scopes: [{ id, name: '空间' }],
      items: [suggestion],
    }),
  );
  let response = { ...suggestion };
  const calls: string[] = [];
  const api = createGeneralExperienceClient((async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/csrf'))
      return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['X-CSRF-TOKEN'], 'synthetic');
    return Response.json(response);
  }) as typeof fetch);
  const body = {
    requestId: id,
    versionId: version,
    workspaceId: id,
    intent: 'ADAPTATION' as const,
    content: '说明依据',
  };
  assert.equal((await api.suggest(id, id, body)).id, id);
  response = { ...suggestion, versionId: id };
  await assert.rejects(
    api.suggest(id, id, body),
    (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 'CONTRACT_MISMATCH',
  );
  assert.ok(calls.every((p) => !p.includes('platform-admin')));
});

test('platform adjustment metadata rejects private inputs, other realms and unfinished result links', async () => {
  const receipt = {
    id,
    versionId: version,
    state: 'QUEUED',
    resultVersionId: null,
    createdAt: '2026-10-04T00:00:00Z',
  };
  const page = { enabled: false, canSubmit: true, revision: 1, currentVersionId: version, items: [receipt] };
  assert.ok(isGeneralAdjustment(receipt));
  assert.ok(isGeneralAdjustments(page));
  for (const key of ['content', 'actorId', 'tenantId', 'runId'])
    assert.equal(isGeneralAdjustments({ ...page, items: [{ ...receipt, [key]: 'private' }] }), false);
  assert.equal(isGeneralAdjustment({ ...receipt, resultVersionId: id }), false);
  const calls: { url: string; body: unknown }[] = [];
  const api = createGeneralExperienceClient(async (url, options) => {
    const path = String(url);
    if (path.endsWith('/csrf'))
      return new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' }));
    calls.push({ url: path, body: options?.body ? JSON.parse(String(options.body)) : null });
    return new Response(JSON.stringify(options?.method === 'POST' ? receipt : page));
  });
  assert.deepEqual(await api.adjustments(id, version), page);
  assert.deepEqual(
    await api.adjust(id, { requestId: id, versionId: version, expectedRevision: 1, content: '合成调整建议' }),
    receipt,
  );
  assert.ok(calls.every((c) => c.url.startsWith('/api/platform-admin/')));
  assert.equal((calls[1].body as { content: string }).content, '合成调整建议');
});

test('history reads bind realm, entry, current anchor and selected version without permitting extra provenance', async () => {
  const item = { versionId: version, number: 1, createdAt: detail.updatedAt };
  const page = { entryId: id, currentVersionId: id, items: [item], hasMore: false };
  const history = {
    entryId: id,
    currentVersionId: id,
    versionId: version,
    number: 1,
    method,
    createdAt: detail.updatedAt,
  };
  assert.ok(isGeneralVersions(page));
  assert.ok(isGeneralHistorical(history));
  assert.equal(isGeneralVersions({ ...page, items: [item, item] }), false);
  assert.equal(isGeneralVersions({ ...page, items: [{ ...item, number: 0 }] }), false);
  for (const field of ['tenantId', 'sourceId', 'actorId', 'content', 'receipt']) {
    assert.equal(isGeneralVersions({ ...page, items: [{ ...item, [field]: id }] }), false);
    assert.equal(isGeneralHistorical({ ...history, [field]: id }), false);
  }
  let response: unknown = page;
  const calls: string[] = [];
  const api = createGeneralExperienceClient(async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, 'GET');
    assert.equal(options?.cache, 'no-store');
    return Response.json(response);
  });
  await api.versions(undefined, id, id, 20);
  assert.match(calls[0], /platform-admin.*versions\?current=.*&offset=20$/);
  await api.versions(id, id, id, 0);
  assert.match(calls[1], /api\/v1\/tenants/);
  response = history;
  await api.historical(id, id, id, version);
  assert.ok(calls[2].endsWith(`history?current=${id}&version=${version}`));
  response = { ...history, currentVersionId: version };
  await assert.rejects(api.historical(id, id, id, version));
  response = { ...history, versionId: id };
  await assert.rejects(api.historical(undefined, id, id, version));
  response = { ...page, entryId: version };
  await assert.rejects(api.versions(undefined, id, id, 0));
  await assert.rejects(api.versions(undefined, id, id, -1));
});

test('usage aggregates cannot imply business success, include private rows or cross realm scope', async () => {
  const value = {
    entryId: id,
    currentVersionId: id,
    versionId: version,
    scope: 'PLATFORM_AGGREGATE',
    referencedAttempts: 5,
    fullyReadAttempts: 3,
    assessedAttempts: 3,
    adoptedAttempts: 2,
    applicationOutcome: 'UNKNOWN',
    checkedAt: detail.updatedAt,
  };
  assert.ok(isGeneralActivity(value));
  for (const extra of [
    { taskId: id },
    { items: [] },
    { applicationOutcome: 'SUCCESS' },
    { adoptedAttempts: 4 },
    { referencedAttempts: -1 },
  ])
    assert.equal(isGeneralActivity({ ...value, ...extra }), false);
  let response = value;
  const api = createGeneralExperienceClient(async () => Response.json(response));
  await api.activity(undefined, id, id, version);
  await assert.rejects(api.activity(id, id, id, version));
  response = { ...value, scope: 'AUTHORIZED_SHARED_SPACES' };
  await api.activity(id, id, id, version);
  response = { ...response, versionId: id };
  await assert.rejects(api.activity(id, id, id, version));
});
