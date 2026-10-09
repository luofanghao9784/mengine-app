/**
 * 登录接口的接入点。目前都是占位实现：页面、校验、状态切换已经做好，接口尚未接入。
 * 接入时只需要替换这个文件里四个函数的实现，页面组件不用改。
 *
 * 主仓库现有的接口可供对照（以主仓库实际代码为准）：
 *   员工与企业管理员共用客户账号：POST /api/v1/auth/login  { phone, password }
 *   运营平台使用独立账号：        POST /api/platform-admin/v1/auth/login
 *   两者都需要先取 CSRF：          GET  /api/v1/auth/csrf 或 /api/platform-admin/v1/auth/csrf
 */
export type Surface = 'workspace' | 'admin' | 'platform';

export type Credentials =
  | { surface: 'workspace' | 'admin'; phone: string; password: string }
  | { surface: 'platform'; account: string; password: string };

export type AuthResult = { ok: true; redirect?: string; message?: string } | { ok: false; message: string };

const pending = (what: string): Promise<AuthResult> =>
  new Promise((done) => setTimeout(() => done({ ok: false, message: `${what}接口尚未接入。这是设计稿，填写的内容没有被发送。` }), 700));

/** 登录。成功时返回要跳转的地址。 */
export function signIn(_credentials: Credentials): Promise<AuthResult> {
  return pending('登录');
}
/** 找回密码第一步：向手机号发送验证码。 */
export function requestResetCode(_phone: string): Promise<AuthResult> {
  return pending('验证码');
}
/** 找回密码第二步：用验证码设置新密码。 */
export function resetPassword(_phone: string, _code: string, _password: string): Promise<AuthResult> {
  return pending('重置密码');
}
/** 读取企业邀请：参数是邀请链接或邀请码。 */
export function readInvitation(_invitation: string): Promise<AuthResult> {
  return pending('企业邀请');
}
