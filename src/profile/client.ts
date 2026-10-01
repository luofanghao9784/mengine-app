import type {
  CreateProfile,
  ProfilePage,
  ProfileEntryInfo,
  ProfileHistory,
  ProfileVersionInfo,
  ProfileScope,
  ProfileValue,
  SaveProfile,
  WithdrawProfile,
} from '../../contracts/public-api/profile.ts';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const kindLabels = { FACT: '事实', INFERENCE: '推断', GOAL: '目标', PREFERENCE: '偏好' } as const;
export const statusLabels = {
  ACTIVE: '生效',
  PROPOSED: '待确认',
  WITHDRAWN: '已撤回',
  EXPIRED: '已过期',
} as const;
export const isProfile = (v: unknown): v is ProfileValue =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  uuid(v.tenantId) &&
  uuid(v.subjectId) &&
  ['TENANT', 'WORKSPACE', 'PERSONAL'].includes(String(v.scope)) &&
  Object.hasOwn(kindLabels, String(v.kind)) &&
  text(v.key) &&
  text(v.value) &&
  text(v.provenance) &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) > 0 &&
  ['ACTIVE', 'PROPOSED', 'WITHDRAWN'].includes(String(v.status)) &&
  Object.hasOwn(statusLabels, String(v.effectiveStatus)) &&
  (v.expiresAt === null || (text(v.expiresAt) && Number.isFinite(Date.parse(v.expiresAt)))) &&
  uuid(v.changedBy) &&
  text(v.changedAt) &&
  Number.isFinite(Date.parse(v.changedAt));
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const isEntry = (v: unknown): v is ProfileEntryInfo =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.versionId) &&
  text(v.key) &&
  Object.hasOwn(kindLabels, String(v.kind)) &&
  positive(v.revision) &&
  typeof v.bodyAvailable === 'boolean';
const isVersionInfo = (v: unknown): v is ProfileVersionInfo =>
  record(v) &&
  uuid(v.versionId) &&
  positive(v.revision) &&
  typeof v.current === 'boolean' &&
  typeof v.bodyAvailable === 'boolean' &&
  ['ACTIVE', 'PROPOSED', 'WITHDRAWN'].includes(String(v.status)) &&
  Object.hasOwn(statusLabels, String(v.effectiveStatus)) &&
  (v.expiresAt === null || (text(v.expiresAt) && Number.isFinite(Date.parse(v.expiresAt)))) &&
  text(v.changedAt) &&
  Number.isFinite(Date.parse(v.changedAt)) &&
  !Object.hasOwn(v, 'value') &&
  !Object.hasOwn(v, 'provenance');
const entriesMatch = (items: ProfileValue[], entries: ProfileEntryInfo[]) =>
  entries.every(
    (e) =>
      e.bodyAvailable ===
      items.some((p) => p.id === e.id && p.versionId === e.versionId && p.revision === e.revision),
  ) && items.every((p) => entries.some((e) => e.id === p.id && e.bodyAvailable));
const id = (v: string) => {
  if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
  return v;
};
export function createProfileClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher),
    root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/profiles`;
  const scoped =
    (tenant: string, scope: ProfileScope, subject: string) =>
    (v: unknown): v is ProfileValue =>
      isProfile(v) && v.tenantId === tenant && v.scope === scope && v.subjectId === subject;
  const entry =
    (tenant: string, entry: string) =>
    (v: unknown): v is ProfileValue =>
      isProfile(v) && v.tenantId === tenant && v.id === entry;
  return {
    list: (tenant: string, scope: ProfileScope, subject: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `/${scope}/${id(subject)}?offset=${offset}&limit=20`,
        'GET',
        (v): v is ProfilePage =>
          record(v) &&
          v.tenantId === tenant &&
          v.scope === scope &&
          v.subjectId === subject &&
          typeof v.canMaintain === 'boolean' &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.every(scoped(tenant, scope, subject)) &&
          Array.isArray(v.entries) &&
          v.entries.every(isEntry) &&
          v.entries.length <= 20 &&
          new Set(v.entries.map((e) => e.id)).size === v.entries.length &&
          new Set(v.items.map((e) => e.id)).size === v.items.length &&
          entriesMatch(v.items, v.entries),
        undefined,
        signal,
      ),
    create: (tenant: string, scope: ProfileScope, subject: string, body: CreateProfile) =>
      request(root(tenant) + `/${scope}/${id(subject)}`, 'POST', scoped(tenant, scope, subject), body),
    get: (tenant: string, profile: string, version?: number, signal?: AbortSignal) =>
      request(
        root(tenant) + `/entries/${id(profile)}` + (version === undefined ? '' : `?version=${version}`),
        'GET',
        (v): v is ProfileValue =>
          entry(tenant, profile)(v) && (version === undefined || v.revision === version),
        undefined,
        signal,
      ),
    save: (tenant: string, profile: string, body: SaveProfile) =>
      request(root(tenant) + `/entries/${id(profile)}/versions`, 'POST', entry(tenant, profile), body),
    withdraw: (tenant: string, profile: string, body: WithdrawProfile) =>
      request(
        root(tenant) + `/entries/${id(profile)}/withdraw`,
        'POST',
        (v): v is ProfileValue => entry(tenant, profile)(v) && v.status === 'WITHDRAWN',
        body,
      ),
    history: (tenant: string, profile: string, offset = 0, signal?: AbortSignal) =>
      request(
        root(tenant) + `/entries/${id(profile)}/versions?offset=${offset}&limit=20`,
        'GET',
        (v): v is ProfileHistory =>
          record(v) &&
          typeof v.canMaintain === 'boolean' &&
          typeof v.hasMore === 'boolean' &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every(isVersionInfo) &&
          new Set(v.items.map((x) => x.versionId)).size === v.items.length &&
          new Set(v.items.map((x) => x.revision)).size === v.items.length,
        undefined,
        signal,
      ),
  };
}
export const profileClient = createProfileClient();
