import { createIdentityRequest, record, text } from '../identity/client.ts';
import type {
  PresentationDraft,
  PresentationSpec,
  PresentationConfirmation,
} from '../../contracts/public-api/presentation';
const request = createIdentityRequest();
const base = (tenant: string) => `/api/v1/tenants/${encodeURIComponent(tenant)}/conversations`;
const path = (tenant: string, conversation: string, task: string) =>
  `${base(tenant)}/${encodeURIComponent(conversation)}/tasks/${encodeURIComponent(task)}/presentation`;
const spec = (v: unknown): v is PresentationSpec =>
  record(v) &&
  text(v.title) &&
  ['ocean', 'ink'].includes(String(v.theme)) &&
  Array.isArray(v.slides) &&
  v.slides.length > 0 &&
  v.slides.length <= 8 &&
  v.slides.every(
    (s) =>
      record(s) &&
      text(s.title) &&
      Array.isArray(s.sourceIds) &&
      ((s.kind === 'cover' && (s.subtitle === undefined || text(s.subtitle))) ||
        (s.kind === 'bullets' && Array.isArray(s.bullets) && s.bullets.every(text)) ||
        (s.kind === 'table' &&
          Array.isArray(s.headers) &&
          s.headers.every(text) &&
          Array.isArray(s.rows) &&
          s.rows.every((r) => Array.isArray(r) && r.every(text))) ||
        (s.kind === 'chart' &&
          Array.isArray(s.labels) &&
          s.labels.every(text) &&
          Array.isArray(s.values) &&
          s.values.every((n) => typeof n === 'number' && Number.isFinite(n)))),
  );
export const isPresentationDraft = (v: unknown): v is PresentationDraft =>
  record(v) &&
  (v.state === 'NONE' ||
    (['REQUESTED', 'DRAFT', 'CONFIRMED'].includes(String(v.state)) &&
      Number.isSafeInteger(v.revision) &&
      (v.state === 'REQUESTED' ? v.spec === null : spec(v.spec))));
export const presentationClient = {
  capability: (tenant: string, signal?: AbortSignal) =>
    request(
      base(tenant) + '/presentation-capability',
      'GET',
      (v): v is { available: boolean } => record(v) && typeof v.available === 'boolean',
      undefined,
      signal,
    ),
  read: (tenant: string, conversation: string, task: string, signal?: AbortSignal) =>
    request(path(tenant, conversation, task), 'GET', isPresentationDraft, undefined, signal),
  confirm: (
    tenant: string,
    conversation: string,
    task: string,
    body: PresentationConfirmation,
    requestId: string,
  ) =>
    request(
      path(tenant, conversation, task) + '/confirm',
      'POST',
      (v): v is { conversation: { id: string } } =>
        record(v) && record(v.conversation) && v.conversation.id === conversation,
      { ...body, requestId },
    ),
};
