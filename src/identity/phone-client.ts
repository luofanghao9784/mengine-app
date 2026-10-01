import type { Identity, Membership } from '../../contracts/public-api/identity';
import { createIdentityRequest, isIdentity, isMembership, record, text, uuid } from './client';

export type InvitationPreview = {
  tenantName: string;
  tenantId: string;
  phone: string;
  maskedPhone: string;
  status: 'PENDING' | 'ACCEPTED';
  action: 'CREATE' | 'LOGIN' | 'CONFIRM' | 'SWITCH';
  designatedOwner: boolean;
};
export type Challenge = {
  id: string;
  expiresAt: string;
  retryAfterSeconds: number;
  delivery: 'LOCAL';
  localPreview: boolean;
};
export type Joined = { identity: Identity; membership: Membership };
export type Verification = { phone: string; password: string; challengeId: string; code: string };
export type Join = {
  requestId: string;
  token?: string;
  displayName?: string;
  password?: string;
  challengeId?: string;
  code?: string;
  acceptResponsibility: boolean;
};
const preview = (v: unknown): v is InvitationPreview =>
  record(v) &&
  text(v.tenantName) &&
  uuid(v.tenantId) &&
  typeof v.phone === 'string' &&
  /^\+[1-9][0-9]{7,14}$/.test(v.phone) &&
  text(v.maskedPhone) &&
  ['PENDING', 'ACCEPTED'].includes(String(v.status)) &&
  ['CREATE', 'LOGIN', 'CONFIRM', 'SWITCH'].includes(String(v.action)) &&
  typeof v.designatedOwner === 'boolean';
const challenge = (v: unknown): v is Challenge =>
  record(v) &&
  uuid(v.id) &&
  text(v.expiresAt) &&
  Number.isFinite(Date.parse(v.expiresAt)) &&
  Number.isInteger(v.retryAfterSeconds) &&
  Number(v.retryAfterSeconds) > 0 &&
  v.delivery === 'LOCAL' &&
  typeof v.localPreview === 'boolean';
const joined = (v: unknown): v is Joined => {
  if (!record(v) || !isIdentity(v.identity) || !isMembership(v.membership)) return false;
  const membership = v.membership;
  return v.identity.memberships.some((m) => m.tenantId === membership.tenantId);
};
const request = createIdentityRequest();
const root = '/api/v1/auth/phone';
export const phoneClient = {
  preview: (token?: string) => request(root + '/invitation', 'POST', preview, { token }),
  switchAccount: (token?: string) =>
    request(root + '/switch-account', 'POST', (v): v is null => v === null, { token }),
  challenge: (purpose: 'JOIN' | 'BIND' | 'RESET', phone?: string, token?: string) =>
    request(root + '/challenges', 'POST', challenge, { purpose, phone, token }),
  localCode: (id: string) =>
    request(
      root + '/local-code/' + id,
      'GET',
      (v): v is { mode: 'LOCAL'; code: string } =>
        record(v) && v.mode === 'LOCAL' && typeof v.code === 'string' && /^[0-9]{6}$/.test(v.code),
    ),
  accept: (body: Join) => request(root + '/accept', 'POST', joined, body),
  bind: (body: Verification) => request(root + '/bind', 'POST', isIdentity, body),
  reset: (body: Verification) => request(root + '/reset', 'POST', (v): v is null => v === null, body),
  password: (currentPassword: string, password: string) =>
    request(root + '/password', 'POST', (v): v is null => v === null, { currentPassword, password }),
};
