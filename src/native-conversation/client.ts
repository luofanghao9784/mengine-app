import type {
  NativeArtifact,
  NativeAvailability,
  NativeConversation,
  NativeConversationGrant,
  NativeConversationHistory,
  NativeOperationReceipt,
  NativePublication,
} from '../../contracts/public-api/native-conversations';
import { createIdentityRequest, record, text, uuid } from '../identity/client.ts';
import { supportPath } from '../identity/support-request.ts';

const isAvailability = (v: unknown): v is NativeAvailability => record(v) && typeof v.enabled === 'boolean';
const isSession = (v: unknown): v is NativeConversation =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  (v.legacyConversationId === null || uuid(v.legacyConversationId)) &&
  (v.state === 'ACTIVE' || v.state === 'STOPPED') &&
  text(v.createdAt);
const isSessions = (v: unknown): v is NativeConversation[] => Array.isArray(v) && v.every(isSession);
const isGrant = (v: unknown): v is NativeConversationGrant =>
  record(v) && isSession(v.session) && text(v.token) && text(v.launchUrl);
const isArtifacts = (v: unknown): v is NativeArtifact[] =>
  Array.isArray(v) &&
  v.every(
    (a) => record(a) && uuid(a.id) && text(a.filename) && Number.isSafeInteger(a.bytes) && text(a.sha256),
  );
const isPublication = (v: unknown): v is NativePublication =>
  record(v) && uuid(v.materialId) && uuid(v.workspaceId) && uuid(v.artifactId);

const isHistory = (v: unknown): v is NativeConversationHistory =>
  record(v) && Array.isArray(v.items) && typeof v.hasMore === 'boolean';
const isReceipt = (v: unknown): v is NativeOperationReceipt => record(v) && v.accepted === true;
const isRatings = (v: unknown): v is { messageKey: string; value: 'up' | 'down' }[] =>
  Array.isArray(v) &&
  v.every((r) => record(r) && text(r.messageKey) && (r.value === 'up' || r.value === 'down'));
const isRating = (v: unknown): v is { messageKey: string; value: string } => record(v) && text(v.messageKey);

/** Native 0.2.1 sessions: private, rechecked on every call; the runtime never decides enterprise access. */
export function createNativeConversationClient(
  request = createIdentityRequest(),
  // Commands may wait for the runtime to start (the platform allows 60 s), so they get longer.
  command = createIdentityRequest(fetch, 75_000),
) {
  const base = (tenant: string) => `/api/v1/tenants/${encodeURIComponent(tenant)}/native-conversations`;
  const session = (tenant: string, id: string) => `${base(tenant)}/${encodeURIComponent(id)}`;
  return {
    availability: (tenant: string, signal?: AbortSignal) =>
      request(`${base(tenant)}/availability`, 'GET', isAvailability, undefined, signal),
    list: (tenant: string, workspaceId: string, signal?: AbortSignal) =>
      request(
        `${base(tenant)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        'GET',
        isSessions,
        undefined,
        signal,
      ),
    open: (
      tenant: string,
      workspaceId: string,
      legacyConversationId: string | null,
      requestId = crypto.randomUUID(),
    ) => request(base(tenant), 'POST', isSession, { requestId, workspaceId, legacyConversationId }),
    stop: (tenant: string, id: string) => request(`${session(tenant, id)}/stop`, 'POST', isSession),
    resume: (tenant: string, id: string) => request(`${session(tenant, id)}/resume`, 'POST', isSession),
    grant: (tenant: string, id: string) => request(`${session(tenant, id)}/grant`, 'POST', isGrant),
    artifacts: (tenant: string, id: string, signal?: AbortSignal) =>
      request(`${session(tenant, id)}/artifacts`, 'GET', isArtifacts, undefined, signal),
    artifactHref: (tenant: string, id: string, artifact: string) =>
      `${session(tenant, id)}/artifacts/${encodeURIComponent(artifact)}`,
    // Appendix C (B1–B3). Every write carries a requestId that the caller keeps for a retry of the
    // same operation: the server replays the first receipt and never re-dispatches an unknown outcome.
    history: (tenant: string, id: string, after: number, signal?: AbortSignal) =>
      request(`${session(tenant, id)}/history?after=${after}&limit=500`, 'GET', isHistory, undefined, signal),
    eventsHref: (tenant: string, id: string, after: number) =>
      supportPath(`${session(tenant, id)}/events?after=${after}`),
    send: (
      tenant: string,
      id: string,
      requestId: string,
      text: string,
      materials: { materialId: string; versionId: string }[] = [],
    ) => command(`${session(tenant, id)}/messages`, 'POST', isReceipt, { requestId, text, materials }),
    stopTurn: (tenant: string, id: string, requestId: string) =>
      command(`${session(tenant, id)}/turn/stop`, 'POST', isReceipt, { requestId }),
    answer: (
      tenant: string,
      id: string,
      callId: string,
      requestId: string,
      answers: { id: string; selected: string[]; custom?: string }[],
    ) =>
      command(`${session(tenant, id)}/questions/${encodeURIComponent(callId)}/answer`, 'POST', isReceipt, {
        requestId,
        answers,
      }),
    decide: (tenant: string, id: string, approvalId: string, requestId: string, allow: boolean) =>
      command(`${session(tenant, id)}/approvals/${encodeURIComponent(approvalId)}`, 'POST', isReceipt, {
        requestId,
        decision: allow ? 'ALLOW_ONCE' : 'REJECT',
      }),
    reviewPlan: (
      tenant: string,
      id: string,
      callId: string,
      requestId: string,
      approve: boolean,
      comment?: string,
    ) =>
      command(`${session(tenant, id)}/plans/${encodeURIComponent(callId)}/review`, 'POST', isReceipt, {
        requestId,
        decision: approve ? 'APPROVE' : 'REVISE',
        ...(comment ? { comment } : {}),
      }),
    rate: (tenant: string, id: string, requestId: string, messageKey: string, value: 'up' | 'down') =>
      request(`${session(tenant, id)}/feedback`, 'POST', isRating, { requestId, messageKey, value }),
    ratings: (tenant: string, id: string, signal?: AbortSignal) =>
      request(`${session(tenant, id)}/feedback`, 'GET', isRatings, undefined, signal),
    /** `acknowledged` is the employee's own confirmation; the server rejects publication without it. */
    publish: (
      tenant: string,
      id: string,
      input: { artifactId: string; workspaceId: string; acknowledged: boolean },
      requestId = crypto.randomUUID(),
    ) => request(`${session(tenant, id)}/publish`, 'POST', isPublication, { requestId, ...input }),
  };
}
export const nativeConversationClient = createNativeConversationClient();

/**
 * Browsers only allow a new window during the click itself, but the grant arrives after a
 * request. Reserve an empty, opener-less window synchronously in the click handler, then
 * submit the launch form into it. Close it if the request fails.
 */
export function reserveNativeWindow() {
  const name = `dh-native-${crypto.randomUUID()}`;
  const win = window.open('about:blank', name);
  if (win) win.opener = null;
  return { name, close: () => win?.close() };
}

/**
 * The official runtime window is opened by a top-level form POST so the one-time grant never
 * appears in a URL, history entry or referrer. Only http(s) launch addresses are accepted.
 */
export function openNativeWindow(grant: NativeConversationGrant, target = '_blank') {
  const url = new URL(grant.launchUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('运行入口配置无效');
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url.href;
  form.target = target;
  for (const [name, value] of Object.entries({ id: grant.session.id, token: grant.token })) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  form.remove();
}
