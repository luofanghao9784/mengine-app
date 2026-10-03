import { useState, useEffect, type FormEvent } from 'react';
import { ShieldCheck, LogOut } from 'lucide-react';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { RequestGuard } from '../shared/request-guard';
import { Button, Field, PageActionsContext } from '../shared/ui';
import { PlatformHome } from './PlatformHome';
import './platform-app.css';

export function PlatformApp() {
  const { session, login, logout, refresh } = useSession();
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => { document.title = '总台 · 梦擎'; }, []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await login(username, password); setPassword(''); }
    catch (e) { setError(e instanceof IdentityError ? e.message : '登录未完成，请重试。'); }
    finally { setBusy(false); }
  }
  const signOut = async () => {
    setError('');
    try { await logout(); } catch { setError('退出结果尚未确认，请重新检查连接。'); }
  };
  if (session.phase !== 'authenticated') return <main className="platform-login">
    <section className="platform-login-card">
      <ShieldCheck size={32} aria-hidden="true" /><h1>梦擎总台</h1>
      <p>使用平台管理账号登录</p>
      {session.phase === 'loading' ? <p role="status">正在检查登录状态…</p> :
        session.phase === 'unavailable' ? <><p role="alert">暂时无法连接服务</p><Button onClick={() => void refresh()}>重试</Button></> :
        <form onSubmit={submit}>
          <Field label="管理账号"><input type="email" autoComplete="username" required maxLength={254} value={username} onChange={e => setUsername(e.target.value)} /></Field>
          <Field label="密码"><input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></Field>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '正在登录…' : '登录总台'}</Button>
        </form>}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
  return <RequestGuard><PageActionsContext.Provider value={actionsTarget}><div className="platform-app">
    <header className="platform-app-header"><div><ShieldCheck aria-hidden="true" /><h1>梦擎总台</h1></div>
      <div><span>{session.identity?.account.displayName}</span><Button icon={LogOut} variant="ghost" onClick={() => void signOut()}>退出总台</Button></div>
    </header>
    {error && <p role="alert">{error}</p>}
    <div className="platform-app-actions" ref={setActionsTarget} /><main className="platform-app-content"><PlatformHome /></main>
  </div></PageActionsContext.Provider></RequestGuard>;
}
