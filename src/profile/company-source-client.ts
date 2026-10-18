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
  knowledgeIntegration: 'PENDING_INTEGRATION';
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
          v.knowledgeIntegration === 'PENDING_INTEGRATION' &&
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
