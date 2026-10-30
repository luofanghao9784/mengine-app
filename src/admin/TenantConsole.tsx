import { DocumentCatalog } from './mengine/DocumentCatalog';
import { MaterialGovernance } from '../material/MaterialGovernance';
import { GovernanceProposals } from '../material/GovernanceProposals';
import { WikiSources } from './WikiSources';
import { TenantAudit } from '../tenant/TenantAudit';
import { NativePluginsAdmin } from '../native-conversation/NativePluginsAdmin';
import { SurfaceLinks } from '../identity/SurfaceAccess';
import { NewsSources } from '../news/NewsSources';
import { ExpressionPreferencesPanel } from '../preferences/ExpressionPreferencesPanel';
import './tenant-redesign.css';
import { SupportRecords } from '../platform/SupportRecords';
import type { SupportAccess } from '../platform/SupportConsole';
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
import { UsagePanel } from '../operations/UsagePanel';
import { TenantDatabase } from '../database/TenantDatabase';
import { CompanyInformation } from '../profile/CompanyInformation';
import { TenantMaterials } from '../material/TenantMaterials';
import { TenantExperiences } from '../experience/TenantExperiences';
import { requestNavigationLocked } from '../shared/request-guard';
import { DeparturePanel } from '../departure/DeparturePanel';

export function TenantConsole({
  tenant,
  name,
  support,
  embedded = false,
}: {
  tenant: string;
  name: string;
  support?: SupportAccess;
  embedded?: boolean;
}) {
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
  const limitedPages: AdminPage[] = [
    'members',
    'database',
    'materials',
    'experience',
    'wiki',
    'proposals',
    'catalog',
    'governance',
  ];
  if (
    governance.value?.capabilities.some(
      (c) => ['PROFILE_MAINTAIN', 'TENANT_EXIT'].includes(c.capability) && c.workspaceId === null,
    )
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
      embedded={embedded}
      realm="tenant"
      allowedPages={limited ? limitedPages : undefined}
      name={name}
      account={session.identity?.account.displayName || ''}
      page={page}
      hash={hash}
      logout={() => void signOut()}
      customerLinks={
        support ? (
          <SupportRecords id={support.id} test={support.mode === 'TEST'} />
        ) : (
          <>
            <SurfaceLinks surface="tenant-admin" tenant={tenant} />
            <a className="button ghost" href={back} aria-label="返回工作台" title="返回工作台">
              <ArrowLeft size={16} />
              <span>返回工作台</span>
            </a>
            <a
              className="button ghost"
              href={back}
              aria-label="新标签页打开工作台"
              title="新标签页打开工作台"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              <span>新标签页打开工作台</span>
            </a>
          </>
        )
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
            text="当前账号没有其他企业管理职责，可以返回工作台继续工作。"
          >
            <a className="button" href={back} aria-label="返回工作台" title="返回工作台">
              <span>返回工作台</span>
            </a>
            <Button onClick={refresh}>重新检查权限</Button>
          </Empty>
        </>
      ) : page === 'catalog' ? (
        <DocumentCatalog key={tenant} tenant={tenant} hash={hash} />
      ) : page === 'governance' ? (
        <MaterialGovernance key={tenant} tenant={tenant} />
      ) : page === 'proposals' ? (
        <GovernanceProposals tenant={tenant} />
      ) : page === 'wiki' ? (
        <WikiSources key={tenant} tenant={tenant} />
      ) : page === 'abilities' ? (
        <NativePluginsAdmin key={tenant} tenant={tenant} />
      ) : page === 'audit' ? (
        <TenantAudit key={tenant} tenant={tenant} />
      ) : page === 'overview' ? (
        <AdminOverview
          realm="tenant"
          tenant={tenant}
          hash={hash}
          responsibilityPending={
            governance.value.canAcceptInitialResponsibility || !!governance.value.pendingHandover
          }
        />
      ) : page === 'usage' ? (
        <UsagePanel scope="tenant" tenant={tenant} hash={hash} compact />
      ) : page === 'engine' ? (
        <EngineTelemetryWall scope="tenant" tenant={tenant} />
      ) : page === 'members' ? (
        <div className="admin-dashboard tenant-members-page">
          <nav className="platform-detail-nav" aria-label="成员与空间">
            {[
              ['members', '企业成员'],
              ['invitations', '成员邀请'],
              ['spaces', '共享空间'],
              ['duties', '职责与交接'],
            ]
              .filter(([key]) => !limited || ['spaces', 'duties'].includes(key))
              .map(([key, label]) => (
                <a
                  key={key}
                  className="button ghost"
                  aria-current={
                    (
                      secondary === 'duties'
                        ? key === 'duties'
                        : key === (params.get('tab') || (limited ? 'spaces' : 'members'))
                    )
                      ? 'page'
                      : undefined
                  }
                  onClick={(event) => {
                    if (requestNavigationLocked()) event.preventDefault();
                  }}
                  href={adminHref(
                    'tenant',
                    'members',
                    hash,
                    key === 'duties' ? { detail: 'duties' } : { tab: key },
                  )}
                >
                  {label}
                </a>
              ))}
          </nav>
          {secondary === 'member' && params.get('member') ? (
            <TenantMemberDetail
              key={tenant + params.get('member')}
              tenant={tenant}
              account={params.get('member')!}
              hash={hash}
            />
          ) : secondary === 'duties' ? (
            <GovernancePanel
              tenant={tenant}
              snapshot={governance.value}
              changed={refresh}
              selection={selection}
              select={select}
            />
          ) : limited ? (
            <>
              {governance.value.capabilities.some(
                (c) => c.capability === 'MEMBER_OFFBOARD' && c.workspaceId === null,
              ) && <DeparturePanel tenant={tenant} only="member" />}
              <ManagedSpaces tenant={tenant} />
            </>
          ) : (
            <TenantAdminHome tenant={tenant} compact hideNavigation />
          )}
        </div>
      ) : page === 'database' ? (
        <TenantDatabase key={tenant} tenant={tenant} hash={hash} />
      ) : page === 'materials' ? (
        <TenantMaterials key={tenant} tenant={tenant} hash={hash} />
      ) : page === 'experience' ? (
        <TenantExperiences key={tenant} tenant={tenant} />
      ) : (
        <div className="admin-dashboard tenant-company-page">
          <nav className="platform-detail-nav" aria-label="企业信息栏目">
            {[
              ['background', '企业背景'],
              ...(governance.value.canConfigure ? [['settings', '企业设置']] : []),
              ['preferences', 'AI内容偏好'],
              ...(governance.value.canConfigure ? [['news', '资讯来源']] : []),
              ...(governance.value.canConfigure ? [['records', '管理记录']] : []),
              ...(governance.value.canConfigure ||
              governance.value.capabilities.some(
                (c) => c.capability === 'TENANT_EXIT' && c.workspaceId === null,
              )
                ? [['retention', '保留与退出']]
                : []),
            ].map(([key, label]) => (
              <a
                key={key}
                className="button ghost"
                href={adminHref('tenant', 'company', hash, key === 'background' ? {} : { detail: key })}
                aria-current={
                  key === secondary ||
                  (key === 'background' &&
                    !['preferences', 'records', 'retention', 'settings', 'news'].includes(secondary || ''))
                    ? 'page'
                    : undefined
                }
                onClick={(event) => {
                  if (requestNavigationLocked()) event.preventDefault();
                }}
              >
                <span>{label}</span>
                {embedded && <small>{({ background: '名称、行业、业务与术语', settings: '基础设置与企业配置', preferences: '表达方式与内容重点', news: '资讯渠道与订阅范围', records: '操作历史与管理审计', retention: '数据保留与退出管理' } as Record<string, string>)[key]}</small>}
              </a>
            ))}
          </nav>
          {secondary === 'settings' && governance.value.canConfigure ? (
            <TenantAdminHome
              key={tenant + ':settings'}
              tenant={tenant}
              compact
              hideNavigation
              initialTab="settings"
            />
          ) : secondary === 'news' && governance.value.canConfigure ? (
            <NewsSources key={tenant} tenant={tenant} />
          ) : secondary === 'preferences' ? (
            <ExpressionPreferencesPanel key={tenant} scope="TENANT" tenant={tenant} />
          ) : secondary === 'records' && governance.value.canConfigure ? (
            <TenantAudit key={tenant + ':records'} tenant={tenant} />
          ) : secondary === 'retention' &&
            (governance.value.canConfigure ||
              governance.value.capabilities.some(
                (c) => c.capability === 'TENANT_EXIT' && c.workspaceId === null,
              )) ? (
            <DeparturePanel key={tenant} tenant={tenant} only="exit" />
          ) : (
            <CompanyInformation key={tenant} tenant={tenant} />
          )}
        </div>
      )}
    </AdminShell>
  );
}
