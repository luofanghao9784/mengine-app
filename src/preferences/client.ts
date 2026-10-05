import { createIdentityRequest, record, IdentityError } from '../identity/client';
export type PreferenceScope = 'GLOBAL' | 'TENANT' | 'PERSONAL';
export interface PreferenceRuleRecord {
  id: string;
  rule: string | null;
  origin: 'MANUAL' | 'CONVERSATION';
  provenance: string | null;
  state: 'EFFECTIVE' | 'SUPERSEDED' | 'WITHDRAWN' | 'EXPIRED' | 'UNAVAILABLE' | 'RECORDED';
  revision: number;
  recordedAt: string;
}
export interface PreferenceRecords {
  scope: PreferenceScope;
  items: PreferenceRuleRecord[];
  hasMore: boolean;
}
export const isPreferenceRecords = (v: unknown): v is PreferenceRecords =>
  record(v) &&
  ['GLOBAL', 'TENANT', 'PERSONAL'].includes(String(v.scope)) &&
  typeof v.hasMore === 'boolean' &&
  Array.isArray(v.items) &&
  v.items.length <= 100 &&
  v.items.every(
    (r) =>
      record(r) &&
      typeof r.id === 'string' &&
      (r.rule === null || typeof r.rule === 'string') &&
      (r.provenance === null || typeof r.provenance === 'string') &&
      ['MANUAL', 'CONVERSATION'].includes(String(r.origin)) &&
      ['EFFECTIVE', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED', 'UNAVAILABLE', 'RECORDED'].includes(
        String(r.state),
      ) &&
      Number.isSafeInteger(r.revision) &&
      Number(r.revision) > 0 &&
      typeof r.recordedAt === 'string' &&
      Number.isFinite(Date.parse(r.recordedAt)),
  );

export function preferenceClient(scope: PreferenceScope, tenant?: string) {
  const request = createIdentityRequest();
  if (scope !== 'GLOBAL' && !tenant) throw new IdentityError('CONTRACT_MISMATCH');
  const path =
    scope === 'GLOBAL'
      ? '/api/platform-admin/v1/expression-preferences/records'
      : `/api/v1/tenants/${tenant}/profiles/expression-preferences/records`;
  return {
    records: (offset = 0, signal?: AbortSignal) =>
      request(
        path +
          '?' +
          new URLSearchParams({
            ...(scope === 'GLOBAL' ? {} : { scope }),
            offset: String(offset),
            limit: '20',
          }),
        'GET',
        (v): v is PreferenceRecords => isPreferenceRecords(v) && v.scope === scope,
        undefined,
        signal,
      ),
  };
}

export interface RuleBook {
  target: 'ALL' | 'BRIEFING' | 'TOPICS';
  body: string;
  revision: number;
  id: string | null;
}
export interface RuleBooks {
  scope: PreferenceScope;
  canMaintain: boolean;
  books: RuleBook[];
  effectiveRules: (Omit<RuleBook, 'id'> & { source: PreferenceScope })[];
}
const isRuleBooks = (v: unknown): v is RuleBooks =>
  record(v) &&
  ['GLOBAL', 'TENANT', 'PERSONAL'].includes(String(v.scope)) &&
  typeof v.canMaintain === 'boolean' &&
  Array.isArray(v.effectiveRules) &&
  v.effectiveRules.length <= 9 &&
  v.effectiveRules.every(
    (r: unknown) =>
      record(r) &&
      ['ALL', 'BRIEFING', 'TOPICS'].includes(String(r.target)) &&
      ['GLOBAL', 'TENANT', 'PERSONAL'].includes(String(r.source)) &&
      typeof r.body === 'string' &&
      r.body.length <= 4000 &&
      Number.isSafeInteger(r.revision) &&
      Number(r.revision) > 0,
  ) &&
  Array.isArray(v.books) &&
  v.books.length === 3 &&
  new Set(v.books.map((b: unknown) => (record(b) ? b.target : ''))).size === 3 &&
  v.books.every(
    (b: unknown) =>
      record(b) &&
      ['ALL', 'BRIEFING', 'TOPICS'].includes(String(b.target)) &&
      typeof b.body === 'string' &&
      b.body.length <= 4000 &&
      Number.isSafeInteger(b.revision) &&
      Number(b.revision) >= 0 &&
      (b.id === null || typeof b.id === 'string'),
  );
export function ruleBookClient(scope: PreferenceScope, tenant?: string) {
  if (scope !== 'GLOBAL' && !tenant) throw new IdentityError('CONTRACT_MISMATCH');
  const valid = (value: unknown): value is RuleBooks => isRuleBooks(value) && value.scope === scope;
  const request = createIdentityRequest();
  const path =
    scope === 'GLOBAL'
      ? '/api/platform-admin/v1/expression-preferences/books'
      : `/api/v1/tenants/${tenant}/profiles/expression-preferences/books?scope=${scope}`;
  return {
    read: (signal?: AbortSignal) => request(path, 'GET', valid, undefined, signal),
    save: (body: { target: RuleBook['target']; body: string; expectedRevision: number }, requestId: string) =>
      request(path, 'POST', valid, { ...body, requestId }),
  };
}
