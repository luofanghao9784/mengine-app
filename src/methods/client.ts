import type {
  MethodConfiguration,
  MethodFamily,
  MethodComparison,
  MethodSelection,
  MethodVersion,
} from '../../contracts/public-api/methods.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
import { isAsset } from '../evaluation/client.ts';
import type { EvaluationAsset } from '../../contracts/public-api/evaluation.ts';
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min,
  nullable = (v: unknown) => v === null || uuid(v);
export const isConfiguration = (v: unknown): v is MethodConfiguration =>
  record(v) &&
  ['relevanceWeight', 'recencyWeight', 'importanceWeight'].every(
    (k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0 && Number(v[k]) <= 100,
  ) &&
  Number(v.relevanceWeight) + Number(v.recencyWeight) + Number(v.importanceWeight) > 0;
const isVersion = (v: unknown): v is MethodVersion =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.familyId) &&
  integer(v.number, 1) &&
  nullable(v.baseVersion) &&
  typeof v.bodyAvailable === 'boolean' &&
  (v.bodyAvailable
    ? isConfiguration(v.configuration) && text(v.rationale)
    : v.configuration === null && v.rationale === '') &&
  text(v.configurationSha) &&
  v.compatibility === 'ranking-v1' &&
  typeof v.published === 'boolean' &&
  text(v.createdAt);
export const isFamily = (v: unknown): v is MethodFamily =>
  record(v) &&
  uuid(v.id) &&
  v.kind === 'RANKING_V1' &&
  text(v.title) &&
  integer(v.revision, 1) &&
  nullable(v.headVersion) &&
  nullable(v.publishedVersion) &&
  Array.isArray(v.versions) &&
  v.versions.every((x) => isVersion(x) && x.familyId === v.id);
export const isComparison = (v: unknown): v is MethodComparison =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.candidateVersion) &&
  nullable(v.baselineVersion) &&
  uuid(v.standardVersion) &&
  Array.isArray(v.sampleVersions) &&
  v.sampleVersions.every(uuid) &&
  Array.isArray(v.cases) &&
  integer(v.denominator, 1) &&
  v.denominator === v.cases.length &&
  integer(v.baselinePass) &&
  integer(v.candidatePass) &&
  v.baselinePass === v.cases.filter((c) => record(c) && c.baselinePass === true).length &&
  v.candidatePass === v.cases.filter((c) => record(c) && c.candidatePass === true).length &&
  ['CURRENT', 'STALE', 'DETAILS_UNAVAILABLE'].includes(String(v.validity)) &&
  ['IMPROVED_ON_SAMPLES', 'NO_CHANGE', 'REGRESSION', 'TRADEOFF'].includes(String(v.conclusion)) &&
  v.mode === 'SYNTHETIC' &&
  v.businessQuality === 'NOT_VALIDATED' &&
  v.cases.every(
    (c) =>
      record(c) &&
      uuid(c.sampleVersion) &&
      ['expected', 'baseline', 'candidate'].every((k) => Array.isArray(c[k]) && c[k].every(uuid)) &&
      typeof c.baselinePass === 'boolean' &&
      typeof c.candidatePass === 'boolean',
  ) &&
  text(v.createdAt);
export const isSelection = (v: unknown): v is MethodSelection =>
  record(v) &&
  typeof v.canAdopt === 'boolean' &&
  isConfiguration(v.configuration) &&
  record(v.effective) &&
  nullable(v.effective.versionId) &&
  nullable(v.effective.workspaceId) &&
  integer(v.effective.adoptionRevision) &&
  ['BUILTIN', 'TENANT', 'WORKSPACE'].includes(String(v.effective.scope)) &&
  text(v.effective.configurationSha) &&
  (v.adoption === null
    ? v.adoptedVersion === null
    : isVersion(v.adoptedVersion) &&
      record(v.adoption) &&
      v.adoptedVersion.id === v.adoption.versionId &&
      v.adoptedVersion.published &&
      (v.adoption.status !== 'ACTIVE' || v.adoptedVersion.bodyAvailable)) &&
  (v.adoption === null ||
    (record(v.adoption) &&
      uuid(v.adoption.id) &&
      uuid(v.adoption.tenantId) &&
      nullable(v.adoption.workspaceId) &&
      integer(v.adoption.revision, 1) &&
      ['ACTIVE', 'STOPPED'].includes(String(v.adoption.status)) &&
      uuid(v.adoption.versionId) &&
      Array.isArray(v.adoption.history) &&
      v.adoption.history.every(
        (h) =>
          record(h) &&
          integer(h.revision, 1) &&
          ['ADOPT', 'STOP', 'ROLLBACK'].includes(String(h.action)) &&
          uuid(h.versionId) &&
          uuid(h.actor) &&
          text(h.createdAt),
      )));
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createMethodClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    platform = '/api/platform-admin/v1/methods',
    root = (tenant?: string) => (tenant ? `/api/v1/tenants/${id(tenant)}/methods` : platform);
  return {
    families: (tenant?: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: MethodFamily[]; hasMore: boolean } =>
          record(v) && Array.isArray(v.items) && v.items.every(isFamily) && typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    create: (key: string, title: string, configuration: MethodConfiguration, rationale: string) =>
      request(platform, 'POST', isFamily, { requestId: key, title, configuration, rationale }),
    suite: (
      key: string,
      title: string,
      input: {
        items: {
          id: string;
          workspaceId: string;
          relevance: number;
          recency: number;
          importance: number;
          createdAt: string;
        }[];
      },
      expected: { items: string[] },
    ) =>
      request(
        platform + '/sample-suite',
        'POST',
        (v): v is { standard: EvaluationAsset; sample: EvaluationAsset } =>
          record(v) &&
          isAsset(v.standard) &&
          isAsset(v.sample) &&
          v.standard.tenantId === null &&
          v.sample.tenantId === null,
        { requestId: key, title, input, expected },
      ),
    candidate: (family: MethodFamily, key: string, configuration: MethodConfiguration, rationale: string) =>
      request(platform + `/${id(family.id)}/candidates`, 'POST', isFamily, {
        requestId: key,
        expectedRevision: family.revision,
        configuration,
        rationale,
      }),
    compare: (
      key: string,
      candidateVersion: string,
      baselineVersion: string | null,
      standardVersion: string,
      sampleVersions: string[],
    ) =>
      request(platform + '/comparisons', 'POST', isComparison, {
        requestId: key,
        candidateVersion,
        baselineVersion,
        standardVersion,
        sampleVersions,
      }),
    comparisons: (family: string, signal?: AbortSignal) =>
      request(
        platform + `/${id(family)}/comparisons?limit=50`,
        'GET',
        (v): v is { items: MethodComparison[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.every(isComparison) &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
    publish: (family: MethodFamily, key: string, comparison: MethodComparison) =>
      request(platform + `/${id(family.id)}/publish`, 'POST', isFamily, {
        requestId: key,
        expectedRevision: family.revision,
        candidateVersion: comparison.candidateVersion,
        comparisonId: comparison.id,
      }),
    selection: (tenant: string, workspace: string | null, signal?: AbortSignal) =>
      request(
        root(tenant) + `/selection` + (workspace ? `?workspace=${id(workspace)}` : ''),
        'GET',
        (v): v is MethodSelection =>
          isSelection(v) &&
          (v.adoption === null || (v.adoption.tenantId === tenant && v.adoption.workspaceId === workspace)),
        undefined,
        signal,
      ),
    adopt: (
      tenant: string,
      workspace: string | null,
      key: string,
      expectedRevision: number,
      action: 'ADOPT' | 'STOP' | 'ROLLBACK',
      versionId: string,
      limitationsAccepted: boolean,
    ) =>
      request(
        root(tenant) + '/selection',
        'POST',
        (v): v is MethodSelection =>
          isSelection(v) && v.adoption?.tenantId === tenant && v.adoption.workspaceId === workspace,
        { requestId: key, workspaceId: workspace, expectedRevision, action, versionId, limitationsAccepted },
      ),
  };
}
export const methodClient = createMethodClient();
