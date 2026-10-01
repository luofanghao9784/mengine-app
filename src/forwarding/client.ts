import type {
  ForwardSource,
  ForwardPeople,
  ForwardBatch,
  ForwardDelivery,
  ForwardInbox,
  ForwardHistory,
  ForwardRequest,
} from '../../contracts/public-api/forwarding.ts';
import { createIdentityRequest, IdentityError, record, uuid } from '../identity/client.ts';
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const page = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 100000;
const opened = (v: Record<string, unknown>) =>
  (v.state === 'ACCEPTED' && v.openedAt === null) || (v.state === 'OPENED' && date(v.openedAt));
export const isForwardSource = (v: unknown): v is ForwardSource =>
  record(v) &&
  uuid(v.publicationId) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName, 200) &&
  uuid(v.materialId) &&
  uuid(v.materialVersionId) &&
  Number.isSafeInteger(v.materialVersion) &&
  Number(v.materialVersion) > 0 &&
  text(v.filename, 180) &&
  ['docx', 'pdf'].includes(String(v.format)) &&
  typeof v.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(v.sha256) &&
  date(v.publishedAt);
export const isForwardPeople = (v: unknown): v is ForwardPeople =>
  record(v) &&
  isForwardSource(v.source) &&
  Array.isArray(v.items) &&
  v.items.length <= 30 &&
  v.items.every((r) => record(r) && uuid(r.id) && text(r.name, 200)) &&
  typeof v.hasMore === 'boolean';
export const isForwardBatch = (v: unknown): v is ForwardBatch =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.publicationId) &&
  uuid(v.materialVersionId) &&
  uuid(v.requestId) &&
  date(v.acceptedAt) &&
  text(v.note, 500) &&
  isForwardSource(v.source) &&
  v.source.publicationId === v.publicationId &&
  v.source.materialVersionId === v.materialVersionId &&
  Array.isArray(v.recipients) &&
  v.recipients.length >= 1 &&
  v.recipients.length <= 20 &&
  new Set(v.recipients.map((r: unknown) => (record(r) ? r.accountId : undefined))).size ===
    v.recipients.length &&
  new Set(v.recipients.map((r: unknown) => (record(r) ? r.receiptId : undefined))).size ===
    v.recipients.length &&
  v.recipients.every(
    (r) =>
      record(r) &&
      uuid(r.receiptId) &&
      uuid(r.accountId) &&
      text(r.name, 200) &&
      opened(r) &&
      typeof r.currentlyAccessible === 'boolean',
  );
export const isForwardDelivery = (v: unknown): v is ForwardDelivery =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.batchId) &&
  uuid(v.senderId) &&
  text(v.senderName, 200) &&
  date(v.acceptedAt) &&
  opened(v) &&
  text(v.note, 500) &&
  isForwardSource(v.source);
const isInbox = (v: unknown): v is ForwardInbox =>
  record(v) &&
  Array.isArray(v.items) &&
  v.items.length <= 30 &&
  v.items.every(isForwardDelivery) &&
  typeof v.hasMore === 'boolean';
const isHistory = (v: unknown): v is ForwardHistory =>
  record(v) &&
  Array.isArray(v.items) &&
  v.items.length <= 30 &&
  v.items.every(isForwardBatch) &&
  typeof v.hasMore === 'boolean';
export function createForwardingClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
      if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
      return v;
    },
    root = (t: string) => `/api/v1/tenants/${id(t)}/forwarding`;
  const scope = (p: string, v: string, offset: number) => {
    if (!page(offset)) throw new IdentityError('INVALID_REQUEST', 400);
    return new URLSearchParams({ publicationId: id(p), materialVersionId: id(v), offset: String(offset) });
  };
  return {
    async recipients(t: string, p: string, v: string, q = '', offset = 0, signal?: AbortSignal) {
      if (q.length > 100) throw new IdentityError('INVALID_REQUEST', 400);
      const search = scope(p, v, offset);
      search.set('query', q);
      const result = await request(
        root(t) + '/recipients?' + search,
        'GET',
        isForwardPeople,
        undefined,
        signal,
      );
      if (result.source.publicationId !== p || result.source.materialVersionId !== v)
        throw new IdentityError('CONTRACT_MISMATCH');
      return result;
    },
    async send(t: string, body: ForwardRequest, key: string) {
      id(body.publicationId);
      id(body.materialVersionId);
      id(key);
      if (
        !body.recipients.length ||
        body.recipients.length > 20 ||
        new Set(body.recipients).size !== body.recipients.length ||
        !body.recipients.every(uuid) ||
        body.note.length > 500
      )
        throw new IdentityError('INVALID_REQUEST', 400);
      const value = await request(root(t) + '/batches', 'POST', isForwardBatch, { ...body, requestId: key });
      if (
        value.requestId !== key ||
        value.publicationId !== body.publicationId ||
        value.materialVersionId !== body.materialVersionId ||
        [...value.recipients.map((r) => r.accountId)].sort().join() !== [...body.recipients].sort().join()
      )
        throw new IdentityError('CONTRACT_MISMATCH');
      return value;
    },
    async batch(t: string, b: string, signal?: AbortSignal) {
      const result = await request(root(t) + '/batches/' + id(b), 'GET', isForwardBatch, undefined, signal);
      if (result.id !== b) throw new IdentityError('CONTRACT_MISMATCH');
      return result;
    },
    async history(t: string, p: string, v: string, offset = 0, signal?: AbortSignal) {
      const result = await request(
        root(t) + '/batches?' + scope(p, v, offset),
        'GET',
        isHistory,
        undefined,
        signal,
      );
      if (result.items.some((r) => r.publicationId !== p || r.materialVersionId !== v))
        throw new IdentityError('CONTRACT_MISMATCH');
      return result;
    },
    inbox(t: string, offset = 0, signal?: AbortSignal) {
      if (!page(offset)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(root(t) + '/inbox?offset=' + offset, 'GET', isInbox, undefined, signal);
    },
    async open(t: string, r: string, key: string) {
      const v = await request(root(t) + '/inbox/' + id(r) + '/open', 'POST', isForwardDelivery, {
        requestId: id(key),
      });
      if (v.id !== r || v.state !== 'OPENED') throw new IdentityError('CONTRACT_MISMATCH');
      return v;
    },
  };
}
export const forwardingClient = createForwardingClient();
