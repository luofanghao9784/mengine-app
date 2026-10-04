import { EngineTelemetryWall } from '../operations/EngineTelemetryWall';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ArrowLeft, ShieldX } from 'lucide-react';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { adminHref, type AdminPage } from './navigation';
import { returnToWorkspaceHref } from '../identity/navigation';
import { useSession } from '../identity/session';
import { governanceClient } from '../governance/client';
import { GovernancePanel, type MemberSelection } from '../governance/GovernancePanel';
import { Failure, Loading, useRemote } from '../shared/admin';
import { Button, Empty } from '../shared/ui';
import { TenantAdminHome, ManagedSpaces } from '../tenant/TenantAdminHome';
import { TenantMemberDetail } from '../tenant/TenantMemberDetail';
import { OperationsPanel } from '../operations/OperationsPanel';
import { TenantDatabase } from '../database/TenantDatabase';
import { CompanyInformation } from '../profile/CompanyInformation';
import { TenantMaterials } from '../material/TenantMaterials';
import { TenantExperiences } from '../experience/TenantExperiences';
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
  const limitedPages: AdminPage[] = ['members', 'database', 'materials', 'experience'];
  if (
    governance.value?.capabilities.some((c) => c.capability === 'PROFILE_MAINTAIN' && c.workspaceId === null)
  )
    limitedPages.push('company');
  const page = limited && !limitedPages.includes(requestedPage) ? 'members' : requestedPage;
  const params = new URLSearchParams(hash.slice(1));
  const secondary =
    params.get('detail') ||
    (['records', 'settings'].includes(params.get('tab') || '') ? params.get('tab') : params.get('manage'));
  const selectedAccount = secondary === 'duties' ? params.get('member') : null;
  useEffect(() => {
    if (selectedAccount) select({ query: '', page: 0, target: selectedAccount });
  }, [selectedAccount]);
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
      allowedPages={limited ? limitedPages : undefined}
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
        <>
          {governance.value.latestHandover && (
            <p role="status">
              交接
              {
                {
                  ACCEPTED: '已接受',
                  REJECTED: '已拒绝，原负责人继续负责',
                  CANCELLED: '已撤销，原负责人继续负责',
                }[governance.value.latestHandover.status]
              }
              。
            </p>
          )}
          <Empty
            icon={ShieldX}
            title="没有企业管理权限"
            text="当前账号没有其他企业管理职责，可以返回客户端继续工作。"
          >
            <a className="button" href={back}>
              返回客户端
            </a>
            <Button onClick={refresh}>重新检查权限</Button>
          </Empty>
        </>
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
        secondary === 'usage' ? (
          <>
            <a className="button ghost" href={adminHref('tenant', 'engine', hash)}>
              返回引擎运行
            </a>
            <OperationsPanel scope="tenant" tenant={tenant} />
          </>
        ) : (
          <>
            <div className="admin-secondary-link">
              <a href={adminHref('tenant', 'engine', hash, { detail: 'usage' })}>查看本企业用量</a>
            </div>
            <EngineTelemetryWall scope="tenant" tenant={tenant} />
          </>
        )
      ) : page === 'members' ? (
        secondary === 'member' && params.get('member') ? (
          <TenantMemberDetail
            key={params.get('member')}
            tenant={tenant}
            account={params.get('member')!}
            hash={hash}
          />
        ) : secondary === 'duties' ? (
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
            {limited ? (
              <>
                {governance.value.capabilities.some(
                  (c) => c.capability === 'MEMBER_OFFBOARD' && c.workspaceId === null,
                ) && <DeparturePanel tenant={tenant} only="member" />}
                <ManagedSpaces tenant={tenant} />
              </>
            ) : (
              <TenantAdminHome tenant={tenant} compact />
            )}
          </>
        )
      ) : page === 'database' ? (
        <TenantDatabase key={tenant} tenant={tenant} hash={hash} />
      ) : page === 'materials' ? (
        <TenantMaterials key={tenant} tenant={tenant} hash={hash} />
      ) : page === 'experience' ? (
        <TenantExperiences key={tenant} tenant={tenant} />
      ) : secondary === 'records' && governance.value.canConfigure ? (
        <>
          <a className="button ghost" href={adminHref('tenant', 'company', hash)}>
            返回企业信息
          </a>
          <TenantAdminHome tenant={tenant} compact initialTab="records" />
        </>
      ) : secondary === 'retention' && governance.value.canConfigure ? (
        <>
          <a className="button ghost" href={adminHref('tenant', 'company', hash)}>
            返回企业信息
          </a>
          <DeparturePanel tenant={tenant} only="exit" />
        </>
      ) : (
        <>
          {governance.value.canConfigure && (
            <div className="admin-secondary-link">
              <a href={adminHref('tenant', 'company', hash, { detail: 'records' })}>管理记录</a>
              <a href={adminHref('tenant', 'company', hash, { detail: 'retention' })}>保留与退出</a>
            </div>
          )}
          <CompanyInformation tenant={tenant} />
        </>
      )}
    </AdminShell>
  );
}
