import { challenge } from '../identity/phone-client';
import { createIdentityRequest, record, text, uuid, isIdentity } from '../identity/client';
import type {
  CustomerAccount,
  AccountDetail,
  PlatformStaff,
  StaffInvitation,
  StaffInvitePreview,
} from '../../contracts/public-api/platform-directory';
export type {
  CustomerAccount,
  AccountDetail,
  PlatformStaff,
  StaffInvitation,
  StaffInvitePreview,
} from '../../contracts/public-api/platform-directory';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const customer = (v: unknown): v is CustomerAccount =>
  record(v) &&
  uuid(v.id) &&
  text(v.displayName) &&
  (v.phone === null || text(v.phone)) &&
  (v.email === null || text(v.email)) &&
  ['ACTIVE', 'DISABLED'].includes(String(v.status)) &&
  count(v.version) &&
  count(v.tenantCount);
const detail = (v: unknown): v is AccountDetail =>
  record(v) &&
  customer(v.account) &&
  Array.isArray(v.memberships) &&
  v.memberships.every(
    (m) =>
      record(m) &&
      uuid(m.tenantId) &&
      text(m.tenantName) &&
      ['TENANT_ADMIN', 'MEMBER'].includes(String(m.role)) &&
      ['ACTIVE', 'DISABLED'].includes(String(m.membershipStatus)) &&
      ['ACTIVE', 'SUSPENDED'].includes(String(m.serviceStatus)),
  ) &&
  Array.isArray(v.records) &&
  v.records.every(
    (r) =>
      record(r) &&
      uuid(r.id) &&
      text(r.actorName) &&
      text(r.reason) &&
      text(r.createdAt) &&
      Number.isFinite(Date.parse(r.createdAt)) &&
      ['ACTIVE', 'DISABLED'].includes(String(r.previousStatus)) &&
      ['ACTIVE', 'DISABLED'].includes(String(r.nextStatus)),
  );
const invitation = (v: unknown): v is StaffInvitation =>
  record(v) &&
  uuid(v.id) &&
  text(v.loginName) &&
  ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(String(v.status)) &&
  text(v.createdAt) &&
  Number.isFinite(Date.parse(v.createdAt)) &&
  text(v.expiresAt) &&
  Number.isFinite(Date.parse(v.expiresAt)) &&
  ['LOCAL', 'DISABLED'].includes(String(v.deliveryMode));
const request = createIdentityRequest();
export const directoryClient = {
  invitations: (signal?: AbortSignal) =>
    request(
      '/api/platform-admin/v1/staff/invitations',
      'GET',
      (v): v is StaffInvitation[] => Array.isArray(v) && v.every(invitation),
      undefined,
      signal,
    ),
  invite: (phone: string, requestId: string) =>
    request('/api/platform-admin/v1/staff/invitations', 'POST', invitation, { phone, requestId }),
  revokeInvite: (id: string, requestId: string) =>
    request(`/api/platform-admin/v1/staff/invitations/${id}/revoke`, 'POST', (v): v is null => v === null, {
      requestId,
    }),
  revokeStaff: (id: string, requestId: string, expectedVersion: number) =>
    request(`/api/platform-admin/v1/staff/${id}/revoke`, 'POST', (v): v is null => v === null, {
      requestId,
      expectedVersion,
    }),
  localLink: (id: string) =>
    request(
      `/api/platform-admin/v1/staff/invitations/${id}/local-link`,
      'GET',
      (v): v is { path: string } =>
        record(v) &&
        typeof v.path === 'string' &&
        /^\/platform-admin\/#invite=[A-Za-z0-9_-]{43}$/.test(v.path),
    ),
  previewInvite: (token: string, signal?: AbortSignal) =>
    request(
      '/api/platform-admin/v1/auth/invitation/preview',
      'POST',
      (v): v is StaffInvitePreview =>
        record(v) && text(v.loginName) && typeof v.existingAccount === 'boolean',
      { token },
      signal,
    ),
  challengeInvite: (token: string) =>
    request('/api/platform-admin/v1/auth/invitation/challenge', 'POST', challenge, { token }),
  acceptInvite: (body: {
    token: string;
    username: string;
    password?: string;
    displayName?: string;
    challengeId?: string;
    code?: string;
  }) => request('/api/platform-admin/v1/auth/invitation/accept', 'POST', isIdentity, body),
  list: (tenant: string, q: string, status: string, offset: number, signal?: AbortSignal) =>
    request(
      `/api/platform-admin/v1/tenants/${tenant}/accounts?` +
        new URLSearchParams({ q, status, offset: String(offset), limit: '21' }),
      'GET',
      (v): v is CustomerAccount[] => Array.isArray(v) && v.every(customer),
      undefined,
      signal,
    ),
  detail: (id: string, signal?: AbortSignal) =>
    request(
      `/api/platform-admin/v1/accounts/${id}`,
      'GET',
      (v): v is AccountDetail => detail(v) && v.account.id === id,
      undefined,
      signal,
    ),
  status: (
    id: string,
    body: { requestId: string; expectedVersion: number; status: string; reason: string },
  ) =>
    request(
      `/api/platform-admin/v1/accounts/${id}/status`,
      'POST',
      (v): v is AccountDetail => detail(v) && v.account.id === id,
      body,
    ),
  staff: (signal?: AbortSignal) =>
    request(
      '/api/platform-admin/v1/staff',
      'GET',
      (v): v is PlatformStaff[] =>
        Array.isArray(v) &&
        v.every(
          (s) =>
            record(s) &&
            uuid(s.id) &&
            text(s.displayName) &&
            text(s.loginName) &&
            ['ACTIVE', 'DISABLED'].includes(String(s.status)) &&
            typeof s.administrator === 'boolean' &&
            count(s.version),
        ),
      undefined,
      signal,
    ),
};
