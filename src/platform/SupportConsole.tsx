import { TenantConsole } from '../admin/TenantConsole';
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
  const access = useRemote((signal) => supportClient.read(id, signal), [id, tenant, attempt]);
  const back = `#admin=tenants&enterprise=${encodeURIComponent(tenant)}&section=basic`;
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
  return <TenantConsole key={id} tenant={tenant} name={access.value.name} support={access.value} />;
}
export function SupportEntry({ tenant, enabled }: { tenant: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enter = async () => {
    setBusy(true);
    setError('');
    try {
      const access = await supportClient.enter(tenant);
      location.hash = `admin=overview&tenant=${access.tenant}&support=${access.id}`;
    } catch (e) {
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
