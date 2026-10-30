import { useRef, useState, type FormEvent } from 'react';
import { AgentAdminApp } from '../features/agent-admin/AgentAdminApp';
import { Loading } from '../shared/admin';
import { Button, Field } from '../shared/ui';
import { EntryFrame } from './EntryFrame';
import { PasswordField } from './PhoneAuth';
import { IdentityError } from './client';
import { useSession } from './session';

/** Never mount the console (including its static examples) before session validation. */
export function AgentAdminAccess() {
  const { session, login, refresh } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      setPassword('');
      await refresh();
    } catch (e) {
      const status = e instanceof IdentityError ? e.status : 0;
      setError(
        status === 401 || status === 400
          ? '账号或密码不正确'
          : status === 403
            ? '请刷新页面后再试'
            : '暂时无法登录，请稍后再试',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (session.phase === 'authenticated') return <AgentAdminApp />;
  if (session.phase === 'loading') return <Loading />;
  return (
    <EntryFrame label="AI 功能管理台登录">
      <h1>AI 功能管理台</h1>
      <p>使用管理账号和密码登录</p>
      {session.phase === 'unavailable' ? (
        <>
          <p role="alert">暂时无法连接服务，请稍后再试</p>
          <Button onClick={() => void refresh()}>重新连接</Button>
        </>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <Field label="管理账号">
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={254}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <PasswordField value={password} change={setPassword} />
            <Button type="submit" variant="primary" className="full" disabled={busy}>
              {busy ? '正在登录…' : '登录'}
            </Button>
          </fieldset>
          {error && (
            <p className="access-alert" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </EntryFrame>
  );
}
