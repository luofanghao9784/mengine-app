import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationClient, isEvaluation, isAsset } from '../src/evaluation/client.ts';
import {
  createMethodClient,
  isConfiguration,
  isComparison,
  isFamily,
  isSelection,
} from '../src/methods/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = '00000000-0000-4000-8000-000000000001',
  tenant = '00000000-0000-4000-8000-000000000002',
  space = '00000000-0000-4000-8000-000000000003';
const asset = {
  id,
  tenantId: tenant,
  workspaceId: space,
  kind: 'SAMPLE',
  revision: 1,
  status: 'ACTIVE',
  version: {
    id,
    revision: 1,
    content: {
      title: '样例',
      purpose: 'REGRESSION',
      description: '合成资料',
      criteria: [],
      input: '',
      expected: '',
      observed: '',
      unknowns: '',
    },
    evidence: [],
    originKey: 'synthetic:1',
    mode: 'SYNTHETIC',
    createdAt: '2026-10-01T00:00:00Z',
  },
};
const response =
  (value: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(value));
const mismatch = (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH';
test('empty optional sample text is valid but another tenant or version never is', async () => {
  assert(isAsset(asset));
  assert.deepEqual(await createEvaluationClient(response(asset)).asset(tenant, id, 1), asset);
  await assert.rejects(
    createEvaluationClient(response({ ...asset, tenantId: id })).asset(tenant, id),
    mismatch,
  );
  await assert.rejects(
    createEvaluationClient(response({ ...asset, version: { ...asset.version, revision: 2 } })).asset(
      tenant,
      id,
      1,
    ),
    mismatch,
  );
  await assert.rejects(
    createEvaluationClient(response({ items: [asset], hasMore: false, nextOffset: 1 })).assets(
      undefined,
      null,
      'SAMPLE',
    ),
    mismatch,
  );
});
test('evaluation denominators and synthetic business limits cannot be replaced by fake success', () => {
  const run = {
    id,
    tenantId: tenant,
    workspaceId: space,
    standardVersion: id,
    sampleVersions: [space],
    supersedes: null,
    evaluator: id,
    createdAt: '2026-10-01T00:00:00Z',
    validity: 'CURRENT',
    modes: ['SYNTHETIC'],
    uniqueOrigins: 1,
    coverage: [{ dimension: 'RUNTIME', denominator: 1, pass: 0, fail: 0, unknown: 1 }],
    findings: [],
    businessQuality: 'NOT_VALIDATED',
    adoptionDecision: 'NOT_MADE',
  };
  assert(isEvaluation(run));
  assert(!isEvaluation({ ...run, businessQuality: 'PASSED' }));
  assert(!isEvaluation({ ...run, adoptionDecision: 'ADOPTED' }));
  assert(
    !isEvaluation({
      ...run,
      coverage: [{ dimension: 'RUNTIME', denominator: 2, pass: 0, fail: 0, unknown: 1 }],
    }),
  );
});
test('method comparison preserves the real per-case denominator and finite normalized features', () => {
  const c = {
    id,
    candidateVersion: id,
    baselineVersion: null,
    standardVersion: space,
    sampleVersions: [space],
    cases: [
      {
        sampleVersion: space,
        expected: [id],
        baseline: [id],
        candidate: [id],
        baselinePass: true,
        candidatePass: true,
      },
    ],
    denominator: 1,
    baselinePass: 1,
    candidatePass: 1,
    conclusion: 'NO_CHANGE',
    validity: 'CURRENT',
    mode: 'SYNTHETIC',
    businessQuality: 'NOT_VALIDATED',
    createdAt: '2026-10-01T00:00:00Z',
  };
  assert(isComparison(c));
  assert(isComparison({ ...c, validity: 'DETAILS_UNAVAILABLE' }));
  assert(!isComparison({ ...c, validity: 'DETAILS_UNAVAILABLE', denominator: 0 }));
  assert(!isComparison({ ...c, candidatePass: 2 }));
  assert(!isComparison({ ...c, mode: 'LIVE' }));
  for (const n of [NaN, Infinity, -1, 101])
    assert(!isConfiguration({ relevanceWeight: n, recencyWeight: 1, importanceWeight: 0 }));
  assert(!isConfiguration({ relevanceWeight: 0, recencyWeight: 0, importanceWeight: 0 }));
});
test('scope adoption carries current revision and the same request key, with no automatic retry', async () => {
  const seen: { path: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    seen.push({ path: String(path), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'fresh', headerName: 'X-CSRF-TOKEN' }));
    throw new Error('lost receipt');
  };
  await assert.rejects(
    createMethodClient(fetcher).adopt(tenant, space, id, 3, 'STOP', id, false),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1].body, {
    requestId: id,
    workspaceId: space,
    expectedRevision: 3,
    action: 'STOP',
    versionId: id,
    limitationsAccepted: false,
  });
});

test('method history accepts only body-free unavailable metadata and preserves stopped adoption', () => {
  const version = {
    id,
    familyId: tenant,
    number: 1,
    baseVersion: null,
    configuration: null,
    configurationSha: 'historic-hash',
    compatibility: 'ranking-v1',
    rationale: '',
    published: true,
    bodyAvailable: false,
    createdAt: '2026-10-01T00:00:00Z',
  };
  const family = {
    id: tenant,
    kind: 'RANKING_V1',
    title: '排序方法',
    revision: 2,
    headVersion: space,
    publishedVersion: space,
    versions: [version],
  };
  assert(isFamily(family));
  for (const changed of [
    { ...version, rationale: 'erased body' },
    { ...version, configuration: { relevanceWeight: 1, recencyWeight: 0, importanceWeight: 0 } },
    { ...version, bodyAvailable: true },
  ])
    assert(!isFamily({ ...family, versions: [changed] }));
  const selection = {
    canAdopt: true,
    configuration: { relevanceWeight: 1, recencyWeight: 0, importanceWeight: 0 },
    effective: {
      versionId: null,
      workspaceId: null,
      adoptionRevision: 0,
      scope: 'BUILTIN',
      configurationSha: 'default',
    },
    adoptedVersion: version,
    adoption: {
      id: space,
      tenantId: tenant,
      workspaceId: null,
      revision: 2,
      status: 'STOPPED',
      versionId: id,
      history: [],
    },
  };
  assert(isSelection(selection));
  assert(!isSelection({ ...selection, adoption: { ...selection.adoption, status: 'ACTIVE' } }));
});
