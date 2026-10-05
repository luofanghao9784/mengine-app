import type {
  Conversation,
  ConversationManagementReceipt,
  ConversationTask,
  ConversationPage,
  ConversationDetail,
  BriefingDiscussion,
  ConversationEvents,
  SendTask,
  TaskArtifact,
  TaskOriginal,
  TaskAction,
  TaskAttempts,
} from '../../contracts/public-api/conversation';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
import { isChunk } from '../material/knowledge-client.ts';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const nullable = (v: unknown) => v === null || text(v);
const states = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
  'PAUSED',
  'WAITING_INPUT',
  'WAITING_CAPABILITY',
  'PARTIAL',
  'RESULT_UNKNOWN',
];
const conversation = (v: unknown): v is Conversation =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.tenantId) &&
  uuid(v.workspaceId) &&
  text(v.title) &&
  text(v.updatedAt) &&
  Number.isFinite(Date.parse(v.updatedAt)) &&
  (v.managementRevision === undefined || count(v.managementRevision)) &&
  (v.running === undefined || typeof v.running === 'boolean') &&
  (v.unread === undefined || typeof v.unread === 'boolean') &&
  (v.briefingDiscussion === undefined || typeof v.briefingDiscussion === 'boolean') &&
  (v.replyRevision === undefined || count(v.replyRevision)) &&
  (v.latestReplyTaskId === undefined || v.latestReplyTaskId === null || uuid(v.latestReplyTaskId)) &&
  (v.trashedAt === undefined || v.trashedAt === null || (text(v.trashedAt) && Number.isFinite(Date.parse(v.trashedAt))));
const safePublicLink = (value: unknown) => {
  if (!text(value) || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443');
  } catch {
    return false;
  }
};
const digest = (v: unknown) => text(v) && /^[0-9a-f]{64}$/.test(v);
export const isOriginal = (v: unknown): v is TaskOriginal =>
  record(v) &&
  uuid(v.materialId) &&
  uuid(v.versionId) &&
  text(v.filename) &&
  v.filename.length <= 180 &&
  count(v.version) &&
  v.version > 0 &&
  count(v.bytes) &&
  v.bytes <= 20971520 &&
  digest(v.sha256) &&
  typeof v.read === 'boolean';
const task = (v: unknown): v is ConversationTask =>
  record(v) &&
  uuid(v.id) &&
  Array.isArray(v.originals) &&
  v.originals.length <= 3 &&
  v.originals.every(isOriginal) &&
  new Set(v.originals.map((f) => f.materialId)).size === v.originals.length &&
  new Set(v.originals.map((f) => f.versionId)).size === v.originals.length &&
  v.originals.reduce((n, f) => n + f.bytes, 0) <= 62914560 &&
  (v.executionClass !== 'verification' ||
    (v.originals.every((f) => f.bytes <= 262144) &&
      v.originals.reduce((n, f) => n + f.bytes, 0) <= 524288)) &&
  (v.originals.length === 0 || v.mode === 'AGENT') &&
  text(v.prompt) &&
  ['SOURCE_LOOKUP', 'AGENT'].includes(String(v.mode)) &&
  nullable(v.publicQuery) &&
  Array.isArray(v.webSources) &&
  v.webSources.length <= 3 &&
  v.webSources.every(
    (s) =>
      record(s) &&
      uuid(s.id) &&
      safePublicLink(s.url) &&
      text(s.title) &&
      s.title.length <= 160 &&
      text(s.excerpt) &&
      s.excerpt.length <= 4000 &&
      digest(s.sha256) &&
      text(s.retrievedAt) &&
      Number.isFinite(Date.parse(s.retrievedAt)) &&
      ['SEARCH', 'PAGE'].includes(String(s.kind)) &&
      typeof s.truncated === 'boolean',
  ) &&
  Array.isArray(v.skills) &&
  v.skills.length <= 8 &&
  v.skills.every(
    (s) =>
      record(s) &&
      text(s.id) &&
      /^[a-z][a-z0-9-]{0,63}$/.test(s.id) &&
      text(s.version) &&
      /^[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$/.test(s.version) &&
      digest(s.sha256),
  ) &&
  (v.mode === 'AGENT' || (!v.publicQuery && v.webSources.length === 0 && v.skills.length === 0)) &&
  nullable(v.reply) &&
  nullable(v.modelName) &&
  (v.executionClass === null || ['live', 'verification'].includes(String(v.executionClass))) &&
  (v.mode === 'SOURCE_LOOKUP'
    ? v.executionClass === null
    : v.executionClass !== null ||
      ['WAITING_CAPABILITY', 'PAUSED', 'CANCELLED'].includes(String(v.status))) &&
  (v.waitReason === undefined || nullable(v.waitReason)) &&
  (v.requiredInput === undefined ||
    (nullable(v.requiredInput) && (v.requiredInput === null || String(v.requiredInput).length <= 1000))) &&
  (v.supplementalInput === undefined ||
    v.supplementalInput === null ||
    (typeof v.supplementalInput === 'string' && v.supplementalInput.length <= 12000)) &&
  (v.reconciliationRequired === undefined || typeof v.reconciliationRequired === 'boolean') &&
  Array.isArray(v.artifacts) &&
  v.artifacts.length <= 8 &&
  v.artifacts.every(
    (a) =>
      record(a) &&
      uuid(a.id) &&
      text(a.filename) &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(a.filename) &&
      text(a.sha256) &&
      /^[0-9a-f]{64}$/.test(a.sha256) &&
      count(a.bytes) &&
      a.bytes <= 65536,
  ) &&
  states.includes(String(v.status)) &&
  count(v.revision) &&
  count(v.attempt) &&
  (v.summaryCode === null || ['SOURCES_FOUND', 'NO_SOURCES'].includes(String(v.summaryCode))) &&
  nullable(v.errorCode) &&
  nullable(v.engineVersion) &&
  typeof v.sourcesUnavailable === 'boolean' &&
  Array.isArray(v.sources) &&
  v.sources.every(isChunk) &&
  text(v.createdAt);
export const isDetail = (v: unknown): v is ConversationDetail =>
  record(v) &&
  conversation(v.conversation) &&
  (v.briefingContext == null ||
    (record(v.briefingContext) &&
      uuid(v.briefingContext.conversationId) &&
      uuid(v.briefingContext.taskId) &&
      uuid(v.briefingContext.workspaceId) &&
      count(v.briefingContext.taskRevision) &&
      count(v.briefingContext.attempt))) &&
  count(v.cursor) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.tasks) &&
  v.tasks.every(
    (t) =>
      task(t) &&
      t.sources.every(
        (s) =>
          s.tenantId === (v.conversation as Conversation).tenantId &&
          s.workspaceId === (v.conversation as Conversation).workspaceId,
      ),
  );
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createConversationClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/conversations`;
  const scoped =
    (tenant: string, conversationId?: string) =>
    (v: unknown): v is ConversationDetail =>
      isDetail(v) &&
      v.conversation.tenantId === tenant &&
      (!conversationId || v.conversation.id === conversationId);
  return {
    list(tenant: string, offset = 0, signal?: AbortSignal, trash = false) {
      return request(
        root(tenant) + `${trash ? '/trash' : ''}?offset=${offset}&limit=20`,
        'GET',
        (v): v is ConversationPage =>
          record(v) &&
          v.tenantId === tenant &&
          typeof v.enabled === 'boolean' &&
          typeof v.publicWebEnabled === 'boolean' &&
          ['off', 'verification', 'live'].includes(String(v.agentMode)) &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every((c) => conversation(c) && c.tenantId === tenant),
        undefined,
        signal,
      );
    },
    manage(tenant: string, conversationId: string, body: {requestId: string; expectedRevision: number; action: 'TRASH' | 'RESTORE'; stopRunning: boolean}) {
      return request(root(tenant) + `/${id(conversationId)}/management`, 'POST',
        (v): v is ConversationManagementReceipt => record(v) && v.id === conversationId && count(v.revision) &&
          (v.trashedAt === null || (text(v.trashedAt) && Number.isFinite(Date.parse(v.trashedAt)))), body);
    },
    read(tenant: string, conversationId: string, replyRevision: number, signal?: AbortSignal) {
      return request(root(tenant) + `/${id(conversationId)}/read`, 'POST',
        (v): v is {id:string;readReplyRevision:number} => record(v) && v.id === conversationId && count(v.readReplyRevision) && v.readReplyRevision >= replyRevision,
        {replyRevision}, signal);
    },
    discussion(
      tenant: string,
      source: { conversationId: string; taskId: string; taskRevision: number; attempt: number },
    ) {
      return request(
        root(tenant) +
          `/${id(source.conversationId)}/tasks/${id(source.taskId)}/discussion?revision=${source.taskRevision}&attempt=${source.attempt}`,
        'GET',
        (v): v is BriefingDiscussion =>
          record(v) && (v.conversationId === null || uuid(v.conversationId)) && text(v.title) &&
          record(v.briefingContext) && v.briefingContext.conversationId === source.conversationId &&
          v.briefingContext.taskId === source.taskId && uuid(v.briefingContext.workspaceId) &&
          v.briefingContext.taskRevision === source.taskRevision && v.briefingContext.attempt === source.attempt,
      );
    },
    detail(tenant: string, conversation: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `/${id(conversation)}?offset=${offset}&limit=20`,
        'GET',
        scoped(tenant, conversation),
        undefined,
        signal,
      );
    },
    taskDetail(tenant: string, conversation: string, task: string, signal?: AbortSignal) {
      return request(
        root(tenant) + `/${id(conversation)}/tasks/${id(task)}`,
        'GET',
        (v): v is ConversationDetail =>
          scoped(tenant, conversation)(v) && v.tasks.length === 1 && v.tasks[0].id === task,
        undefined,
        signal,
      );
    },
    historical(tenant: string, conversation: string, task: string, signal?: AbortSignal) {
      return request(
        root(tenant) + `/${id(conversation)}/tasks/${id(task)}`,
        'GET',
        (v): v is ConversationDetail =>
          scoped(tenant, conversation)(v) &&
          v.tasks.length === 1 &&
          v.tasks[0].id === task &&
          v.tasks[0].status === 'SUCCEEDED' &&
          v.tasks[0].mode === 'AGENT',
        undefined,
        signal,
      );
    },
    send(tenant: string, conversation: string | undefined, body: SendTask, signal?: AbortSignal) {
      const reference = body.briefingContext;
      // Reading state may include card geometry; the API accepts only the versioned reference.
      const payload = reference ? {
        ...body,
        briefingContext: {
          conversationId: reference.conversationId,
          taskId: reference.taskId,
          workspaceId: reference.workspaceId,
          taskRevision: reference.taskRevision,
          attempt: reference.attempt,
        },
      } : body;
      return request(
        root(tenant) + (conversation ? `/${id(conversation)}/tasks` : ''),
        'POST',
        (v): v is ConversationDetail =>
          scoped(tenant, conversation)(v) && v.conversation.workspaceId === body.workspaceId,
        payload,
        signal,
      );
    },
    action(
      tenant: string,
      conversation: string,
      task: string,
      body: {
        requestId: string;
        expectedRevision: number;
        action: TaskAction;
        input?: string;
        originals?: { materialId: string; versionId: string }[];
      },
      signal?: AbortSignal,
    ) {
      return request(
        root(tenant) + `/${id(conversation)}/tasks/${id(task)}`,
        'POST',
        scoped(tenant, conversation),
        body,
        signal,
      );
    },
    attempts(tenant: string, conversation: string, taskId: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `/${id(conversation)}/tasks/${id(taskId)}/attempts?offset=${offset}&limit=10`,
        'GET',
        (v): v is TaskAttempts =>
          record(v) &&
          v.taskId === taskId &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 10 &&
          v.items.every(
            (a, i, all) =>
              record(a) &&
              count(a.number) &&
              a.number > 0 &&
              (i === 0 || a.number < (all[i - 1] as { number: number }).number) &&
              states.includes(String(a.status)) &&
              text(a.input) &&
              a.input.length <= 16000 &&
              nullable(a.reply) &&
              nullable(a.summaryCode) &&
              nullable(a.errorCode) &&
              nullable(a.engineVersion) &&
              nullable(a.modelName) &&
              nullable(a.reconciliationCode) &&
              nullable(a.startedAt) &&
              nullable(a.finishedAt) &&
              ['RECORDED', 'LEGACY_CURRENT_ONLY'].includes(String(a.provenance)) &&
              Array.isArray(a.tools) &&
              a.tools.length <= 8 &&
              a.tools.every(
                (t) =>
                  record(t) &&
                  text(t.callId) &&
                  text(t.name) &&
                  ['STARTED', 'succeeded', 'failed'].includes(String(t.status)),
              ) &&
              Array.isArray(a.sources) &&
              a.sources.every((s) => isChunk(s) && s.tenantId === tenant) &&
              Array.isArray(a.artifacts) &&
              a.artifacts.length <= 8 &&
              a.artifacts.every(
                (f) =>
                  record(f) &&
                  uuid(f.id) &&
                  text(f.filename) &&
                  digest(f.sha256) &&
                  count(f.bytes) &&
                  f.bytes <= 65536,
              ),
          ),
        undefined,
        signal,
      );
    },
    async download(
      tenant: string,
      conversation: string,
      task: string,
      artifact: TaskArtifact,
      signal?: AbortSignal,
    ) {
      const requestSignal = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
      try {
        const response = await fetcher(
          root(tenant) + `/${id(conversation)}/tasks/${id(task)}/artifacts/${id(artifact.id)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            signal: requestSignal,
          },
        );
        if (!response.ok)
          throw new IdentityError(
            response.status === 401 ? 'AUTHENTICATION_REQUIRED' : 'ARTIFACT_UNAVAILABLE',
            response.status,
          );
        if (
          response.headers.get('content-type') !== 'application/octet-stream' ||
          !response.headers.get('content-disposition')?.startsWith('attachment;') ||
          response.headers.get('x-content-sha256') !== artifact.sha256 ||
          !response.body
        )
          throw new IdentityError('CONTRACT_MISMATCH');
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
            if (length > 65536 || length > artifact.bytes) throw new IdentityError('CONTRACT_MISMATCH');
            chunks.push(next.value);
          }
        } finally {
          await reader.cancel();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (length !== artifact.bytes || sha !== artifact.sha256)
          throw new IdentityError('CONTRACT_MISMATCH');
        return new Blob([bytes], { type: 'application/octet-stream' });
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        throw new IdentityError(signal?.aborted ? 'CANCELLED' : 'UNAVAILABLE');
      }
    },
    events(tenant: string, conversation: string, after: number, signal?: AbortSignal) {
      return request(
        root(tenant) + `/${id(conversation)}/events?after=${after}`,
        'GET',
        (v): v is ConversationEvents =>
          record(v) &&
          v.conversationId === conversation &&
          count(v.cursor) &&
          v.cursor >= after &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every(
            (e, i, a) =>
              record(e) &&
              count(e.seq) &&
              e.seq > (i === 0 ? after : (a[i - 1] as { seq: number }).seq) &&
              e.seq <= (v.cursor as number) &&
              uuid(e.taskId) &&
              (states.includes(String(e.kind)) || e.kind === 'TITLE_UPDATED' || e.kind === 'LIVE') &&
              count(e.revision),
          ),
        undefined,
        signal,
      );
    },
  };
}
export const conversationClient = createConversationClient();
