/** Same-origin adapter to the existing customer/platform authentication realms. */
import { createIdentityRequest, isIdentity, IdentityError, record, uuid } from '../../../src/identity/client.ts';
export type Surface = 'workspace' | 'admin' | 'platform';
export type Credentials =
  | { surface: 'workspace' | 'admin'; phone: string; password: string }
  | { surface: 'platform'; account: string; password: string };
export type AuthResult = { ok: true; redirect?: string; message?: string } | { ok: false; message: string };
const request = createIdentityRequest();
const failure = (error: unknown): AuthResult => ({ ok: false, message: error instanceof IdentityError ? error.message : '暂时无法连接服务，请稍后重试。' });
function phone(value: string) {
  const clean = value.trim().replace(/[\s-]/g, '');
  return /^1[3-9][0-9]{9}$/.test(clean) ? '+86' + clean : clean;
}
type Challenge = { id: string; expiresAt: string; retryAfterSeconds: number; delivery: 'LOCAL'; localPreview: boolean };
let reset: { phone: string; challenge: Challenge } | undefined;
let generation = 0;
export async function signIn(credentials: Credentials): Promise<AuthResult> {
  try {
    const platform = credentials.surface === 'platform';
    const identity = await request(platform ? '/api/platform-admin/v1/auth/login' : '/api/v1/auth/login', 'POST', isIdentity,
      credentials.surface === 'platform' ? { username: credentials.account.trim(), password: credentials.password } : { phone: phone(credentials.phone), password: credentials.password });
    if (platform && !identity.platformAdmin) return { ok: false, message: '当前账号没有运营平台访问权限。' };
    if (credentials.surface === 'admin' && !identity.memberships.some(m => m.role === 'TENANT_ADMIN'))
      return { ok: false, message: '当前账号没有企业管理权限，请从梦擎工作空间入口登录。' };
    return { ok: true, redirect: platform ? '/platform-admin/' : credentials.surface === 'admin' ? '/tenant-admin/' : '/workspace/' };
  } catch (error) { return failure(error); }
}
export async function requestResetCode(value: string): Promise<AuthResult> {
  const current = ++generation; reset = undefined;
  const normalized = phone(value);
  try {
    const challenge = await request('/api/v1/auth/phone/challenges', 'POST', (v): v is Challenge =>
      record(v) && uuid(v.id) && typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt)) &&
      Number.isInteger(v.retryAfterSeconds) && Number(v.retryAfterSeconds) > 0 && v.delivery === 'LOCAL' && typeof v.localPreview === 'boolean',
      { purpose: 'RESET', phone: normalized });
    if (current !== generation) return { ok: false, message: '验证码请求已更新，请使用最新一次请求。' };
    reset = { phone: normalized, challenge };
    // The current backend only supports local test delivery. Never claim an SMS was sent.
    return { ok: true, message: '验证码已在测试环境生成，尚未发送短信。请联系管理员获取测试验证码。' };
  } catch (error) { return failure(error); }
}
export async function resetPassword(value: string, code: string, password: string): Promise<AuthResult> {
  const normalized = phone(value), selected = reset;
  if (!selected || selected.phone !== normalized || Date.parse(selected.challenge.expiresAt) <= Date.now())
    return { ok: false, message: '请先为当前手机号获取有效验证码。' };
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, message: '请输入六位验证码。' };
  try {
    await request('/api/v1/auth/phone/reset', 'POST', (v): v is null => v === null,
      { phone: normalized, challengeId: selected.challenge.id, code: code.trim(), password });
    reset = undefined; ++generation;
    return { ok: true, message: '密码已重置，请返回登录并使用新密码。' };
  } catch (error) { return failure(error); }
}
export async function readInvitation(value: string): Promise<AuthResult> {
  try {
    let token = value.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      const url = new URL(token, location.origin);
      if (url.origin !== location.origin || url.username || url.password || !['/workspace/', '/tenant-admin/'].includes(url.pathname))
        return { ok: false, message: '请填写本站的企业邀请链接或有效邀请码。' };
      token = new URLSearchParams(url.hash.slice(1)).get('invite') || '';
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, message: '邀请链接或邀请码无效，请核对后重试。' };
    await request('/api/v1/auth/phone/invitation', 'POST', (v): v is Record<string, unknown> =>
      record(v) && uuid(v.tenantId) && typeof v.tenantName === 'string' && typeof v.phone === 'string' &&
      /^\+[1-9][0-9]{7,14}$/.test(v.phone) && typeof v.maskedPhone === 'string' &&
      ['PENDING', 'ACCEPTED'].includes(String(v.status)) && ['CREATE', 'LOGIN', 'CONFIRM', 'SWITCH'].includes(String(v.action)) &&
      typeof v.designatedOwner === 'boolean', { token });
    // The existing preview endpoint stores a hash in the customer session.
    // Continue with that context; never copy the invitation secret into a redirect.
    return { ok: true, redirect: '/workspace/#invite' };
  } catch (error) { return failure(error); }
}
