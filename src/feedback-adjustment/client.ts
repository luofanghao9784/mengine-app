import type {
  AdjustmentReading,
  AdjustmentMessage,
  AdjustmentView,
  AdjustmentSent,
  SendAdjustment,
} from '../../contracts/public-api/feedback-adjustment.ts';
import type { FeedbackTarget } from '../../contracts/public-api/feedback.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
import { isTarget, isFeedback } from '../feedback/client.ts';
const n = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const str = (v: unknown): v is string => typeof v === 'string';
const same = (a: FeedbackTarget, b: FeedbackTarget) =>
  [
    'kind',
    'taskId',
    'taskRevision',
    'attempt',
    'presentationVersion',
    'presentationRevision',
    'publicationId',
    'materialVersionId',
    'materialVersion',
  ].every((k) => (a[k as keyof FeedbackTarget] ?? null) === (b[k as keyof FeedbackTarget] ?? null));
export const isReading = (v: unknown): v is AdjustmentReading =>
  record(v) &&
  uuid(v.workspaceId) &&
  uuid(v.cardId) &&
  ['BRIEFING', 'PUBLICATION'].includes(String(v.cardKind)) &&
  isTarget(v.target) &&
  v.cardKind === v.target.kind &&
  str(v.title) &&
  str(v.excerpt) &&
  typeof v.truncated === 'boolean' &&
  str(v.presentation) &&
  Array.isArray(v.sourceVersions) &&
  v.sourceVersions.every(uuid) &&
  str(v.contentSha256) &&
  /^[a-f0-9]{64}$/.test(v.contentSha256);
export const isMessage = (v: unknown): v is AdjustmentMessage =>
  record(v) &&
  uuid(v.id) &&
  n(v.ordinal) &&
  v.ordinal > 0 &&
  uuid(v.taskId) &&
  n(v.taskRevision) &&
  [
    'QUEUED',
    'RUNNING',
    'WAITING_INPUT',
    'WAITING_CAPABILITY',
    'PARTIAL',
    'RESULT_UNKNOWN',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'PAUSED',
    'INTERRUPTED',
  ].includes(String(v.status)) &&
  (v.waitReason === null || str(v.waitReason)) &&
  str(v.request) &&
  v.request.length <= 2000 &&
  isReading(v.reading) &&
  Array.isArray(v.historyTaskIds) &&
  v.historyTaskIds.length <= 5 &&
  v.historyTaskIds.every(uuid) &&
  (v.reply === null || str(v.reply)) &&
  (v.requiredInput === null || str(v.requiredInput)) &&
  str(v.supplementalInput) &&
  str(v.createdAt) &&
  Number.isFinite(Date.parse(v.createdAt));
export const isView = (v: unknown): v is AdjustmentView =>
  record(v) &&
  isReading(v.reading) &&
  (v.threadId === null || uuid(v.threadId)) &&
  (v.conversationId === null || uuid(v.conversationId)) &&
  (v.threadId === null) === (v.conversationId === null) &&
  n(v.threadRevision) &&
  n(v.feedbackRevision) &&
  Array.isArray(v.items) &&
  v.items.length <= 20 &&
  v.items.every(isMessage) &&
  new Set(v.items.map((m) => m.id)).size === v.items.length &&
  typeof v.hasMore === 'boolean' &&
  n(v.nextOffset);
export function createAdjustmentClient(fetcher: typeof fetch = fetch) {
  const raw = createIdentityRequest(fetcher);
  const send: typeof raw = async (...args) => {
    try {
      return await raw(...args);
    } catch (e) {
      if (e instanceof IdentityError) {
        const messages: Record<string, string> = {
          ADJUSTMENT_CHANGED: '调整会话已变化。刷新后核对历史再发送；本次输入仍保留。',
          FEEDBACK_STATE_CHANGED: '评价已被修改。刷新后再决定，本次未发送。',
          FEEDBACK_TARGET_CHANGED: '这张卡片的版本或呈现已变化。请重新打开当前卡片，旧快照不会自动升级。',
          CONVERSATION_BUSY: '上一条调整仍在执行，请完成或停止后继续。',
          ADJUSTMENT_UNAVAILABLE: '调整内容或来源当前不可用。',
          CONVERSATION_PURPOSE_MISMATCH: '请从原卡片的独立调整会话继续。',
        };
        if (messages[e.code]) e.message = messages[e.code];
      }
      throw e;
    }
  };
  const root = (tenant: string) => {
    if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/v1/tenants/${tenant}/feedback-adjustments`;
  };
  return {
    open(tenant: string, target: FeedbackTarget, offset = 0, signal?: AbortSignal) {
      if (!isTarget(target) || target.kind === 'TASK' || !n(offset))
        throw new IdentityError('INVALID_REQUEST', 400);
      const q = new URLSearchParams(
        Object.entries(target)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)]),
      );
      q.set('offset', String(offset));
      q.set('limit', '20');
      return send(
        root(tenant) + '?' + q,
        'GET',
        (v): v is AdjustmentView => isView(v) && same(v.reading.target, target),
        undefined,
        signal,
      );
    },
    send(tenant: string, body: SendAdjustment) {
      return send(
        root(tenant),
        'POST',
        (v): v is AdjustmentSent =>
          record(v) &&
          uuid(v.threadId) &&
          uuid(v.conversationId) &&
          n(v.threadRevision) &&
          isMessage(v.message) &&
          same(v.message.reading.target, body.target) &&
          isFeedback(v.feedback) &&
          v.feedback.tenantId === tenant &&
          same(v.feedback.target, body.target),
        body,
      );
    },
  };
}
export const adjustmentClient = createAdjustmentClient();
