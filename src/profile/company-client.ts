import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const companyFields = {
  NAME: '企业名称',
  INDUSTRY: '所属行业',
  BUSINESS: '主营业务',
  TERM: '业务术语',
} as const;
export type CompanyField = keyof typeof companyFields;
export interface CompanyTag {
  id: string;
  revision: number;
  label: string;
  meaning: string;
  origin: 'HUMAN' | 'AI';
  humanProtected: boolean;
  updatedAt: string;
}
export interface CompanyGroup {
  field: CompanyField;
  revision: number;
  manuallyCleared: boolean;
  tags: CompanyTag[];
}
export interface CompanyInformation {
  tenantId: string;
  canMaintain: boolean;
  groups: CompanyGroup[];
}
export interface CompanyChange {
  requestId: string;
  field: CompanyField;
  expectedRevision: number;
  action: 'ADD' | 'EDIT' | 'REMOVE' | 'CLEAR';
  tagId: string | null;
  label: string;
  meaning: string;
}
export interface CompanySuggestion {
  id: string;
  revision: number;
  field: CompanyField;
  targetId: string | null;
  label: string;
  meaning: string;
  createdAt: string;
  evidence: { chunkId: string; versionId: string; filename: string; locator: string; quote: string }[];
}
export interface CompanyDecision {
  requestId: string;
  expectedRevision: number;
  expectedGroupRevision: number;
  action: 'ADOPT' | 'KEEP';
}
const isSuggestion = (v: unknown): v is CompanySuggestion =>
  record(v) &&
  uuid(v.id) &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) > 0 &&
  Object.hasOwn(companyFields, String(v.field)) &&
  (v.targetId === null || uuid(v.targetId)) &&
  text(v.label) &&
  v.label.length <= 160 &&
  typeof v.meaning === 'string' &&
  v.meaning.length <= 1000 &&
  text(v.createdAt) &&
  Number.isFinite(Date.parse(v.createdAt)) &&
  Array.isArray(v.evidence) &&
  v.evidence.length > 0 &&
  v.evidence.length <= 5 &&
  v.evidence.every(isEvidence);
function isEvidence(e: unknown): e is CompanySuggestion['evidence'][number] {
  return (
    record(e) &&
    uuid(e.chunkId) &&
    uuid(e.versionId) &&
    text(e.filename) &&
    text(e.locator) &&
    text(e.quote) &&
    e.quote.length <= 2000
  );
}
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export const isCompanyInformation = (v: unknown): v is CompanyInformation =>
  record(v) &&
  uuid(v.tenantId) &&
  typeof v.canMaintain === 'boolean' &&
  Array.isArray(v.groups) &&
  v.groups.length === 4 &&
  new Set(v.groups.map((g) => (record(g) ? g.field : null))).size === 4 &&
  v.groups.every(
    (g) =>
      record(g) &&
      Object.hasOwn(companyFields, String(g.field)) &&
      count(g.revision) &&
      typeof g.manuallyCleared === 'boolean' &&
      Array.isArray(g.tags) &&
      g.tags.length <= (g.field === 'NAME' ? 1 : 30) &&
      g.tags.every(
        (t) =>
          record(t) &&
          uuid(t.id) &&
          count(t.revision) &&
          Number(t.revision) > 0 &&
          text(t.label) &&
          t.label.length <= 160 &&
          typeof t.meaning === 'string' &&
          t.meaning.length <= 1000 &&
          ['HUMAN', 'AI'].includes(String(t.origin)) &&
          typeof t.humanProtected === 'boolean' &&
          text(t.updatedAt) &&
          Number.isFinite(Date.parse(t.updatedAt)),
      ),
  );
export function createCompanyClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const root = (tenant: string) => {
    if (!uuid(tenant)) throw new IdentityError('INVALID_REQUEST', 400);
    return `/api/v1/tenants/${tenant}/company-information`;
  };
  return {
    evidence: (tenant: string, tag: string, revision: number, signal?: AbortSignal) => {
      if (!uuid(tag) || !Number.isSafeInteger(revision) || revision < 1)
        throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        root(tenant) + '/tags/' + tag + '/evidence?revision=' + revision,
        'GET',
        (v): v is CompanySuggestion['evidence'] => Array.isArray(v) && v.length <= 5 && v.every(isEvidence),
        undefined,
        signal,
      );
    },
    suggestions: (tenant: string, signal?: AbortSignal) =>
      request(
        root(tenant) + '/suggestions',
        'GET',
        (v): v is CompanySuggestion[] => Array.isArray(v) && v.length <= 100 && v.every(isSuggestion),
        undefined,
        signal,
      ),
    decide: (tenant: string, suggestion: string, body: CompanyDecision, signal?: AbortSignal) => {
      if (!uuid(suggestion)) throw new IdentityError('INVALID_REQUEST', 400);
      return request(
        root(tenant) + '/suggestions/' + suggestion,
        'POST',
        (
          v,
        ): v is {
          requestId: string;
          suggestionId: string;
          action: CompanyDecision['action'];
          revision: number;
        } =>
          record(v) &&
          v.requestId === body.requestId &&
          v.suggestionId === suggestion &&
          v.action === body.action &&
          v.revision === body.expectedRevision + 1,
        body,
        signal,
      );
    },
    get: (tenant: string, signal?: AbortSignal) =>
      request(
        root(tenant),
        'GET',
        (v): v is CompanyInformation => isCompanyInformation(v) && v.tenantId === tenant,
        undefined,
        signal,
      ),
    change: (tenant: string, body: CompanyChange, signal?: AbortSignal) =>
      request(
        root(tenant),
        'POST',
        (
          v,
        ): v is {
          requestId: string;
          field: CompanyField;
          revision: number;
          action: CompanyChange['action'];
          tagId: string | null;
        } =>
          record(v) &&
          v.requestId === body.requestId &&
          v.field === body.field &&
          v.revision === body.expectedRevision + 1 &&
          v.action === body.action &&
          (body.action === 'ADD' ? uuid(v.tagId) : v.tagId === body.tagId),
        body,
        signal,
      ),
  };
}
export const companyClient = createCompanyClient();
