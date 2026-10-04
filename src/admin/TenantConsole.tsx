import { useRef, useState } from 'react';
import { ExternalLink, ArrowLeft, ShieldX } from 'lucide-react';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { adminHref } from './navigation';
import { returnToWorkspaceHref } from '../identity/navigation';
import { useSession } from '../identity/session';
import { governanceClient } from '../governance/client';
import { GovernancePanel, type MemberSelection } from '../governance/GovernancePanel';
import { Failure, Loading, useRemote } from '../shared/admin';
import { Button, Empty } from '../shared/ui';
import { TenantAdminHome, ManagedSpaces } from '../tenant/TenantAdminHome';
import { OperationsPanel } from '../operations/OperationsPanel';
import { BusinessSources } from '../governance/BusinessSources';
import { Profiles } from '../profile/Profiles';
import { LiveLibrary } from '../material/Library';
import { WorkspaceExperiences } from '../experience/WorkspaceExperiences';
import { ObjectLifecycleWorkspace } from '../objectlifecycle/ObjectLifecycleWorkspace';
import { DeparturePanel } from '../departure/DeparturePanel';

export function TenantConsole({ tenant, name }: { tenant: string; name: string }) {
  const { session, logout } = useSession();
  const { page: requestedPage, hash } = useAdminRoute('tenant');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [selection, select] = useState<MemberSelection>({ query: '', page: 0, target: '' });
  const governance = useRemote(
    (signal) => governanceClient.snapshot(tenant, signal),
    [tenant, attempt, session.identity],
  );
  const refresh = () => setAttempt((n) => n + 1);
  const limited = governance.value && !governance.value.canConfigure;
  const page =
    limited && !['members', 'materials', 'experience'].includes(requestedPage) ? 'members' : requestedPage;
  const params = new URLSearchParams(hash.slice(1));
  const secondary =
    params.get('detail') ||
    (['records', 'settings'].includes(params.get('tab') || '') ? params.get('tab') : params.get('manage'));
  const back = useRef(returnToWorkspaceHref(hash, tenant)).current;
  const signOut = async () => {
    try {
      await logout();
    } catch {
      setError('退出结果尚未确认，请重新检查连接。');
    }
  };
  return (
    <AdminShell
      realm="tenant"
      allowedPages={limited ? ['members', 'materials', 'experience'] : undefined}
      name={name}
      account={session.identity?.account.displayName || ''}
      page={page}
      hash={hash}
      logout={() => void signOut()}
      customerLinks={
        <>
          <a className="button ghost" href={back}>
            <ArrowLeft size={16} />
            返回客户端
          </a>
          <a className="button ghost" href={back} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} />
            新标签页打开客户端
          </a>
        </>
      }
    >
      {error && (
        <p className="access-alert" role="alert">
          {error}
        </p>
      )}
      {governance.error ? (
        <Failure error={governance.error} retry={refresh} />
      ) : !governance.value ? (
        <Loading />
      ) : !governance.value.canEnterManagement ? (
        <Empty icon={ShieldX} title="没有企业管理权限" text="管理权限已撤销或尚未授予。">
          <a className="button" href={back}>
            返回客户端
          </a>
          <Button onClick={refresh}>重新检查权限</Button>
        </Empty>
      ) : page === 'overview' ? (
        <AdminOverview
          realm="tenant"
          tenant={tenant}
          hash={hash}
          responsibilityPending={
            governance.value.canAcceptInitialResponsibility || !!governance.value.pendingHandover
          }
        />
      ) : page === 'engine' ? (
        <OperationsPanel scope="tenant" tenant={tenant} />
      ) : page === 'members' ? (
        secondary === 'duties' ? (
          <>
            <a className="button ghost" href={adminHref('tenant', 'members', hash)}>
              返回成员与空间
            </a>
            <GovernancePanel
              tenant={tenant}
              snapshot={governance.value}
              changed={refresh}
              selection={selection}
              select={select}
            />
          </>
        ) : (
          <>
            <div className="admin-secondary-link">
              <a href={adminHref('tenant', 'members', hash, { detail: 'duties' })}>职责与交接</a>
            </div>
            {limited ? <ManagedSpaces tenant={tenant} /> : <TenantAdminHome tenant={tenant} compact />}
          </>
        )
      ) : page === 'database' ? (
        <BusinessSources tenant={tenant} verification={attempt} />
      ) : page === 'materials' ? (
        secondary === 'content-lifecycle' ? (
          <>
            <a className="button ghost" href={adminHref('tenant', 'materials', hash)}>
              返回资料库
            </a>
            <ObjectLifecycleWorkspace tenant={tenant} />
          </>
        ) : (
          <>
            <div className="admin-secondary-link">
              <a href={adminHref('tenant', 'materials', hash, { detail: 'content-lifecycle' })}>回收与清理</a>
            </div>
            <LiveLibrary tenant={tenant} administration />
          </>
        )
      ) : page === 'experience' ? (
        <WorkspaceExperiences tenant={tenant} management={governance.value} readOnly />
      ) : secondary === 'records' ? (
        <>
          <a className="button ghost" href={adminHref('tenant', 'company', hash)}>
            返回企业信息
          </a>
          <TenantAdminHome tenant={tenant} compact initialTab="records" />
        </>
      ) : secondary === 'retention' ? (
        <>
          <a className="button ghost" href={adminHref('tenant', 'company', hash)}>
            返回企业信息
          </a>
          <DeparturePanel tenant={tenant} />
        </>
      ) : (
        <>
          <div className="admin-secondary-link">
            <a href={adminHref('tenant', 'company', hash, { detail: 'records' })}>管理记录</a>
            <a href={adminHref('tenant', 'company', hash, { detail: 'retention' })}>保留与退出</a>
          </div>
          <Profiles tenant={tenant} management={governance.value} />
        </>
      )}
    </AdminShell>
  );
}
