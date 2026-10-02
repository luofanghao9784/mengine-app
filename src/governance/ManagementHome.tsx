import { BusinessSources } from './BusinessSources';
import { WorkConfiguration } from './WorkConfiguration';
import { OperationsPanel } from '../operations/OperationsPanel';
import { DeparturePanel } from '../departure/DeparturePanel';
import { ObjectLifecycleWorkspace } from '../objectlifecycle/ObjectLifecycleWorkspace';
import { EvaluationWorkspace } from '../evaluation/EvaluationWorkspace';
import { MethodWorkbench } from '../methods/MethodWorkbench';
import { RetentionPanel } from '../retention/RetentionPanel';
import { MaterialCleanupStatus } from '../lifecycle/MaterialMaintenance';
import { libraryHref } from '../material/Library';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { useContext, useEffect } from 'react';
import { Attention } from '../attention/Attention';
import { featureEntries } from '../shared/feature-entries';
import { WorkspaceExperiences } from '../experience/WorkspaceExperiences';
import { useState } from 'react';
import { useSession } from '../identity/session';
import { Building2 } from 'lucide-react';
import { TenantAdminHome } from '../tenant/TenantAdminHome';
import { Profiles } from '../profile/Profiles';
import { Button, Empty, Modal } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { governanceClient } from './client';
import { GovernancePanel, type MemberSelection } from './GovernancePanel';
type ManagementTab =
  | 'business'
  | 'duties'
  | 'profiles'
  | 'experiences'
  | 'attention'
  | 'evaluation'
  | 'methods'
  | 'retention'
  | 'content-lifecycle'
  | 'sources'
  | 'configuration'
  | 'operations';
const managementTabs: ManagementTab[] = [
  'business',
  'duties',
  'profiles',
  'experiences',
  'attention',
  'evaluation',
  'methods',
  'retention',
  'content-lifecycle',
  'sources',
  'configuration',
  'operations',
];
function readManagementTab(): ManagementTab {
  const tab = new URLSearchParams(location.hash.slice(1)).get('manage');
  return managementTabs.includes(tab as ManagementTab) ? (tab as ManagementTab) : 'business';
}
export function ManagementHome({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0),
    [tab, setTab] = useState<ManagementTab>(readManagementTab);
  const [cleanup, setCleanup] = useState<{ workspace: string; job: string }>();
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setTab(readManagementTab());
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const [selection, select] = useState<MemberSelection>({ query: '', page: 0, target: '' });
  const data = useRemote(
    (signal) => governanceClient.snapshot(tenant, signal),
    [tenant, attempt, session.identity],
  );
  const refresh = () => setAttempt((x) => x + 1);
  if (data.error) return <Failure error={data.error} retry={refresh} />;
  if (!data.value) return <Loading />;
  if (!data.value.canEnterManagement)
    return (
      <section className="access-panel">
        <Empty
          icon={Building2}
          title="没有访问权限"
          text="可以继续使用工作空间。管理入口需由企业授权负责人明确授予职责。"
        >
          <a className="button" href={`/workspace/#tenant=${tenant}`}>
            返回工作空间
          </a>
          <Button onClick={refresh}>重新确认职责</Button>
        </Empty>
      </section>
    );
  const mode = tab === 'business' && !data.value.canConfigure ? 'duties' : tab;
  return (
    <>
      {mode !== 'duties' && (data.value.canAcceptInitialResponsibility || data.value.pendingHandover) && (
        <section className="access-panel governance-panel">
          <p>有一项负责人职责等待明确接受。</p>
          <Button disabled={pendingRequest} onClick={() => setTab('duties')}>
            查看职责与交接
          </Button>
        </section>
      )}
      <nav className="tenant-tabs" aria-label="管理工作区" inert={pendingRequest || undefined}>
        {data.value.canConfigure && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'business' ? 'primary' : 'ghost'}
            onClick={() => setTab('business')}
          >
            企业配置
          </Button>
        )}
        <Button
          disabled={pendingRequest}
          variant={mode === 'duties' ? 'primary' : 'ghost'}
          onClick={() => setTab('duties')}
        >
          职责与授权
        </Button>
        <Button
          disabled={pendingRequest}
          variant={mode === 'sources' ? 'primary' : 'ghost'}
          onClick={() => setTab('sources')}
        >
          数据来源
        </Button>
        <Button
          disabled={pendingRequest}
          variant={mode === 'configuration' ? 'primary' : 'ghost'}
          onClick={() => setTab('configuration')}
        >
          AI 工作配置
        </Button>
        {data.value.canConfigure && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'operations' ? 'primary' : 'ghost'}
            onClick={() => setTab('operations')}
          >
            运行概览
          </Button>
        )}
        <Button
          disabled={pendingRequest}
          variant={mode === 'profiles' ? 'primary' : 'ghost'}
          onClick={() => setTab('profiles')}
        >
          档案维护
        </Button>
        <Button
          disabled={pendingRequest}
          variant={mode === 'experiences' ? 'primary' : 'ghost'}
          onClick={() => setTab('experiences')}
        >
          经验维护
        </Button>
        {featureEntries.attention && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'attention' ? 'primary' : 'ghost'}
            onClick={() => setTab('attention')}
          >
            维护待办
          </Button>
        )}
        {(data.value.canConfigure ||
          data.value.capabilities.some((c) => c.capability === 'EVALUATION_MAINTAIN')) && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'evaluation' ? 'primary' : 'ghost'}
            onClick={() => setTab('evaluation')}
          >
            评估与问题
          </Button>
        )}
        {(data.value.canConfigure ||
          data.value.capabilities.some((c) => c.capability === 'METHOD_ADOPT')) && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'methods' ? 'primary' : 'ghost'}
            onClick={() => setTab('methods')}
          >
            方法版本
          </Button>
        )}
        <Button
          disabled={pendingRequest}
          variant={mode === 'content-lifecycle' ? 'primary' : 'ghost'}
          onClick={() => setTab('content-lifecycle')}
        >
          内容回收与清理
        </Button>
        {(data.value.canConfigure ||
          data.value.capabilities.some((c) => ['MEMBER_OFFBOARD', 'TENANT_EXIT'].includes(c.capability))) && (
          <Button
            disabled={pendingRequest}
            variant={mode === 'retention' ? 'primary' : 'ghost'}
            onClick={() => setTab('retention')}
          >
            生命周期与退出
          </Button>
        )}
      </nav>
      {mode === 'business' ? (
        <TenantAdminHome tenant={tenant} />
      ) : mode === 'sources' ? (
        <BusinessSources tenant={tenant} verification={attempt} />
      ) : mode === 'configuration' ? (
        <WorkConfiguration
          tenant={tenant}
          verification={attempt}
          onOpenMethods={() => setTab('methods')}
          onOpenProfiles={() => setTab('profiles')}
          onOpenSources={() => setTab('sources')}
          onOpenOperations={data.value.canConfigure ? () => setTab('operations') : undefined}
        />
      ) : mode === 'operations' ? (
        <OperationsPanel scope="tenant" tenant={tenant} revision={attempt} />
      ) : mode === 'content-lifecycle' ? (
        <ObjectLifecycleWorkspace tenant={tenant} />
      ) : mode === 'retention' ? (
        <>
          <DeparturePanel tenant={tenant} verification={attempt} />
          <RetentionPanel
            tenant={tenant}
            verification={session.identity}
            onOpenWorkspace={(id) => {
              location.href = '/workspace/' + libraryHref(tenant, id);
            }}
            onOpenExports={(id) => {
              location.href = '/workspace/' + libraryHref(tenant, id);
            }}
            onOpenCleanup={(workspace, job) => setCleanup({ workspace, job })}
          />
        </>
      ) : mode === 'evaluation' ? (
        <EvaluationWorkspace tenant={tenant} />
      ) : mode === 'methods' ? (
        <MethodWorkbench tenant={tenant} />
      ) : mode === 'attention' ? (
        featureEntries.attention ? (
          <Attention tenant={tenant} managed />
        ) : (
          <Empty icon={Building2} title="待办暂未开放" text="首期待办入口暂时隐藏，后续完善后开放。">
            <Button onClick={() => setTab('configuration')}>返回工作配置</Button>
          </Empty>
        )
      ) : mode === 'experiences' ? (
        <WorkspaceExperiences tenant={tenant} management={data.value} />
      ) : mode === 'profiles' ? (
        <Profiles tenant={tenant} management={data.value} />
      ) : (
        <GovernancePanel
          tenant={tenant}
          snapshot={data.value}
          changed={refresh}
          selection={selection}
          select={select}
        />
      )}
      {cleanup && (
        <Modal title="资料在线清理回执" onClose={() => setCleanup(undefined)}>
          <MaterialCleanupStatus
            tenant={tenant}
            workspace={cleanup.workspace}
            job={cleanup.job}
            verification={session.identity}
            changed={() => {}}
          />
        </Modal>
      )}
    </>
  );
}
