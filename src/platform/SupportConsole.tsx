import { SceneShell } from '../admin/prototype/SceneShell';
import { SupportRecords } from './SupportRecords';
import { useSession } from '../identity/session';
import './support-scene.css';
import { createIdentityRequest, record, text, uuid } from '../identity/client';
import { useRemote, Failure, Loading } from '../shared/admin';
import { useState } from 'react';
import { Button } from '../shared/ui';
export type SupportAccess = {
  id: string;
  actor: string;
  tenant: string;
  owner: string;
  mode: 'ADJUSTMENT' | 'TEST';
  name: string;
};
const request = createIdentityRequest();
const valid = (v: unknown): v is SupportAccess =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.actor) &&
  uuid(v.tenant) &&
  uuid(v.owner) &&
  text(v.name) &&
  ['ADJUSTMENT', 'TEST'].includes(String(v.mode));
export const supportClient = {
  enter: (tenant: string) =>
    request('/api/platform-admin/v1/support-access', 'POST', valid, { tenant, mode: 'ADJUSTMENT' }),
  read: (id: string, signal?: AbortSignal) =>
    request(`/api/platform-admin/v1/support-access/${id}`, 'GET', valid, undefined, signal),
  leave: (id: string) =>
    request(`/api/platform-admin/v1/support-access/${id}`, 'DELETE', (v): v is null => v === null),
};
export function SupportConsole({ id, tenant }: { id: string; tenant: string }) {
  const [attempt, retry] = useState(0);
  const { session } = useSession();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const access = useRemote((signal) => supportClient.read(id, signal), [id, tenant, attempt]);
  const back = `/platform-admin/#admin=tenants&enterprise=${encodeURIComponent(tenant)}&section=basic`;
  if (access.error)
    return (
      <main className="admin-content">
        <Failure error={access.error} retry={() => retry((n) => n + 1)} />
        <a className="button ghost" href={back}>
          返回总台企业概览
        </a>
      </main>
    );
  if (!access.value) return <Loading />;
  if (access.value.tenant !== tenant)
    return (
      <p role="alert">
        总部访问的企业范围不匹配。<a href={back}>返回总台</a>
      </p>
    );
  const leave = async () => {
    setLeaving(true); setLeaveError('');
    try { await supportClient.leave(id); location.assign(back); }
    catch (e) { setLeaveError(e instanceof Error ? e.message : '退出失败，请重试'); setLeaving(false); }
  };
  return <div className="support-scene">
    <header className="support-scene-banner" aria-label="总部支持身份">
      <span>总部支持 · {session.identity?.account.displayName} · {access.value.name} · 按企业负责人权限访问</span>
      <SupportRecords id={id} test={access.value.mode === 'TEST'} />
      <Button disabled={leaving} onClick={() => void leave()}>结束支持并返回总台</Button>
      {leaveError && <span role="alert">{leaveError}</span>}
    </header>
    <SceneShell key={id} tenant={tenant} name={access.value.name} />
  </div>;
}
export function SupportEntry({ tenant, enabled }: { tenant: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enter = async () => {
    if (busy || !enabled) return;
    setError('');
    // Open during the click gesture; awaiting authorization first can trigger popup blocking.
    const target = window.open('about:blank', '_blank');
    if (!target) {
      setError('新标签页未能打开，请允许此站点打开弹出窗口后重试。');
      return;
    }
    target.opener = null;
    target.document.title = '正在进入企业管理端…';
    setBusy(true);
    setError('');
    try {
      const access = await supportClient.enter(tenant);
      if (target.closed) {
        await supportClient.leave(access.id);
        throw new Error('新标签页已关闭，请重新进入。');
      }
      target.location.replace(
        `/tenant-admin/support/#tenant=${access.tenant}&support=${access.id}`,
      );
    } catch (e) {
      target.close();
      setError(e instanceof Error ? e.message : '总部访问暂不可用。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="support-entry">
      <Button disabled={busy || !enabled} onClick={() => void enter()}>
        {busy ? '正在进入…' : '进入企业管理端'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {!enabled && <small>负责人确认后可进入</small>}
    </div>
  );
}
