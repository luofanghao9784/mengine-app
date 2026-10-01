import type {
  Feedback,
  FeedbackAction,
  FeedbackAssessment,
  FeedbackFollowUp,
  FeedbackPreferenceState,
  FeedbackTarget,
  FeedbackVersion,
} from '../../contracts/public-api/feedback.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const n = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const str = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' && v.length <= max && (empty || v.length > 0);
const one = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);
const date = (v: unknown) => str(v, 50) && Number.isFinite(Date.parse(v));
export const isTarget = (v: unknown): v is FeedbackTarget =>
  record(v) &&
  n(v.taskRevision) &&
  n(v.attempt) &&
  n(v.presentationRevision) &&
  (v.kind === 'PUBLICATION'
    ? v.taskId == null &&
      v.taskRevision === 0 &&
      v.attempt === 0 &&
      uuid(v.publicationId) &&
      uuid(v.materialVersionId) &&
      n(v.materialVersion) &&
      v.materialVersion > 0 &&
      v.presentationVersion === 'recommendation-v1' &&
      v.presentationRevision > 0
    : one(v.kind, ['BRIEFING', 'TASK']) &&
      uuid(v.taskId) &&
      v.publicationId == null &&
      v.materialVersionId == null &&
      v.materialVersion == null &&
      (v.kind === 'BRIEFING'
        ? v.presentationVersion === 'briefing-basic-v1' ||
          (v.presentationVersion === 'recommendation-v1' && v.presentationRevision > 0)
        : v.presentationVersion === 'task-v1' && v.presentationRevision === 0));
export const isAssessment = (v: unknown, kind?: FeedbackTarget['kind']): v is FeedbackAssessment =>
  record(v) &&
  one(
    v.rating,
    kind === 'BRIEFING' || kind === 'PUBLICATION'
      ? ['USEFUL', 'NOT_USEFUL']
      : kind === 'TASK'
        ? ['ACHIEVED', 'PARTIAL', 'NOT_ACHIEVED']
        : ['USEFUL', 'NOT_USEFUL', 'ACHIEVED', 'PARTIAL', 'NOT_ACHIEVED'],
  ) &&
  Array.isArray(v.reasons) &&
  v.reasons.length <= 6 &&
  v.reasons.every((r) =>
    one(
      r,
      kind === 'BRIEFING' || kind === 'PUBLICATION'
        ? ['IRRELEVANT', 'REDUNDANT', 'INACCURATE', 'UNHELPFUL', 'CUSTOM']
        : kind === 'TASK'
          ? ['FACT_ERROR', 'EXECUTION', 'GOAL_CHANGED', 'EXPRESSION', 'DATA_GAP', 'OTHER']
          : [
              'IRRELEVANT',
              'REDUNDANT',
              'INACCURATE',
              'UNHELPFUL',
              'CUSTOM',
              'FACT_ERROR',
              'EXECUTION',
              'GOAL_CHANGED',
              'EXPRESSION',
              'DATA_GAP',
              'OTHER',
            ],
    ),
  ) &&
  new Set(v.reasons).size === v.reasons.length &&
  str(v.suggestion, 2000, true) &&
  (v.rating !== 'NOT_USEFUL' || v.reasons.length > 0 || v.suggestion.trim().length > 0) &&
  (!v.reasons.includes('CUSTOM') || v.suggestion.trim().length > 0);
export const isFeedback = (v: unknown): v is Feedback =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  isTarget(v.target) &&
  n(v.revision) &&
  v.revision >= 1 &&
  one(v.status, ['ACTIVE', 'WITHDRAWN']) &&
  isAssessment(v.assessment, v.target.kind) &&
  record(v.snapshot) &&
  str(v.snapshot.taskState, 32) &&
  one(v.snapshot.executionClass, ['live', 'verification', 'none']) &&
  typeof v.snapshot.contentSha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(v.snapshot.contentSha256) &&
  n(v.snapshot.sourceVersionCount) &&
  date(v.createdAt) &&
  date(v.updatedAt);
export const isAction = (v: unknown): v is FeedbackAction =>
  record(v) &&
  (v.targetWorkspaceId === undefined || uuid(v.targetWorkspaceId)) &&
  uuid(v.id) &&
  uuid(v.feedbackId) &&
  n(v.feedbackRevision) &&
  v.feedbackRevision > 0 &&
  one(v.kind, ['PREFERENCE', 'CORRECTION', 'EXPERIENCE_CANDIDATE']) &&
  uuid(v.targetId) &&
  (v.targetVersion === null || uuid(v.targetVersion)) &&
  (v.targetRevision === null || n(v.targetRevision)) &&
  (v.conversationId === null || uuid(v.conversationId)) &&
  str(v.acceptedState, 32) &&
  one(v.executionClass, ['live', 'verification', 'none']) &&
  date(v.createdAt) &&
  (v.kind === 'PREFERENCE'
    ? v.status === 'APPLIED' &&
      v.targetRevision !== null &&
      v.targetRevision > 0 &&
      v.targetVersion === null &&
      v.conversationId === null &&
      v.acceptedState === 'ACTIVE'
    : v.kind === 'CORRECTION'
      ? v.status === 'TASK_CREATED' &&
        uuid(v.conversationId) &&
        v.targetVersion === null &&
        v.targetRevision !== null &&
        one(v.acceptedState, [
          'QUEUED',
          'WAITING_CAPABILITY',
          'WAITING_INPUT',
          'WAITING_CONFIRMATION',
          'PAUSED',
          'RUNNING',
          'SUCCEEDED',
          'FAILED',
          'CANCELLED',
          'INTERRUPTED',
        ])
      : v.status === 'CANDIDATE_CREATED' &&
        uuid(v.targetVersion) &&
        v.targetRevision !== null &&
        v.targetRevision > 0 &&
        v.conversationId === null &&
        v.acceptedState === 'CANDIDATE');
const isPreference = (v: unknown): v is FeedbackPreferenceState =>
  record(v) &&
  one(v.scenario, ['GENERAL', 'WEEKLY_REPORT', 'TABLE_SUMMARY']) &&
  (v.profileId === null || uuid(v.profileId)) &&
  n(v.revision) &&
  one(v.status, ['UNSET', 'ACTIVE', 'PROPOSED', 'WITHDRAWN', 'EXPIRED', 'UNAVAILABLE']) &&
  (v.status !== 'UNAVAILABLE' || v.style === null) &&
  (v.style === null || one(v.style, ['CONCLUSION_FIRST', 'DETAIL_FIRST', 'TABLE_FIRST', 'CONCISE']));
const same = (a: FeedbackTarget, b: FeedbackTarget) =>
  a.kind === b.kind &&
  a.taskId == b.taskId &&
  a.publicationId == b.publicationId &&
  a.materialVersionId == b.materialVersionId &&
  a.materialVersion == b.materialVersion &&
  a.taskRevision === b.taskRevision &&
  a.attempt === b.attempt &&
  a.presentationVersion === b.presentationVersion &&
  a.presentationRevision === b.presentationRevision;
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
const messages: Record<string, string> = {
  EXPERIENCE_CLIENT_DISABLED: '首版客户端暂不提供经验维护，请继续当前工作。',
  FEEDBACK_NOT_FOUND: '反馈已不可读取，请核对源内容权限。',
  FEEDBACK_TARGET_UNAVAILABLE: '原任务或独立发布副本已不可读取。',
  FEEDBACK_SOURCE_UNAVAILABLE: '原反馈依赖的资料已不可读取。',
  FEEDBACK_TARGET_CHANGED: '任务或呈现版本已变化，请刷新后针对实际看到的版本评价。',
  FEEDBACK_STATE_CHANGED: '评价已被修改或撤回，请刷新并核对。',
  FEEDBACK_ALREADY_EXISTS: '此版本已经有你的评价，请刷新后改评。',
  FEEDBACK_ACTION_EXISTS: '此评价版本已处理过该类动作。请查看已有回执。',
  FEEDBACK_TOO_MANY_SOURCES: '来源数量超出经验候选单条上限，请在经验库中分开整理。',
  PROFILE_VERSION_CONFLICT: '你的偏好档案已更新，请刷新当前偏好后再设置。',
  EXPERIENCE_TASK_UNFINISHED: '原任务尚未结束。可以先保存评价，结束后再整理经验候选。',
  PERSONAL_WORKSPACE_REQUIRED: '未找到你的个人空间，请刷新身份后重试。',
  CAPABILITY_REQUIRED: '你没有此空间的经验维护资格，评价本身不会增加维护权限。',
};
export function createFeedbackClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const send: typeof request = async (...args) => {
    try {
      return await request(...args);
    } catch (e) {
      if (e instanceof IdentityError && messages[e.code]) e.message = messages[e.code];
      throw e;
    }
  };
  const root = (t: string) => `/api/v1/tenants/${id(t)}/feedback`;
  const scoped =
    (t: string, f?: string) =>
    (v: unknown): v is Feedback =>
      isFeedback(v) && v.tenantId === t && (!f || v.id === f);
  return {
    lookup(t: string, target: FeedbackTarget, signal?: AbortSignal) {
      if (!isTarget(target)) throw new IdentityError('INVALID_REQUEST', 400);
      const q = new URLSearchParams(
        Object.fromEntries(
          Object.entries(target)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        ),
      );
      return send(
        root(t) + '?' + q,
        'GET',
        (v): v is { feedback: Feedback | null } =>
          record(v) && (v.feedback === null || (scoped(t)(v.feedback) && same(v.feedback.target, target))),
        undefined,
        signal,
      );
    },
    get(t: string, f: string, signal?: AbortSignal) {
      return send(root(t) + '/' + id(f), 'GET', scoped(t, f), undefined, signal);
    },
    create(t: string, body: { requestId: string; target: FeedbackTarget; assessment: FeedbackAssessment }) {
      return send(
        root(t),
        'POST',
        (v): v is Feedback =>
          scoped(t)(v) && same(v.target, body.target) && v.revision === 1 && v.status === 'ACTIVE',
        body,
      );
    },
    edit(
      t: string,
      f: string,
      body: { requestId: string; expectedRevision: number; assessment: FeedbackAssessment },
    ) {
      return send(
        root(t) + '/' + id(f),
        'POST',
        (v): v is Feedback =>
          scoped(t, f)(v) && v.revision === body.expectedRevision + 1 && v.status === 'ACTIVE',
        body,
      );
    },
    withdraw(t: string, f: string, body: { requestId: string; expectedRevision: number }) {
      return send(
        root(t) + '/' + id(f) + '/withdraw',
        'POST',
        (v): v is Feedback =>
          scoped(t, f)(v) && v.revision === body.expectedRevision + 1 && v.status === 'WITHDRAWN',
        body,
      );
    },
    history(t: string, f: string, kind: FeedbackTarget['kind'], offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + '/' + id(f) + `/history?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: FeedbackVersion[]; hasMore: boolean } =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(
            (i) =>
              record(i) &&
              n(i.revision) &&
              i.revision > 0 &&
              one(i.status, ['ACTIVE', 'WITHDRAWN']) &&
              isAssessment(i.assessment, kind) &&
              date(i.createdAt),
          ),
        undefined,
        signal,
      );
    },
    preferences(t: string, signal?: AbortSignal) {
      return send(
        root(t) + '/preferences',
        'GET',
        (v): v is { items: FeedbackPreferenceState[] } =>
          record(v) &&
          Array.isArray(v.items) &&
          v.items.length === 3 &&
          v.items.every(isPreference) &&
          new Set(v.items.map((i) => i.scenario)).size === 3,
        undefined,
        signal,
      );
    },
    actions(t: string, f: string, offset = 0, signal?: AbortSignal) {
      return send(
        root(t) + '/' + id(f) + `/actions?offset=${offset}&limit=20`,
        'GET',
        (v): v is { items: FeedbackAction[]; hasMore: boolean } =>
          record(v) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((i) => isAction(i) && i.feedbackId === f) &&
          new Set(v.items.map((i) => i.id)).size === v.items.length,
        undefined,
        signal,
      );
    },
    followUp(
      t: string,
      f: string,
      body: { requestId: string; expectedRevision: number; action: FeedbackFollowUp },
    ) {
      return send(
        root(t) + '/' + id(f) + '/actions',
        'POST',
        (v): v is FeedbackAction =>
          isAction(v) &&
          v.feedbackId === f &&
          v.feedbackRevision === body.expectedRevision &&
          v.kind === body.action.kind,
        body,
      );
    },
  };
}
export const feedbackClient = createFeedbackClient();
