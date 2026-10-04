import type {
  ExperienceContent,
  ExperienceEntry,
  ExperienceEvidence,
  ExperienceEvent,
  ExperienceFeedback,
  ExperiencePage,
  ExperienceSummary,
  ExperienceUse,
  ExperienceUseInput,
  ExperienceVersion,
} from '../../contracts/public-api/experience.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const str = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' && v.length <= max && (empty || v.length > 0);
const num = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const date = (v: unknown): v is string => str(v, 50) && Number.isFinite(Date.parse(v));
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
export const isContent = (v: unknown): v is ExperienceContent =>
  record(v) &&
  one(v.kind, ['METHOD', 'CASE', 'CORRECTION', 'ASSET']) &&
  str(v.title, 160) &&
  str(v.summary, 600) &&
  str(v.body, 16000) &&
  Array.isArray(v.tags) &&
  v.tags.length <= 20 &&
  v.tags.every((t) => str(t, 40)) &&
  new Set(v.tags).size === v.tags.length &&
  str(v.applicable, 2000) &&
  str(v.excluded, 2000, true) &&
  str(v.dependencies, 2000, true) &&
  str(v.basis, 2000) &&
  one(v.accessMode, ['SOURCE_BOUND', 'INDEPENDENT_COPY']);
export const isEvidence = (v: unknown): v is ExperienceEvidence =>
  record(v) && one(v.kind, ['MATERIAL_VERSION', 'TASK']) && uuid(v.referenceId) && uuid(v.workspaceId);
export const isVersion = (v: unknown): v is ExperienceVersion =>
  record(v) &&
  uuid(v.id) &&
  num(v.number) &&
  v.schemaVersion === 1 &&
  isContent(v.content) &&
  Array.isArray(v.evidence) &&
  v.evidence.length <= 100 &&
  v.evidence.every(isEvidence) &&
  ((v.origin === 'MANUAL' && v.evaluation === 'NOT_EVALUATED') ||
    (v.origin === 'AUTOMATIC' && v.evaluation === 'AUTOMATIC_CHECKED')) &&
  uuid(v.createdBy) &&
  date(v.createdAt);
export const isEntry = (v: unknown): v is ExperienceEntry =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  num(v.revision) &&
  num(v.latestNumber) &&
  one(v.status, ['CANDIDATE', 'PUBLISHED', 'WITHDRAWN']) &&
  (v.publishedVersion === null || uuid(v.publishedVersion)) &&
  (v.status === 'PUBLISHED' ? uuid(v.publishedVersion) : v.publishedVersion === null) &&
  typeof v.canMaintain === 'boolean' &&
  isVersion(v.version) &&
  v.version.number <= v.latestNumber;
const isSummary = (v: unknown): v is ExperienceSummary =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  num(v.number) &&
  num(v.revision) &&
  one(v.status, ['CANDIDATE', 'PUBLISHED', 'WITHDRAWN']) &&
  str(v.title, 160) &&
  str(v.summary, 600) &&
  Array.isArray(v.tags) &&
  v.tags.every((t) => str(t, 40)) &&
  str(v.applicable, 2000) &&
  str(v.excluded, 2000, true) &&
  ((v.origin === 'MANUAL' && v.evaluation === 'NOT_EVALUATED') ||
    (v.origin === 'AUTOMATIC' && v.evaluation === 'AUTOMATIC_CHECKED'));
export const isUse = (v: unknown): v is ExperienceUse =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.entryId) &&
  uuid(v.versionId) &&
  (v.taskId === null || uuid(v.taskId)) &&
  str(v.contextKey, 100) &&
  one(v.decision, ['DIRECT', 'ADAPTED', 'UNKNOWN', 'NOT_APPLICABLE']) &&
  typeof v.adopted === 'boolean' &&
  (!v.adopted || one(v.decision, ['DIRECT', 'ADAPTED'])) &&
  str(v.conditions, 2000) &&
  str(v.adjustments, 2000, true) &&
  date(v.createdAt);
export const isFeedback = (v: unknown): v is ExperienceFeedback =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.useId) &&
  one(v.result, ['UNKNOWN', 'COMPLETED', 'FAILED', 'CORRECTED']) &&
  str(v.note, 2000) &&
  date(v.createdAt);
const isEvent = (v: unknown): v is ExperienceEvent =>
  record(v) &&
  uuid(v.id) &&
  num(v.revision) &&
  (v.versionId === null || uuid(v.versionId)) &&
  one(v.action, ['CREATED', 'REVISED', 'PUBLISHED', 'WITHDRAWN']) &&
  uuid(v.actorId) &&
  date(v.createdAt);
const page =
  <T extends { id: string }>(check: (v: unknown) => v is T) =>
  (v: unknown): v is { items: T[]; hasMore: boolean } =>
    record(v) &&
    typeof v.hasMore === 'boolean' &&
    Array.isArray(v.items) &&
    v.items.length <= 20 &&
    v.items.every(check) &&
    new Set(v.items.map((i) => i.id)).size === v.items.length;
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
const messages: Record<string, string> = {
  EXPERIENCE_NOT_FOUND: '经验不存在，或当前已无权访问。',
  EXPERIENCE_STATE_CHANGED: '其他维护者已更新此经验。请刷新并核对新版本。',
  EXPERIENCE_EVIDENCE_UNAVAILABLE: '来源已不可读取，请核对当前权限与资料状态。',
  EXPERIENCE_NOT_CURRENT: '此版本已经停用或被替换，请重新检索。',
  EXPERIENCE_USE_EXISTS: '本次案例或任务已记录过此版本，请在原记录下补充反馈。',
  EXPERIENCE_AUTOMATIC_MANAGED: '此经验由系统自动积累和更新，可查看版本或停用。',
  EXPERIENCE_COPY_CONFIRMATION_REQUIRED: '发布独立副本前，请确认手工整理的正文可在目标空间共享。',
  EXPERIENCE_TASK_UNFINISHED: '请在任务结束后再关联为经验依据。',
};
export function createExperienceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const send: typeof request = async (...args) => {
    try {
      return await request(...args);
    } catch (e) {
      if (e instanceof IdentityError && messages[e.code]) e.message = messages[e.code];
      throw e;
    }
  };
  const root = (t: string, w: string) => `/api/v1/tenants/${id(t)}/workspaces/${id(w)}/experiences`;
  const scoped =
    (t: string, w: string, e?: string) =>
    (v: unknown): v is ExperienceEntry =>
      isEntry(v) && v.tenantId === t && v.workspaceId === w && (!e || v.id === e);
  return {
    list(t: string, w: string, query = '', tag = '', maintenance = false, offset = 0, signal?: AbortSignal) {
      const q = new URLSearchParams({
        query,
        tag,
        maintenance: String(maintenance),
        offset: String(offset),
        limit: '20',
      });
      return send(
        root(t, w) + '?' + q,
        'GET',
        (v): v is ExperiencePage =>
          record(v) &&
          typeof v.canMaintain === 'boolean' &&
          v.indexStatus === 'READY' &&
          page(isSummary)(v) &&
          (maintenance || v.items.every((i) => i.status === 'PUBLISHED')),
        undefined,
        signal,
      );
    },
    get(t: string, w: string, e: string, version?: string, signal?: AbortSignal) {
      return send(
        root(t, w) + '/' + id(e) + (version ? '?version=' + id(version) : ''),
        'GET',
        (v): v is ExperienceEntry => scoped(t, w, e)(v) && (!version || v.version.id === version),
        undefined,
        signal,
      );
    },
    create(
      t: string,
      w: string,
      body: { requestId: string; content: ExperienceContent; evidence: ExperienceEvidence[] },
    ) {
      return send(root(t, w), 'POST', scoped(t, w), body);
    },
    revise(
      t: string,
      w: string,
      e: string,
      body: {
        requestId: string;
        expectedRevision: number;
        content: ExperienceContent;
        evidence: ExperienceEvidence[];
      },
    ) {
      return send(root(t, w) + '/' + id(e) + '/versions', 'POST', scoped(t, w, e), body);
    },
    publish(
      t: string,
      w: string,
      e: string,
      body: {
        requestId: string;
        expectedRevision: number;
        versionId: string;
        independentCopyConfirmed: boolean;
      },
    ) {
      return send(
        root(t, w) + '/' + id(e) + '/publish',
        'POST',
        (v): v is ExperienceEntry => scoped(t, w, e)(v) && v.version.id === body.versionId,
        body,
      );
    },
    withdraw(t: string, w: string, e: string, body: { requestId: string; expectedRevision: number }) {
      return send(root(t, w) + '/' + id(e) + '/withdraw', 'POST', scoped(t, w, e), body);
    },
    versions(t: string, w: string, e: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t, w) + '/' + id(e) + `/versions?offset=${offset}&limit=20`,
        'GET',
        page(isVersion),
        undefined,
        signal,
      );
    },
    events(t: string, w: string, e: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t, w) + '/' + id(e) + `/events?offset=${offset}&limit=20`,
        'GET',
        page(isEvent),
        undefined,
        signal,
      );
    },
    use(t: string, w: string, e: string, body: { requestId: string; use: ExperienceUseInput }) {
      return send(
        root(t, w) + '/' + id(e) + '/uses',
        'POST',
        (v): v is ExperienceUse => isUse(v) && v.entryId === e && v.versionId === body.use.versionId,
        body,
      );
    },
    uses(t: string, w: string, e: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t, w) + '/' + id(e) + `/uses?offset=${offset}&limit=20`,
        'GET',
        page((v): v is ExperienceUse => isUse(v) && v.entryId === e),
        undefined,
        signal,
      );
    },
    feedback(
      t: string,
      w: string,
      e: string,
      use: string,
      body: { requestId: string; result: ExperienceFeedback['result']; note: string },
    ) {
      return send(
        root(t, w) + '/' + id(e) + '/uses/' + id(use) + '/feedback',
        'POST',
        (v): v is ExperienceFeedback => isFeedback(v) && v.useId === use,
        body,
      );
    },
    feedbacks(t: string, w: string, e: string, use: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t, w) + '/' + id(e) + '/uses/' + id(use) + `/feedback?offset=${offset}&limit=20`,
        'GET',
        page((v): v is ExperienceFeedback => isFeedback(v) && v.useId === use),
        undefined,
        signal,
      );
    },
  };
}
export const experienceClient = createExperienceClient();
