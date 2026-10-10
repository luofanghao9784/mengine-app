import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { RequestGuard } from '../shared/request-guard';
import { Button, Field } from '../shared/ui';
import { PlatformConsole } from '../admin/PlatformConsole';
import './platform-app.css';
import { PlatformInvitation } from './PlatformStaff';

export function PlatformApp() {
  const { session, login, logout, refresh } = useSession();
  const [invite, setInvite] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('invite') || '',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      setPassword('');
    } catch (e) {
      setError(e instanceof IdentityError ? e.message : '登录未完成，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const signOut = async () => {
    setError('');
    try {
      await logout();
    } catch {
      setError('退出结果尚未确认，请重新检查连接。');
    }
  };
  if (invite)
    return (
      <RequestGuard>
        <PlatformInvitation
          token={invite}
          done={() => {
            window.history.replaceState(null, '', '/platform-admin/#admin=overview');
            setInvite('');
          }}
        />
      </RequestGuard>
    );
  if (session.phase !== 'authenticated')
    return (
      <main className="platform-login">
        <section className="platform-login-card">
          <ShieldCheck size={32} aria-hidden="true" />
          <h1>梦擎总台</h1>
          <p>使用总台专用账号和密码登录</p>
          <a href="/workspace/">手机号统一登录</a>
          {session.phase === 'loading' ? (
            <p role="status">正在检查登录状态…</p>
          ) : session.phase === 'unavailable' ? (
            <>
              <p role="alert">暂时无法连接服务</p>
              <Button onClick={() => void refresh()}>重试</Button>
            </>
          ) : (
            <form onSubmit={submit}>
              <Field label="管理账号">
                <input
                  type="text"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field label="密码">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? '正在登录…' : '登录总台'}
              </Button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      </main>
    );
  if (!session.identity?.platformAdmin)
    return (
      <main className="platform-login">
        <section className="platform-login-card">
          <h1>当前账号没有总台权限</h1>
          <a href="/workspace/">进入工作空间</a>
          <Button onClick={() => void signOut()}>切换账号</Button>
        </section>
      </main>
    );
  return (
    <RequestGuard>
      {error && <p role="alert">{error}</p>}
      <PlatformConsole logout={() => void signOut()} />
    </RequestGuard>
  );
}
