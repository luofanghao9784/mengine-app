import type { LiveSnapshot } from '../../contracts/public-api/conversation';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client';
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function isLiveSnapshot(v: unknown): v is LiveSnapshot {
  return (
    record(v) &&
    uuid(v.conversationId) &&
    Array.isArray(v.items) &&
    v.items.length <= 20 &&
    v.items.every(
      (t) =>
        record(t) &&
        uuid(t.taskId) &&
        integer(t.attempt) &&
        typeof t.status === 'string' &&
        typeof t.enabled === 'boolean' &&
        typeof t.stopping === 'boolean' &&
        Array.isArray(t.outputs) &&
        t.outputs.length <= 8 &&
        t.outputs.every(
          (o) =>
            record(o) &&
            integer(o.step) &&
            integer(o.version) &&
            typeof o.text === 'string' &&
            o.text.length <= 65536 &&
            ['STREAMING', 'COMPLETE', 'INTERRUPTED'].includes(String(o.state)),
        ) &&
        Array.isArray(t.inputs) &&
        t.inputs.length <= 20 &&
        t.inputs.every(
          (i) =>
            record(i) &&
            uuid(i.id) &&
            typeof i.text === 'string' &&
            i.text.length <= 2000 &&
            typeof i.applied === 'boolean' &&
            (i.attempt === undefined || integer(i.attempt)) &&
            (i.resumeAnswer === undefined || typeof i.resumeAnswer === 'boolean'),
        ) &&
        Array.isArray(t.tools) &&
        t.tools.length <= 8 &&
        t.tools.every(
          (i) =>
            record(i) &&
            integer(i.sequence) &&
            typeof i.name === 'string' &&
            ['STARTED', 'succeeded', 'failed'].includes(String(i.status)),
        ) &&
        Array.isArray(t.questions) &&
        t.questions.length <= 1 &&
        t.questions.every(
          (q) =>
            record(q) &&
            uuid(q.id) &&
            typeof q.text === 'string' &&
            q.text.length <= 1000 &&
            typeof q.blocking === 'boolean' &&
            typeof q.answered === 'boolean' &&
            Array.isArray(q.options) &&
            q.options.length <= 5 &&
            q.options.every((x) => typeof x === 'string' && x.length <= 120),
        ),
    )
  );
}
const request = createIdentityRequest();
function root(tenant: string, conversation: string) {
  if (!uuid(tenant) || !uuid(conversation)) throw new IdentityError('INVALID_REQUEST', 400);
  return `/api/v1/tenants/${tenant}/conversations/${conversation}`;
}
export const liveClient = {
  snapshot: (tenant: string, conversation: string, signal: AbortSignal) =>
    request(root(tenant, conversation) + '/live', 'GET', isLiveSnapshot, undefined, signal),
  input: (
    tenant: string,
    conversation: string,
    task: string,
    body: { requestId: string; attempt: number; text: string; questionId?: string },
    signal?: AbortSignal,
  ) => {
    if (!uuid(task)) throw new IdentityError('INVALID_REQUEST', 400);
    return request(
      root(tenant, conversation) + `/tasks/${task}/inputs`,
      'POST',
      (v): v is { accepted: true } => record(v) && v.accepted === true,
      body,
      signal,
    );
  },
  async stream(tenant: string, conversation: string, signal: AbortSignal, update: (v: LiveSnapshot) => void) {
    const response = await fetch(root(tenant, conversation) + '/stream', {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok) throw new IdentityError('UNAVAILABLE', response.status);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
      throw new IdentityError('CONTRACT_MISMATCH');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 3000000) throw new IdentityError('CONTRACT_MISMATCH');
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          if (frame.includes('event: unavailable')) throw new IdentityError('ACCESS_DENIED', 403);
          const data = frame
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const value: unknown = JSON.parse(data);
          if (!isLiveSnapshot(value) || value.conversationId !== conversation)
            throw new IdentityError('CONTRACT_MISMATCH');
          update(value);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
};
