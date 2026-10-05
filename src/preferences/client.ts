import { createIdentityRequest, record, IdentityError } from '../identity/client';
export const preferenceKeys = ['RESPONSE_LENGTH', 'RESPONSE_FORMAT', 'TONE', 'BRIEFING_ORDER'] as const;
export type PreferenceKey = (typeof preferenceKeys)[number];
export type PreferenceScope = 'GLOBAL' | 'TENANT' | 'PERSONAL';
export interface PreferencePage {
  scope: PreferenceScope;
  canMaintain: boolean;
  settings: Record<PreferenceKey, { choice: string; revision: number; id: string | null }>;
  effective: Record<PreferenceKey, { choice: string; source: string; revision: number }>;
  choices: { category: PreferenceKey; choice: string; label: string }[];
}
const allowed: Record<PreferenceKey, string[]> = {
  RESPONSE_LENGTH: ['CONCISE', 'DETAILED'],
  RESPONSE_FORMAT: ['PARAGRAPHS', 'BULLETS'],
  TONE: ['DIRECT', 'FRIENDLY'],
  BRIEFING_ORDER: ['CONCLUSION_FIRST', 'EVIDENCE_FIRST'],
};
export const isPreferencePage = (v: unknown): v is PreferencePage =>
  record(v) &&
  ['GLOBAL', 'TENANT', 'PERSONAL'].includes(String(v.scope)) &&
  typeof v.canMaintain === 'boolean' &&
  record(v.settings) &&
  record(v.effective) &&
  Array.isArray(v.choices) &&
  v.choices.length === 8 &&
  v.choices.every(
    (c) =>
      record(c) &&
      preferenceKeys.includes(c.category as PreferenceKey) &&
      allowed[c.category as PreferenceKey].includes(String(c.choice)) &&
      typeof c.label === 'string',
  ) &&
  preferenceKeys.every((k) => {
    const s = (v.settings as Record<string, unknown>)[k],
      e = (v.effective as Record<string, unknown>)[k];
    return (
      record(s) &&
      (s.choice === '' || allowed[k].includes(String(s.choice))) &&
      Number.isSafeInteger(s.revision) &&
      Number(s.revision) >= 0 &&
      (s.id === null || typeof s.id === 'string') &&
      record(e) &&
      allowed[k].includes(String(e.choice)) &&
      ['SYSTEM', 'GLOBAL', 'TENANT', 'PERSONAL'].includes(String(e.source)) &&
      Number.isSafeInteger(e.revision) &&
      Number(e.revision) >= 0
    );
  });
export function preferenceClient(scope: PreferenceScope, tenant?: string) {
  const request = createIdentityRequest();
  const path =
    scope === 'GLOBAL'
      ? '/api/platform-admin/v1/expression-preferences'
      : `/api/v1/tenants/${tenant}/profiles/expression-preferences?scope=${scope}`;
  const check = (v: unknown): v is PreferencePage => isPreferencePage(v) && v.scope === scope;
  if (scope !== 'GLOBAL' && !tenant) throw new IdentityError('CONTRACT_MISMATCH');
  return {
    read: (signal?: AbortSignal) => request(path, 'GET', check, undefined, signal),
    save: (
      choices: Record<PreferenceKey, string>,
      expectedRevisions: Record<PreferenceKey, number>,
      requestId: string,
    ) => request(path, 'POST', check, { choices, expectedRevisions, requestId }),
  };
}
