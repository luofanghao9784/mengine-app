import type {
  CreateRetentionCase,
  RetentionCase,
  RetentionCatalogue,
  RetentionCommand,
  RetentionOptions,
  RetentionPage,
  RetentionPolicy,
  RetentionSummary,
  RetentionVersion,
} from '../../contracts/public-api/retention.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const number = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const string = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const date = (v: unknown) => string(v, 50) && Number.isFinite(Date.parse(v));
const states = ['DRAFT', 'ASSESSED', 'CANCELLED'];
const policyKeys = [
  'FORMAL_CONTENT',
  'EXPERIENCE_PUBLISHED',
  'PROFILE_AND_CASES',
  'EXPERIENCE_CANDIDATE',
  'RAW_FEEDBACK',
  'TRIAL_EVALUATION',
  'DIAGNOSTIC_DETAIL',
  'MINIMAL_OPERATION',
  'TRASH',
  'EXPORT_PACKAGE',
  'DERIVED_CACHE',
  'OFFBOARD_ISOLATION',
  'TENANT_EXIT_WINDOW',
];
const checks = [
  'RESPONSIBILITY_HANDOVER',
  'IN_FLIGHT_ACTIONS',
  'EXPORT_AUTHORIZATION',
  'EXPORT_COMPLETENESS',
  'RETENTION_AND_BACKUPS',
];
const list = (v: unknown, max: number, check: (item: unknown) => boolean): v is unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(check);
const space = (v: unknown) => record(v) && uuid(v.id) && string(v.name, 180);
export const isRetentionPolicy = (v: unknown): v is RetentionPolicy =>
  record(v) &&
  record(v.definition) &&
  one(v.definition.key, policyKeys) &&
  string(v.definition.label, 100) &&
  (v.definition.defaultDays === null || number(v.definition.defaultDays, 1, 3650)) &&
  string(v.definition.anchor, 50) &&
  one(v.definition.currentEnforcement, [
    'NO_AUTOMATIC_EXPIRY',
    'NOT_CONNECTED',
    'MATERIAL_FIXED_30_DAYS',
    'EXPORT_SELECTED_1_3_7_DAYS',
    'MATERIAL_DEPENDENCY_GUARD',
    'MATERIAL_POLICY_WINDOW',
    'EXPORT_POLICY_WINDOW',
    'CLOSED_TASK_NOTIFICATIONS',
    'OBJECT_POLICY_WINDOW',
    'EVALUATION_DETAIL_WINDOW',
    'PLATFORM_LOG_WINDOW',
    'OBJECT_AND_MATERIAL_WINDOW',
    'DEPENDENCY_CHAIN_GUARD',
    'DEPARTURE_FIXED_WINDOW',
  ]) &&
  typeof v.definition.configurable === 'boolean' &&
  string(v.definition.remainingAdapter, 300) &&
  number(v.revision) &&
  (v.definition.configurable
    ? number(v.configuredDays, 1, 3650)
    : v.configuredDays === v.definition.defaultDays) &&
  (v.revision === 0
    ? v.changedBy === null && v.effectiveAt === null && v.reason === null
    : uuid(v.changedBy) && date(v.effectiveAt) && string(v.reason, 500)) &&
  one(v.application, [
    'FUTURE_RECORDS_ONLY_ADAPTER_REQUIRED',
    'FUTURE_RECORDS_ONLY',
    'PLATFORM_FIXED_POLICY',
  ]);
const summary = (v: unknown): v is RetentionSummary =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  one(v.kind, ['MEMBER_OFFBOARD', 'TENANT_EXIT']) &&
  (v.kind === 'MEMBER_OFFBOARD' ? uuid(v.targetAccountId) : v.targetAccountId === null) &&
  string(v.label, 100) &&
  one(v.state, states) &&
  number(v.revision, 1) &&
  date(v.createdAt) &&
  date(v.changedAt);
const queue = (v: unknown) =>
  record(v) &&
  uuid(v.id) &&
  one(v.state, ['QUEUED', 'CLEANING', 'FAILED', 'COMPLETE']) &&
  number(v.attempts) &&
  (v.errorCode === null || string(v.errorCode, 80)) &&
  date(v.createdAt) &&
  (v.completedAt === null || date(v.completedAt)) &&
  (v.state !== 'COMPLETE' || date(v.completedAt)) &&
  v.backupState === 'NOT_COVERED_BY_ONLINE_CLEANUP';
export const isRetentionCase = (v: unknown): v is RetentionCase =>
  record(v) &&
  summary(v.summary) &&
  (v.targetName === null || string(v.targetName, 180)) &&
  (v.targetStatus === null || one(v.targetStatus, ['ACTIVE', 'DISABLED'])) &&
  number(v.acceptedRevision, 1, v.summary.revision) &&
  one(v.versionState, states) &&
  list(v.selectedScopes, 50, space) &&
  number(v.restrictedScopeCount, 0, 50) &&
  v.selectedScopes.length + v.restrictedScopeCount <= 50 &&
  list(v.checkDefinitions, 5, (c) => record(c) && one(c.key, checks) && string(c.label, 200)) &&
  v.checkDefinitions.length === 5 &&
  new Set(v.checkDefinitions.map((c) => (c as { key: string }).key)).size === 5 &&
  list(
    v.checklist,
    5,
    (c) => record(c) && one(c.key, checks) && one(c.status, ['UNCONFIRMED', 'CONFIRMED', 'NOT_APPLICABLE']),
  ) &&
  v.checklist.length === 5 &&
  new Set(v.checklist.map((c) => (c as { key: string }).key)).size === 5 &&
  v.executionState === 'PREPARATION_ONLY' &&
  (v.assessment === null
    ? v.versionState !== 'ASSESSED'
    : record(v.assessment) &&
      v.versionState === 'ASSESSED' &&
      date(v.assessment.assessedAt) &&
      v.assessment.scopeCoverage === 'SELECTED_AUTHORIZED_SHARED_SCOPES' &&
      v.assessment.completeMigration === false &&
      v.assessment.executionEnabled === false &&
      list(v.assessment.blockers, 30, (b) => string(b, 80)) &&
      (v.assessment.blockers.includes('EXECUTION_NOT_CONNECTED') ||
        v.assessment.blockers.includes('EXPLICIT_EXECUTION_REQUIRED')) &&
      number(v.assessment.restrictedScopeCount, 0, 50) &&
      list(v.assessment.exclusions, 10, (e) => string(e, 500)) &&
      record(v.assessment.policyRevisions) &&
      Object.entries(v.assessment.policyRevisions).every(([k, n]) => policyKeys.includes(k) && number(n)) &&
      list(
        v.assessment.scopes,
        50,
        (s) =>
          record(s) &&
          uuid(s.workspaceId) &&
          (v.selectedScopes as unknown[]).some((p) => record(p) && p.id === s.workspaceId) &&
          string(s.name, 180) &&
          list(
            s.groups,
            10,
            (g) =>
              record(g) &&
              string(g.key, 60) &&
              string(g.label, 100) &&
              (g.count === null || number(g.count)) &&
              one(g.exportSupport, [
                'SINGLE_ITEM_DOWNLOAD',
                'EXISTING_RESULT_BATCH',
                'BULK_CAPABILITY_REQUIRED',
                'NOT_IMPLEMENTED',
                'EXIT_INVENTORY_AFTER_START',
                'NOT_INCLUDED',
              ]) &&
              string(g.scopeNote, 500),
          ) &&
          (s.unfinishedTasks === null || number(s.unfinishedTasks)) &&
          (s.activePlans === null || number(s.activePlans)) &&
          list(s.cleanup, 10, queue) &&
          typeof s.cleanupHasMore === 'boolean',
      ));
const messages: Record<string, string> = {
  RETENTION_REVISION_CONFLICT: '此记录已有新版本，请刷新后重新核对。',
  RETENTION_CASE_NOT_FOUND: '找不到这份准备记录，或当前已无权限。',
  RETENTION_CASE_CLOSED: '此准备记录已取消，请新建记录。',
  RETENTION_SHARED_SCOPE_REQUIRED: '退出范围只能明确选择当前可读的共享空间。',
  RETENTION_VERSION_NOT_FOUND: '找不到指定历史版本。',
};
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createRetentionClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (t: string) => `/api/v1/tenants/${id(t)}/retention`;
  const send: typeof request = async (...args) => {
    try {
      return await request(...args);
    } catch (e) {
      if (e instanceof IdentityError && messages[e.code]) e.message = messages[e.code];
      throw e;
    }
  };
  const page =
    <T>(guard: (v: unknown) => v is T) =>
    (v: unknown): v is RetentionPage<T> =>
      record(v) && typeof v.hasMore === 'boolean' && list(v.items, 20, guard);
  const scoped =
    (t: string, c?: string, rev?: number) =>
    (v: unknown): v is RetentionCase =>
      isRetentionCase(v) &&
      v.summary.tenantId === t &&
      (!c || v.summary.id === c) &&
      (!rev || v.acceptedRevision === rev);
  return {
    catalogue(t: string, signal?: AbortSignal) {
      return send(
        root(t) + '/policies',
        'GET',
        (v): v is RetentionCatalogue =>
          record(v) &&
          list(v.items, 13, isRetentionPolicy) &&
          v.items.length === 13 &&
          new Set(v.items.map((p) => (p as RetentionPolicy).definition.key)).size === 13 &&
          typeof v.canConfigure === 'boolean' &&
          typeof v.canOffboard === 'boolean' &&
          typeof v.canExit === 'boolean',
        undefined,
        signal,
      );
    },
    configure(
      t: string,
      k: string,
      body: { requestId: string; expectedRevision: number; days: number; reason: string },
    ) {
      return send(
        root(t) + '/policies/' + encodeURIComponent(k),
        'POST',
        (v): v is RetentionPolicy =>
          isRetentionPolicy(v) &&
          v.definition.key === k &&
          v.revision === body.expectedRevision + 1 &&
          v.configuredDays === body.days,
        body,
      );
    },
    policyHistory(t: string, k: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + `/policies/${encodeURIComponent(k)}/history?offset=${offset}&limit=20`,
        'GET',
        page((v): v is RetentionPolicy => isRetentionPolicy(v) && v.definition.key === k),
        undefined,
        signal,
      );
    },
    options(
      t: string,
      kind: 'MEMBER_OFFBOARD' | 'TENANT_EXIT',
      memberOffset = 0,
      spaceOffset = 0,
      signal?: AbortSignal,
    ) {
      return send(
        root(t) + `/options?kind=${kind}&memberOffset=${memberOffset}&spaceOffset=${spaceOffset}&limit=20`,
        'GET',
        (v): v is RetentionOptions =>
          record(v) &&
          list(
            v.members,
            20,
            (m) => record(m) && uuid(m.id) && string(m.name, 180) && one(m.status, ['ACTIVE', 'DISABLED']),
          ) &&
          typeof v.hasMore === 'boolean' &&
          list(v.spaces, 20, space) &&
          typeof v.spacesHaveMore === 'boolean',
        undefined,
        signal,
      );
    },
    list(t: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + `/cases?offset=${offset}&limit=20`,
        'GET',
        page((v): v is RetentionSummary => summary(v) && v.tenantId === t),
        undefined,
        signal,
      );
    },
    get(t: string, c: string, revision?: number, signal?: AbortSignal) {
      return send(
        root(t) + '/cases/' + id(c) + (revision ? `?revision=${revision}` : ''),
        'GET',
        scoped(t, c, revision),
        undefined,
        signal,
      );
    },
    history(t: string, c: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + `/cases/${id(c)}/history?offset=${offset}&limit=20`,
        'GET',
        page(
          (v): v is RetentionVersion =>
            record(v) &&
            number(v.revision, 1) &&
            one(v.state, states) &&
            one(v.action, ['CREATED', 'CHECK', 'ASSESS', 'CANCEL']) &&
            uuid(v.changedBy) &&
            date(v.createdAt) &&
            typeof v.hasAssessment === 'boolean',
        ),
        undefined,
        signal,
      );
    },
    create(t: string, body: CreateRetentionCase) {
      return send(
        root(t) + '/cases',
        'POST',
        (v): v is RetentionCase =>
          scoped(t)(v) && v.summary.kind === body.kind && v.summary.targetAccountId === body.targetAccountId,
        body,
      );
    },
    command(t: string, c: string, body: RetentionCommand) {
      return send(root(t) + '/cases/' + id(c), 'POST', scoped(t, c), body);
    },
  };
}
export const retentionClient = createRetentionClient();
