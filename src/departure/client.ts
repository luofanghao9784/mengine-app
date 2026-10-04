import type { DepartureBusinessStatus } from '../../contracts/public-api/departure.ts';
import type {
  DepartureSummary,
  DepartureView,
  DepartureOptions,
  DeparturePage,
  HandoverReceipt,
  OffboardInput,
  ExitInput,
  DepartureCommand,
  ExitInventory,
  ExitPart,
  ExitCleanupReceipt,
  SharedResponsibility,
} from '../../contracts/public-api/departure.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const str = (v: unknown, max = 1000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const date = (v: unknown) => str(v, 50) && Number.isFinite(Date.parse(v));
const nullable = (v: unknown, guard: (v: unknown) => boolean) => v === null || guard(v);
const list = (v: unknown, max: number, guard: (v: unknown) => boolean): v is unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(guard);
const states = [
  'ISOLATING',
  'ISOLATED',
  'EXPORT_WINDOW',
  'RESTORING',
  'CLEANING',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
];
export const isDepartureSummary = (v: unknown): v is DepartureSummary =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  one(v.kind, ['MEMBER_OFFBOARD', 'TENANT_EXIT']) &&
  (v.kind === 'MEMBER_OFFBOARD' ? uuid(v.targetAccountId) : v.targetAccountId === null) &&
  one(v.state, states) &&
  num(v.revision, 1) &&
  date(v.effectiveAt) &&
  date(v.deadline) &&
  Date.parse(v.deadline as string) > Date.parse(v.effectiveAt as string) &&
  nullable(v.completedAt, date) &&
  nullable(v.errorCode, (x) => str(x, 80)) &&
  (v.state !== 'COMPLETE' || date(v.completedAt));
export const isDepartureView = (v: unknown): v is DepartureView =>
  record(v) &&
  isDepartureSummary(v.execution) &&
  nullable(v.targetName, (x) => str(x, 180)) &&
  str(v.reason, 500) &&
  one(v.policyKey, ['OFFBOARD_ISOLATION', 'TENANT_EXIT_WINDOW']) &&
  num(v.policyRevision) &&
  [
    'stopComplete',
    'isolationComplete',
    'materialsComplete',
    'objectsComplete',
    'canCancel',
    'canRetry',
  ].every((k) => typeof v[k] === 'boolean') &&
  nullable(v.cancelledAt, date) &&
  num(v.workerAttempts) &&
  v.backupState === 'PENDING_VERIFICATION' &&
  list(
    v.exportGrants,
    200,
    (x) =>
      record(x) && uuid(x.accountId) && uuid(x.workspaceId) && nullable(x.workspaceName, (n) => str(n, 180)),
  ) &&
  nullable(
    v.materialProgress,
    (x) =>
      record(x) &&
      ['discovered', 'isolated', 'queued', 'purged', 'failed', 'remaining'].every((k) => num(x[k])) &&
      typeof x.discoveryComplete === 'boolean' &&
      typeof x.complete === 'boolean',
  ) &&
  list(v.coverage, 20, (x) => str(x, 500));
export const isDepartureOptions = (v: unknown): v is DepartureOptions =>
  record(v) &&
  num(v.tenantRevision) &&
  list(
    v.members,
    20,
    (x) =>
      record(x) && uuid(x.id) && str(x.name, 180) && one(x.status, ['ACTIVE', 'DISABLED']) && num(x.revision),
  ) &&
  list(
    v.responsibilities,
    20,
    (x) =>
      record(x) &&
      one(x.kind, ['WORKSPACE_OWNER', 'SOURCE_CONTACT']) &&
      uuid(x.workspaceId) &&
      str(x.workspaceName, 180) &&
      uuid(x.objectId) &&
      str(x.name, 180) &&
      uuid(x.responsibleId) &&
      num(x.revision),
  ) &&
  (v.selectedMember === undefined ||
    nullable(
      v.selectedMember,
      (x) =>
        record(x) &&
        uuid(x.id) &&
        str(x.name, 180) &&
        one(x.status, ['ACTIVE', 'DISABLED']) &&
        num(x.revision),
    )) &&
  (v.selectedOwner === undefined || typeof v.selectedOwner === 'boolean') &&
  (v.currentExecutionId === undefined || nullable(v.currentExecutionId, uuid)) &&
  (v.isolationDays === undefined || num(v.isolationDays, 1, 365)) &&
  ['membersHaveMore', 'responsibilitiesHaveMore', 'canOffboard', 'canExit'].every(
    (k) => typeof v[k] === 'boolean',
  );
export const isExitInventory = (v: unknown): v is ExitInventory =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.executionId) &&
  uuid(v.workspaceId) &&
  typeof v.includeHistory === 'boolean' &&
  one(v.state, ['READY', 'EXPIRED', 'REVOKED']) &&
  num(v.revision, 1) &&
  ['itemCount', 'pending', 'included', 'failed'].every((k) => num(v[k])) &&
  Number(v.itemCount) === Number(v.pending) + Number(v.included) + Number(v.failed) &&
  typeof v.selectedScopeComplete === 'boolean' &&
  (!v.selectedScopeComplete || (Number(v.itemCount) > 0 && v.pending === 0 && v.failed === 0)) &&
  v.fullTenantMigration === false &&
  date(v.createdAt) &&
  list(v.coverage, 20, (x) => str(x, 500));
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const partStates = ['QUEUED', 'GENERATING', 'READY', 'PARTIAL', 'FAILED', 'EXPIRED', 'REVOKED', 'REMOVED'];
const cleanupStates = ['NONE', 'PENDING', 'FAILED', 'COMPLETE'];
export const isExitPart = (v: unknown): v is ExitPart =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.setId) &&
  num(v.number, 1) &&
  one(v.state, partStates) &&
  num(v.revision, 1) &&
  num(v.requestedCount, 1, 50) &&
  num(v.bytes, 0, 41943040) &&
  nullable(v.sha256, hash) &&
  nullable(v.generatedAt, date) &&
  nullable(v.expiresAt, date) &&
  nullable(v.errorCode, (x) => str(x, 80)) &&
  one(v.cleanupState, cleanupStates) &&
  nullable(v.cleanedAt, date) &&
  num(v.removedBytes) &&
  typeof v.canDownload === 'boolean' &&
  list(
    v.items,
    50,
    (x) =>
      record(x) &&
      num(x.ordinal, 1) &&
      one(x.kind, ['MATERIAL_VERSION', 'EXPERIENCE_VERSION', 'DATASET_SNAPSHOT']) &&
      uuid(x.objectId) &&
      uuid(x.versionId) &&
      num(x.version, 1) &&
      one(x.state, ['PENDING', 'INCLUDED', 'FAILED']) &&
      nullable(x.filename, (n) => str(n, 250)) &&
      nullable(x.sha256, hash) &&
      nullable(x.errorCode, (c) => str(c, 80)) &&
      (x.errorCode !== 'DEPARTURE_EXPORT_ITEM_UNAVAILABLE' || (x.filename === null && x.sha256 === null)),
  ) &&
  v.items.length === v.requestedCount &&
  (!v.canDownload ||
    (one(v.state, ['READY', 'PARTIAL']) &&
      v.cleanupState === 'NONE' &&
      date(v.generatedAt) &&
      date(v.expiresAt) &&
      hash(v.sha256) &&
      Number(v.bytes) > 0 &&
      v.items.some((x) => record(x) && x.state === 'INCLUDED')));
export const isExitCleanup = (v: unknown): v is ExitCleanupReceipt =>
  record(v) &&
  uuid(v.partId) &&
  one(v.state, partStates) &&
  one(v.cleanupState, cleanupStates) &&
  num(v.attempts) &&
  nullable(v.completedAt, date) &&
  num(v.removedBytes) &&
  v.backupState === 'PENDING_VERIFICATION' &&
  (v.cleanupState !== 'COMPLETE' || date(v.completedAt));
export const isBusinessStatus = (v: unknown): v is DepartureBusinessStatus =>
  record(v) &&
  uuid(v.tenantId) &&
  typeof v.businessEnabled === 'boolean' &&
  typeof v.canExport === 'boolean' &&
  (v.exitState === null
    ? v.exportDeadline === null && !v.canExport
    : one(v.exitState, states) && date(v.exportDeadline) && v.businessEnabled === false) &&
  (!v.canExport || v.exitState === 'EXPORT_WINDOW');
const page =
  <T>(guard: (v: unknown) => v is T) =>
  (v: unknown): v is DeparturePage<T> =>
    record(v) && typeof v.hasMore === 'boolean' && list(v.items, 20, guard);
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createDepartureClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (t: string) => `/api/v1/tenants/${id(t)}/departures`,
    exports = (t: string) => `/api/v1/tenants/${id(t)}/departure-exports`;
  const scoped =
    (t: string, i?: string) =>
    (v: unknown): v is DepartureView =>
      isDepartureView(v) && v.execution.tenantId === t && (!i || v.execution.id === i);
  return {
    businessStatus: (t: string, platform = false, signal?: AbortSignal) =>
      request(
        platform ? `/api/v1/platform/tenants/${id(t)}/departure-status` : root(t) + '/business-status',
        'GET',
        (v): v is DepartureBusinessStatus =>
          isBusinessStatus(v) && v.tenantId === t && (!platform || v.canExport === false),
        undefined,
        signal,
      ),
    list: (t: string, offset = 0, signal?: AbortSignal, kind?: 'MEMBER_OFFBOARD' | 'TENANT_EXIT') =>
      request(
        root(t) + `?offset=${offset}&limit=20${kind ? `&kind=${kind}` : ''}`,
        'GET',
        page(
          (v): v is DepartureSummary =>
            isDepartureSummary(v) && v.tenantId === t && (!kind || v.kind === kind),
        ),
        undefined,
        signal,
      ),
    get: (t: string, i: string, signal?: AbortSignal) =>
      request(root(t) + '/' + id(i), 'GET', scoped(t, i), undefined, signal),
    options: (
      t: string,
      target: string | undefined,
      memberOffset = 0,
      responsibilityOffset = 0,
      signal?: AbortSignal,
    ) =>
      request(
        root(t) +
          `/options?memberOffset=${memberOffset}&responsibilityOffset=${responsibilityOffset}&limit=20` +
          (target ? `&targetAccountId=${id(target)}` : ''),
        'GET',
        (v): v is DepartureOptions => isDepartureOptions(v) && (!target || v.selectedMember?.id === target),
        undefined,
        signal,
      ),
    exportScopes: (t: string, offset = 0, signal?: AbortSignal, exporter?: string) =>
      request(
        root(t) +
          `/export-scopes?offset=${offset}&limit=20` +
          (exporter ? `&exporterAccountId=${id(exporter)}` : ''),
        'GET',
        (v): v is { workspaceId: string; name: string }[] =>
          list(v, 20, (x) => record(x) && uuid(x.workspaceId) && str(x.name, 180)),
        undefined,
        signal,
      ),
    successors: (t: string, w: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(t) + `/successors?workspaceId=${id(w)}&offset=${offset}&limit=20`,
        'GET',
        (v): v is { id: string; name: string }[] =>
          list(v, 20, (x) => record(x) && uuid(x.id) && str(x.name, 180)),
        undefined,
        signal,
      ),
    handover: (
      t: string,
      b: {
        requestId: string;
        kind: SharedResponsibility['kind'];
        workspaceId: string;
        objectId: string;
        fromAccountId: string;
        toAccountId: string;
        expectedRevision: number;
      },
    ) =>
      request(
        root(t) + '/handovers',
        'POST',
        (v): v is HandoverReceipt =>
          record(v) &&
          uuid(v.id) &&
          v.kind === b.kind &&
          v.workspaceId === b.workspaceId &&
          v.objectId === b.objectId &&
          v.fromAccountId === b.fromAccountId &&
          v.toAccountId === b.toAccountId &&
          num(v.resultingRevision, b.expectedRevision + 1, b.expectedRevision + 1) &&
          date(v.createdAt),
        b,
      ),
    offboard: (t: string, b: OffboardInput) =>
      request(
        root(t) + '/offboard',
        'POST',
        (v): v is DepartureView =>
          scoped(t)(v) &&
          v.execution.kind === 'MEMBER_OFFBOARD' &&
          v.execution.targetAccountId === b.targetAccountId,
        b,
      ),
    exit: (t: string, b: ExitInput) =>
      request(
        root(t) + '/exit',
        'POST',
        (v): v is DepartureView => scoped(t)(v) && v.execution.kind === 'TENANT_EXIT',
        b,
      ),
    command: (t: string, i: string, b: DepartureCommand) =>
      request(root(t) + '/' + id(i), 'POST', scoped(t, i), b),
    inventories: (t: string, e: string, offset = 0, signal?: AbortSignal) =>
      request(
        exports(t) + `?executionId=${id(e)}&offset=${offset}&limit=20`,
        'GET',
        page((v): v is ExitInventory => isExitInventory(v) && v.executionId === e),
        undefined,
        signal,
      ),
    createInventory: (
      t: string,
      b: { requestId: string; executionId: string; workspaceId: string; includeHistory: boolean },
    ) =>
      request(
        exports(t),
        'POST',
        (v): v is ExitInventory =>
          isExitInventory(v) &&
          v.executionId === b.executionId &&
          v.workspaceId === b.workspaceId &&
          v.includeHistory === b.includeHistory,
        b,
      ),
    inventory: (t: string, i: string, signal?: AbortSignal) =>
      request(
        exports(t) + '/' + id(i),
        'GET',
        (v): v is ExitInventory => isExitInventory(v) && v.id === i,
        undefined,
        signal,
      ),
    parts: (t: string, i: string, offset = 0, signal?: AbortSignal) =>
      request(
        exports(t) + `/${id(i)}/parts?offset=${offset}&limit=20`,
        'GET',
        page((v): v is ExitPart => isExitPart(v) && v.setId === i),
        undefined,
        signal,
      ),
    next: (t: string, i: string, requestId: string) =>
      request(exports(t) + `/${id(i)}/parts`, 'POST', (v): v is ExitPart => isExitPart(v) && v.setId === i, {
        requestId,
      }),
    part: (t: string, i: string, signal?: AbortSignal) =>
      request(
        exports(t) + '/parts/' + id(i),
        'GET',
        (v): v is ExitPart => isExitPart(v) && v.id === i,
        undefined,
        signal,
      ),
    partCommand: (
      t: string,
      i: string,
      b: { requestId: string; expectedRevision: number; action: 'RETRY' | 'REMOVE' },
    ) =>
      request(exports(t) + '/parts/' + id(i), 'POST', (v): v is ExitPart => isExitPart(v) && v.id === i, b),
    receipts: (t: string, e: string, offset = 0, signal?: AbortSignal) =>
      request(
        exports(t) + `/cleanup?executionId=${id(e)}&offset=${offset}&limit=20`,
        'GET',
        page(isExitCleanup),
        undefined,
        signal,
      ),
    receipt: (t: string, i: string, signal?: AbortSignal) =>
      request(
        exports(t) + `/parts/${id(i)}/cleanup`,
        'GET',
        (v): v is ExitCleanupReceipt => isExitCleanup(v) && v.partId === i,
        undefined,
        signal,
      ),
    downloadUrl: (t: string, i: string) => exports(t) + `/parts/${id(i)}/download`,
  };
}
export const departureClient = createDepartureClient();
