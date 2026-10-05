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
