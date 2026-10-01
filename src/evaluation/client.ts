import type {
  Criterion,
  Evaluation,
  EvaluationAsset,
  EvaluationContent,
  EvaluationIssue,
  EvaluationPage,
  Evidence,
  EvidenceOption,
  EvidenceDetails,
  IssueChange,
  Judgment,
} from '../../contracts/public-api/evaluation.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const dimensions = {
  FACT: '可核对事实',
  CONTENT_QUALITY: '内容质量',
  USER_EFFECT: '用户作用',
  RUNTIME: '运行质量',
} as const;
export const verdicts = { PASS: '符合', FAIL: '不符合', UNKNOWN: '缺少依据' } as const;
export const issueStatuses = {
  OPEN: '待接手',
  IN_PROGRESS: '处理中',
  WAITING: '等待资料或决定',
  REVIEW: '待复核',
  CLOSED: '已结束',
} as const;
export const outcomes = {
  FIXED: '已修复（人工确认）',
  DUPLICATE: '重复事项',
  NOT_REPRODUCIBLE: '暂未复现',
  ACCEPTED_TRADEOFF: '接受当前取舍',
  SUPERSEDED: '已被替代',
} as const;
export const modes = {
  SYNTHETIC: '合成样例',
  NO_MODEL: '无模型执行',
  VERIFICATION: '合成模型验证',
  LIVE: '真实模型',
  UNKNOWN: '模式未知',
} as const;
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
const nullable = (v: unknown) => v === null || uuid(v);
const stamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
export const isEvidence = (v: unknown): v is Evidence =>
  record(v) &&
  ['TASK', 'FEEDBACK', 'MATERIAL_VERSION'].includes(String(v.kind)) &&
  uuid(v.id) &&
  integer(v.revision) &&
  integer(v.attempt);
const criterion = (v: unknown): v is Criterion =>
  record(v) &&
  text(v.key) &&
  Object.hasOwn(dimensions, String(v.dimension)) &&
  ['REQUIRED', 'QUALITY', 'PREFERENCE'].includes(String(v.strength)) &&
  ['EVIDENCE_AVAILABLE', 'TASK_SUCCEEDED', 'SYNTHETIC_EQUALS', 'MANUAL'].includes(String(v.check)) &&
  text(v.requirement);
export const isAsset = (v: unknown): v is EvaluationAsset =>
  record(v) &&
  uuid(v.id) &&
  nullable(v.tenantId) &&
  nullable(v.workspaceId) &&
  ['STANDARD', 'SAMPLE'].includes(String(v.kind)) &&
  integer(v.revision, 1) &&
  ['ACTIVE', 'WITHDRAWN'].includes(String(v.status)) &&
  record(v.version) &&
  uuid(v.version.id) &&
  integer(v.version.revision, 1) &&
  record(v.version.content) &&
  text(v.version.content.title) &&
  ['REGRESSION', 'DEVELOPMENT'].includes(String(v.version.content.purpose)) &&
  ['description', 'input', 'expected', 'observed', 'unknowns'].every(
    (k) => typeof (v.version as { content: Record<string, unknown> }).content[k] === 'string',
  ) &&
  Array.isArray(v.version.content.criteria) &&
  v.version.content.criteria.every(criterion) &&
  Array.isArray(v.version.evidence) &&
  v.version.evidence.every(isEvidence) &&
  text(v.version.originKey) &&
  Object.hasOwn(modes, String(v.version.mode)) &&
  stamp(v.version.createdAt);
export const isEvaluation = (v: unknown): v is Evaluation =>
  record(v) &&
  uuid(v.id) &&
  nullable(v.tenantId) &&
  nullable(v.workspaceId) &&
  uuid(v.standardVersion) &&
  Array.isArray(v.sampleVersions) &&
  v.sampleVersions.every(uuid) &&
  nullable(v.supersedes) &&
  uuid(v.evaluator) &&
  stamp(v.createdAt) &&
  ['CURRENT', 'STALE', 'SUPERSEDED', 'DETAILS_UNAVAILABLE'].includes(String(v.validity)) &&
  v.businessQuality === 'NOT_VALIDATED' &&
  v.adoptionDecision === 'NOT_MADE' &&
  integer(v.uniqueOrigins, 1) &&
  Array.isArray(v.modes) &&
  v.modes.every((m) => Object.hasOwn(modes, String(m))) &&
  Array.isArray(v.coverage) &&
  v.coverage.every(
    (c) =>
      record(c) &&
      Object.hasOwn(dimensions, String(c.dimension)) &&
      ['denominator', 'pass', 'fail', 'unknown'].every((k) => integer(c[k])) &&
      c.denominator === Number(c.pass) + Number(c.fail) + Number(c.unknown),
  ) &&
  Array.isArray(v.findings) &&
  v.findings.every(
    (f) =>
      record(f) &&
      (v.sampleVersions as unknown[]).includes(f.sampleVersion) &&
      text(f.criterion) &&
      Object.hasOwn(dimensions, String(f.dimension)) &&
      Object.hasOwn(verdicts, String(f.verdict)) &&
      ['PROGRAM', 'HUMAN', 'MISSING'].includes(String(f.basis)) &&
      text(f.note),
  );
export const isIssue = (v: unknown): v is EvaluationIssue =>
  record(v) &&
  uuid(v.id) &&
  nullable(v.tenantId) &&
  nullable(v.workspaceId) &&
  uuid(v.sampleVersion) &&
  nullable(v.evaluationId) &&
  text(v.title) &&
  text(v.impact) &&
  text(v.nextAction) &&
  ['DATA', 'CONTENT', 'PREFERENCE', 'TECHNICAL', 'AUTHORIZATION', 'METHOD'].includes(String(v.category)) &&
  integer(v.revision, 1) &&
  Object.hasOwn(issueStatuses, String(v.status)) &&
  nullable(v.assignee) &&
  (v.outcome === null || Object.hasOwn(outcomes, String(v.outcome))) &&
  Array.isArray(v.history) &&
  v.history.every(
    (e) =>
      record(e) &&
      integer(e.revision, 1) &&
      uuid(e.actor) &&
      text(e.note) &&
      Array.isArray(e.evidence) &&
      e.evidence.every(isEvidence) &&
      stamp(e.createdAt),
  );
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createEvaluationClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant?: string) =>
      tenant ? `/api/v1/tenants/${id(tenant)}/evaluation` : '/api/platform-admin/v1/evaluation',
    scope = (workspace: string | null) => (workspace ? `workspace=${id(workspace)}&` : ''),
    bound =
      <T extends { tenantId: string | null; workspaceId: string | null }>(
        check: (v: unknown) => v is T,
        tenant?: string,
        workspace?: string | null,
      ) =>
      (v: unknown): v is T =>
        check(v) &&
        v.tenantId === (tenant ?? null) &&
        (workspace === undefined || v.workspaceId === workspace),
    page =
      <T>(check: (v: unknown) => v is T) =>
      (v: unknown): v is EvaluationPage<T> =>
        record(v) &&
        Array.isArray(v.items) &&
        v.items.every(check) &&
        typeof v.hasMore === 'boolean' &&
        integer(v.nextOffset);
  return {
    details: (tenant: string, workspace: string, e: Evidence, signal?: AbortSignal) =>
      request(
        root(tenant) +
          `/evidence?workspace=${id(workspace)}&kind=${e.kind}&id=${id(e.id)}&revision=${e.revision}&attempt=${e.attempt}`,
        'GET',
        (v): v is EvidenceDetails =>
          record(v) &&
          isEvidence(v.evidence) &&
          v.evidence.id === e.id &&
          v.evidence.kind === e.kind &&
          v.evidence.revision === e.revision &&
          Object.hasOwn(modes, String(v.mode)) &&
          text(v.state) &&
          typeof v.exact === 'boolean' &&
          integer(v.sourceVersions) &&
          ['NOT_RECORDED', 'ATTEMPT_LEDGER'].includes(String(v.resourceCoverage)) &&
          v.costStatus === 'NOT_A_BILL' &&
          Array.isArray(v.attempts) &&
          v.attempts.every(
            (a) =>
              record(a) &&
              integer(a.attempt, 1) &&
              ['live', 'verification'].includes(String(a.mode)) &&
              text(a.status) &&
              typeof a.meteringEnabled === 'boolean' &&
              ['registeredRequests', 'reportedUsage', 'pendingRequests'].every((k) => integer(a[k])) &&
              (a.knownInputTokens === null || integer(a.knownInputTokens)) &&
              (a.knownOutputTokens === null || integer(a.knownOutputTokens)) &&
              stamp(a.startedAt) &&
              (a.finishedAt === null || stamp(a.finishedAt)),
          ),
        undefined,
        signal,
      ),
    scope: (tenant: string | undefined, workspace: string | null, signal?: AbortSignal) =>
      request(
        root(tenant) + `/scope?${scope(workspace)}`,
        'GET',
        (v): v is { tenantId: string | null; workspaceId: string | null; canMaintain: boolean } =>
          record(v) &&
          v.tenantId === (tenant ?? null) &&
          v.workspaceId === workspace &&
          typeof v.canMaintain === 'boolean',
        undefined,
        signal,
      ),
    assets: (
      tenant: string | undefined,
      workspace: string | null,
      kind: 'STANDARD' | 'SAMPLE',
      offset = 0,
      signal?: AbortSignal,
    ) =>
      request(
        root(tenant) + `/assets?${scope(workspace)}kind=${kind}&offset=${offset}&limit=20`,
        'GET',
        page(bound(isAsset, tenant, workspace)),
        undefined,
        signal,
      ),
    asset: (tenant: string | undefined, asset: string, revision?: number, signal?: AbortSignal) =>
      request(
        root(tenant) + `/assets/${id(asset)}` + (revision ? `?revision=${revision}` : ''),
        'GET',
        (v): v is EvaluationAsset =>
          bound(isAsset, tenant)(v) &&
          v.id === asset &&
          (revision === undefined || v.version.revision === revision),
        undefined,
        signal,
      ),
    version: (tenant: string | undefined, version: string, signal?: AbortSignal) =>
      request(
        root(tenant) + `/versions/${id(version)}`,
        'GET',
        (v): v is EvaluationAsset => bound(isAsset, tenant)(v) && v.version.id === version,
        undefined,
        signal,
      ),
    create: (
      tenant: string | undefined,
      workspace: string | null,
      key: string,
      kind: 'STANDARD' | 'SAMPLE',
      content: EvaluationContent,
      evidence: Evidence[],
    ) =>
      request(root(tenant) + '/assets', 'POST', bound(isAsset, tenant, workspace), {
        requestId: key,
        workspaceId: workspace,
        kind,
        content,
        evidence,
      }),
    revise: (
      tenant: string | undefined,
      asset: EvaluationAsset,
      key: string,
      content: EvaluationContent,
      evidence: Evidence[],
      withdraw = false,
    ) =>
      request(root(tenant) + `/assets/${id(asset.id)}`, 'PUT', bound(isAsset, tenant, asset.workspaceId), {
        requestId: key,
        expectedRevision: asset.revision,
        content,
        evidence,
        withdraw,
      }),
    runs: (tenant: string | undefined, workspace: string | null, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `/runs?${scope(workspace)}offset=${offset}&limit=20`,
        'GET',
        page(bound(isEvaluation, tenant, workspace)),
        undefined,
        signal,
      ),
    evaluate: (
      tenant: string | undefined,
      workspace: string | null,
      key: string,
      standard: string,
      samples: string[],
      supersedes: string | null,
      judgments: Judgment[],
    ) =>
      request(root(tenant) + '/runs', 'POST', bound(isEvaluation, tenant, workspace), {
        requestId: key,
        workspaceId: workspace,
        standardVersion: standard,
        sampleVersions: samples,
        supersedes,
        judgments,
      }),
    issues: (tenant: string | undefined, workspace: string | null, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `/issues?${scope(workspace)}offset=${offset}&limit=20`,
        'GET',
        page(bound(isIssue, tenant, workspace)),
        undefined,
        signal,
      ),
    createIssue: (
      tenant: string | undefined,
      workspace: string | null,
      key: string,
      issue: Pick<
        EvaluationIssue,
        'sampleVersion' | 'evaluationId' | 'title' | 'category' | 'impact' | 'nextAction'
      >,
    ) =>
      request(root(tenant) + '/issues', 'POST', bound(isIssue, tenant, workspace), {
        requestId: key,
        workspaceId: workspace,
        issue,
      }),
    changeIssue: (tenant: string | undefined, issue: EvaluationIssue, key: string, change: IssueChange) =>
      request(
        root(tenant) + `/issues/${id(issue.id)}/actions`,
        'POST',
        bound(isIssue, tenant, issue.workspaceId),
        { requestId: key, expectedRevision: issue.revision, change },
      ),
    assignees: (tenant: string | undefined, issue: string, signal?: AbortSignal) =>
      request(
        root(tenant) + `/issues/${id(issue)}/assignees`,
        'GET',
        (v): v is { id: string; name: string }[] =>
          Array.isArray(v) && v.every((a) => record(a) && uuid(a.id) && text(a.name)),
        undefined,
        signal,
      ),
    options: (tenant: string, workspace: string, kind: Evidence['kind'], signal?: AbortSignal) =>
      request(
        root(tenant) + `/evidence-options?workspace=${id(workspace)}&kind=${kind}&limit=50`,
        'GET',
        (v): v is { items: EvidenceOption[]; hasMore: boolean } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.every(
            (e) =>
              record(e) &&
              isEvidence(e.evidence) &&
              e.evidence.kind === kind &&
              text(e.title) &&
              text(e.state) &&
              Object.hasOwn(modes, String(e.mode)),
          ) &&
          typeof v.hasMore === 'boolean',
        undefined,
        signal,
      ),
  };
}
export const evaluationClient = createEvaluationClient();
