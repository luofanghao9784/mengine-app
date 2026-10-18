import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
import { companyFields, type CompanyField } from './company-client.ts';
export interface BackgroundEntry {
  id: string;
  versionId: string;
  revision: number;
  field: CompanyField;
  label: string;
  meaning: string;
  origin: 'HUMAN' | 'AI';
  humanProtected: boolean;
  provenance: string;
  updatedAt: string;
}
export interface BackgroundSource {
  tenantId: string;
  sourceId: string;
  type: 'COMPANY_BACKGROUND';
  state: 'AVAILABLE' | 'NO_READABLE_ENTRIES';
  version: string;
  knowledgeIntegration: 'PENDING_INTEGRATION' | 'REFERENCE_READY';
  entries: BackgroundEntry[];
}
const entry = (v: unknown): v is BackgroundEntry =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) > 0 &&
  Object.hasOwn(companyFields, String(v.field)) &&
  text(v.label) &&
  typeof v.meaning === 'string' &&
  ['HUMAN', 'AI'].includes(String(v.origin)) &&
  typeof v.humanProtected === 'boolean' &&
  typeof v.provenance === 'string' &&
  text(v.updatedAt) &&
  Number.isFinite(Date.parse(v.updatedAt));
export function createCompanySourceClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    knowledge(tenant: string, signal?: AbortSignal) {
      if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        `/api/v1/tenants/${tenant}/company-information/source/knowledge`,
        'GET',
        (v): v is BackgroundKnowledgePage =>
          record(v) &&
          v.tenantId === tenant &&
          v.mode === 'STRUCTURED_REFERENCE' &&
          Array.isArray(v.items) &&
          v.items.length <= 91 &&
          v.items.every(
            (k) =>
              record(k) &&
              text(k.id) &&
              uuid(k.sourceEntryId) &&
              uuid(k.sourceVersionId) &&
              Number.isSafeInteger(k.revision) &&
              Number(k.revision) > 0 &&
              text(k.title) &&
              typeof k.content === 'string' &&
              ['NAME', 'INDUSTRY', 'BUSINESS', 'TERM'].includes(String(k.field)) &&
              ['HUMAN', 'AI'].includes(String(k.origin)) &&
              k.status === 'REFERENCE_READY' &&
              Array.isArray(k.methods) &&
              k.methods.every(
                (m) =>
                  record(m) &&
                  uuid(m.id) &&
                  Number.isSafeInteger(m.version) &&
                  text(m.name) &&
                  ['REFERENCE_CURRENT', 'REVIEW_REQUIRED'].includes(String(m.status)),
              ),
          ),
        undefined,
        signal,
      );
    },
    get(tenant: string, signal?: AbortSignal) {
      if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        `/api/v1/tenants/${tenant}/company-information/source`,
        'GET',
        (v): v is BackgroundSource =>
          record(v) &&
          v.tenantId === tenant &&
          v.sourceId === `company-background:${tenant}` &&
          v.type === 'COMPANY_BACKGROUND' &&
          typeof v.version === 'string' &&
          /^[a-f0-9]{64}$/.test(v.version) &&
          ['PENDING_INTEGRATION', 'REFERENCE_READY'].includes(String(v.knowledgeIntegration)) &&
          Array.isArray(v.entries) &&
          v.entries.length <= 91 &&
          v.entries.every(entry) &&
          new Set(v.entries.map((e) => e.id)).size === v.entries.length &&
          v.state === (v.entries.length ? 'AVAILABLE' : 'NO_READABLE_ENTRIES'),
        undefined,
        signal,
      );
    },
  };
}
export const companySourceClient = createCompanySourceClient();

export interface BackgroundKnowledgePage {
  tenantId: string;
  mode: 'STRUCTURED_REFERENCE';
  items: {
    id: string;
    sourceEntryId: string;
    sourceVersionId: string;
    revision: number;
    field: CompanyField;
    title: string;
    content: string;
    origin: 'HUMAN' | 'AI';
    status: 'REFERENCE_READY';
    methods: { id: string; version: number; name: string; status: 'REFERENCE_CURRENT' | 'REVIEW_REQUIRED' }[];
  }[];
}
