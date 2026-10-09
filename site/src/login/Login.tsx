import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { DreamcoreLogo } from '@dreamcore/src/components/DreamcoreLogo';
import { PasswordField } from '@dreamcore/src/identity/PhoneAuth';
import { Button, Field } from '@dreamcore/src/shared/ui';
import { Nebula } from '../engine/Nebula';
import { readInvitation, requestResetCode, resetPassword, signIn, type AuthResult, type Surface } from './auth';

/* 登录页只用产品自己的组件：标志、输入框、按钮、卡片，都来自主仓库。 */
const copy: Record<Surface, { title: string; hint: string }> = {
  workspace: { title: '登录', hint: '使用手机号和密码，继续你的工作。' },
  admin: { title: '登录企业管理端', hint: '和梦擎工作空间是同一个账号，需要有企业的管理权限。' },
  platform: { title: '登录运营平台', hint: '使用平台管理账号登录。' },
};

const doors: [Surface, string, string][] = [
  ['workspace', '梦擎工作空间', './index.html'],
  ['admin', '企业管理端', './admin.html'],
  ['platform', '运营平台', './platform.html'],
];

const validPhone = (v: string) => /^\+?\d{6,15}$/.test(v.replace(/[\s-]/g, ''));

/** 产品按 html 上的这个属性切换三个端的主题。 */
const themeOf: Record<Surface, string> = { workspace: 'workspace', admin: 'tenant-admin', platform: 'platform-admin' };
const titleOf: Record<Surface, string> = { workspace: '登录 · 梦擎工作空间', admin: '登录 · 企业管理端', platform: '登录 · 运营平台' };
const surfaceOfPath = (path: string): Surface => (path.endsWith('/admin.html') ? 'admin' : path.endsWith('/platform.html') ? 'platform' : 'workspace');

export function Login({ surface: initial }: { surface: Surface }) {
  // 三个端各有自己的地址，但切换时不重新加载页面，背景才能平滑过渡。
  const [surface, setSurface] = useState<Surface>(initial);
  const customer = surface !== 'platform';
  const [mode, setMode] = useState<'login' | 'reset' | 'invite'>('login');
  const [phone, setPhone] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [invitation, setInvitation] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);

  const run = async (work: () => Promise<AuthResult>) => {
    setBusy(true);
    setResult(null);
    const r = await work();
    setBusy(false);
    setResult(r);
    if (r.ok && r.redirect) location.assign(r.redirect);
  };
  const fail = (message: string) => setResult({ ok: false, message });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'invite') return void run(() => readInvitation(invitation.trim()));
    if (customer && !validPhone(phone)) return fail('请填写正确的手机号。海外号码请带上国家区号。');
    if (password.length < 6) return fail('密码至少 6 位。');
    if (mode === 'reset') return void run(() => resetPassword(phone, code, password));
    void run(() => signIn(surface === 'platform' ? { surface, account: account.trim(), password } : { surface, phone, password }));
  };
  const sendCode = () => (validPhone(phone) ? void run(() => requestResetCode(phone)) : fail('请先填写正确的手机号。'));
  const go = (next: typeof mode) => {
    setMode(next);
    setResult(null);
  };
  useEffect(() => {
    document.documentElement.dataset.surface = themeOf[surface];
    document.title = titleOf[surface];
  }, [surface]);
  useEffect(() => {
    const back = () => {
      setSurface(surfaceOfPath(location.pathname));
      go('login');
    };
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  const switchTo = (e: MouseEvent<HTMLAnchorElement>, next: Surface, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (next === surface) return;
    history.pushState(null, '', href);
    setSurface(next);
    setPassword('');
    go('login');
  };

  return (
    <main className="access-auth-layout login-page">
      <div className="login-sky" aria-hidden="true">
        {doors.map(([key]) => (
          <i key={key} data-sky={key} data-on={surface === key || undefined}>
            {key === 'platform' && <Nebula active={surface === 'platform'} />}
          </i>
        ))}
      </div>
      <a className="access-wordmark" href="../index.html" aria-label="返回官网">
        <DreamcoreLogo wordmark />
      </a>
      <nav className="login-tabs" aria-label="选择登录入口">
        {doors.map(([key, name, href]) => (
          <a key={key} href={href} aria-current={surface === key ? 'page' : undefined} onClick={(e) => switchTo(e, key, href)}>{name}</a>
        ))}
      </nav>
      <section className="access-auth-card" aria-label="账号登录">
        <h1>{mode === 'reset' ? '找回密码' : mode === 'invite' ? '加入企业' : copy[surface].title}</h1>
        <p>{mode === 'reset' ? '验证手机号后设置新密码。' : mode === 'invite' ? '填写收到的邀请链接或邀请码。' : copy[surface].hint}</p>
        <form onSubmit={submit} noValidate>
          {mode === 'invite' ? (
            <Field label="邀请链接或邀请码">
              <input value={invitation} onChange={(e) => setInvitation(e.target.value)} required />
            </Field>
          ) : (
            <>
              {customer ? (
                <Field label="手机号">
                  <input type="tel" name="phone" inputMode="tel" autoComplete="tel" placeholder="手机号，海外号码请带国家区号" maxLength={40} required value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
              ) : (
                <Field label="管理账号">
                  <input type="text" autoComplete="username" required maxLength={254} value={account} onChange={(e) => setAccount(e.target.value)} />
                </Field>
              )}
              {mode === 'reset' && (
                <Field label="短信验证码">
                  <div className="phone-password">
                    <input aria-label="短信验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} />
                    <button type="button" onClick={sendCode} disabled={busy}>获取验证码</button>
                  </div>
                </Field>
              )}
              <PasswordField value={password} change={setPassword} label={mode === 'reset' ? '设置密码' : '密码'} creating={mode === 'reset'} />
            </>
          )}
          {result && <p className="login-result" role={result.ok ? 'status' : 'alert'} data-ok={result.ok || undefined}>{result.message}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '请稍候…' : mode === 'reset' ? '重置密码' : mode === 'invite' ? '继续' : '登录'}
          </Button>
        </form>
        {customer && (
          <div className="access-auth-links">
            {mode === 'login' ? (
              <>
                <Button variant="ghost" onClick={() => go('reset')}>忘记密码</Button>
                <Button variant="ghost" onClick={() => go('invite')}>我收到企业邀请</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => go('login')}>返回登录</Button>
            )}
          </div>
        )}
      </section>
      <a className="login-home" href="../index.html">返回官网</a>
    </main>
  );
}
