import { createIdentityRequest, record, text, uuid } from '../identity/client.ts';
import type { ManagementRecord } from '../../contracts/public-api/platform-directory';
export type { ManagementRecord } from '../../contracts/public-api/platform-directory';
const nullableText = (v: unknown) => v === null || text(v);
const nullableId = (v: unknown) => v === null || uuid(v);
const entry = (v: unknown): v is ManagementRecord =>
  record(v) &&
  Number.isSafeInteger(v.id) &&
  Number(v.id) > 0 &&
  ['ENTERPRISE', 'ACCOUNT', 'STAFF', 'SECURITY', 'EXPERIENCE'].includes(String(v.category)) &&
  text(v.action) &&
  ['SUCCESS', 'DENIED'].includes(String(v.outcome)) &&
  nullableId(v.actorId) &&
  nullableText(v.actorName) &&
  nullableId(v.targetId) &&
  nullableText(v.targetName) &&
  nullableId(v.tenantId) &&
  nullableText(v.tenantName) &&
  text(v.createdAt) &&
  Number.isFinite(Date.parse(v.createdAt)) &&
  nullableText(v.internalReason) &&
  nullableText(v.publicReason);
export function createSettingsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    records: (category: string, outcome: string, offset: number, signal?: AbortSignal) =>
      request(
        '/api/platform-admin/v1/records?' +
          new URLSearchParams({ category, outcome, offset: String(offset), limit: '21' }),
        'GET',
        (v): v is ManagementRecord[] => Array.isArray(v) && v.every(entry),
        undefined,
        signal,
      ),
    linkCustomer: (currentPassword: string, phone: string, customerPassword: string) =>
      request('/api/platform-admin/v1/auth/link-customer', 'POST', (v): v is null => v === null, {
        currentPassword,
        phone,
        customerPassword,
      }),
    credentials: () =>
      request(
        '/api/platform-admin/v1/auth/credentials',
        'GET',
        (v): v is { configured: boolean; username: string } =>
          record(v) && typeof v.configured === 'boolean' && typeof v.username === 'string',
      ),
    configureCredentials: (username: string, currentPassword: string, password: string) =>
      request('/api/platform-admin/v1/auth/credentials', 'POST', (v): v is null => v === null, {
        username,
        currentPassword,
        password,
      }),
    password: (currentPassword: string, password: string) =>
      request('/api/platform-admin/v1/auth/password', 'POST', (v): v is null => v === null, {
        currentPassword,
        password,
      }),
  };
}
export const settingsClient = createSettingsClient();
