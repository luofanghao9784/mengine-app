import { TenantConsole } from '../admin/TenantConsole';
import { SkillCenter, skillsHref } from '../skills/SkillCenter';
import { SuspendedEnterprise } from './SuspendedEnterprise';
import { TenantScene } from '../admin/TenantScene';
import { UploadProvider } from '../material/UploadManager';
import { phoneClient } from './phone-client';
import { PhoneAuth } from './PhoneAuth';
import { uuid } from './client';
import { entryTenant, rememberedTenant, rememberTenant } from './entry';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { useWorkspaceNotifications } from './workspace-notifications';
import { WorkspaceComposer } from './WorkspaceComposer';
import { DepartureStatus } from '../departure/DepartureStatus';
import { DeparturePanel } from '../departure/DeparturePanel';
import { RequestGuard, RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { useContext } from 'react';
import { Plans } from '../plans/Plans';
import { featureEntries } from '../shared/feature-entries';
import { AccountPanel } from './AccountPanel';
import { Documents } from '../documents/Documents';
import { documentsHref } from '../documents/routes';
import { Conversations, conversationHref } from '../conversation/Conversations';
import { LiveBriefing, briefingHref } from '../briefing-live/Briefing';
import { MessageSquare, LayoutPanelTop, ExternalLink, Puzzle, ChevronLeft } from 'lucide-react';
import { ManagementHome } from '../governance/ManagementHome';
import { Profiles } from '../profile/Profiles';
import { governanceClient } from '../governance/client';
import { useRemote } from '../shared/admin';
import { PlatformHome } from '../platform/PlatformHome';
import { PageActionsContext } from '../shared/ui';
import { useEffect, useRef, useState } from 'react';
import { managementHref, returnToWorkspaceHref, workspaceReturnHash } from './navigation';
import { useElasticReaders } from '../shared/useElasticReaders';
import { useViewScroll } from '../shared/useViewState';
import {
  CalendarClock,
  Building2,
  FolderOpen,
  LibraryBig,
  RefreshCw,
  ShieldX,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type { Identity, Membership } from '../../contracts/public-api/identity';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import { EntryChoice, EntryFrame } from './EntryFrame';
import { requestSurfaceChoice } from './surface-choice';
import { Button, Badge, Empty } from '../shared/ui';
import { NavigationButton, PageHeader } from '../shared/layout';
import { IdentityError } from './client';
import { useSession } from './session';
import { LiveLibrary, libraryHref } from '../material/Library';
import { useAutoHideScrollbars } from '../useAutoHideScrollbars';

export type Surface = 'workspace' | 'tenant-admin' | 'platform-admin';
const labels: Record<Surface, string> = {
  workspace: '工作空间',
  'tenant-admin': '企业管理',
  'platform-admin': '系统管理',
};
const icons = { workspace: FolderOpen, 'tenant-admin': Building2, 'platform-admin': ShieldCheck };
export const entryHref = (surface: Surface, tenant?: string) =>
  new URL(`../${surface}/`, location.href).pathname + (tenant ? `#tenant=${encodeURIComponent(tenant)}` : '');
const message = (error: unknown) =>
  error instanceof IdentityError ? error.message : '请求未完成，请稍后重试。';
function Status({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return (
    <div className="access-status" role="status">
      <Empty icon={retry ? WifiOff : RefreshCw} title={title} text={detail}>
        {retry && (
          <Button onClick={retry} icon={RefreshCw}>
            重新连接
          </Button>
        )}
      </Empty>
    </div>
  );
}

// Strip invitation secrets before mounting. The server stores only a hash to restore intent on refresh.
export function readInvitation() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('invite') || '';
  const inviting = params.has('invite');
  if (inviting) history.replaceState(null, '', location.pathname + location.search + '#invite');
  return { token: /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '', inviting };
}

export default function AccessApp({
  surface,
  initialInvitation,
}: {
  surface: Surface;
  initialInvitation: ReturnType<typeof readInvitation>;
}) {
  useAutoHideScrollbars();
  const { session, refresh, logout } = useSession();
  const [inviting, setInviting] = useState(initialInvitation.inviting);
  const [token, setToken] = useState(initialInvitation.token);
  const [notice, setNotice] = useState('');
  const [phoneAttempt, setPhoneAttempt] = useState(0);
  const phoneConfiguration = useRemote(
    (signal) => phoneClient.configuration(signal),
    [session.phase, session.identity?.account.id, phoneAttempt],
  );
  const legacyAllowed = phoneConfiguration.value?.delivery === 'DISABLED';
  useEffect(() => {
    if (session.phase === 'authenticated') setNotice('');
  }, [session.phase]);
  useEffect(() => {
    const change = () => {
      if (requestNavigationLocked()) return;
      const invitation = readInvitation();
      if (invitation.inviting) {
        setToken(invitation.token);
        setInviting(true);
        setNotice('');
      }
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.title = `${labels[surface]} · 梦擎工作空间`;
  }, [surface]);
  const cancelInvitation = (tenant?: string) => {
    setInviting(false);
    setToken('');
    history.replaceState(
      null,
      '',
      location.pathname + (tenant ? `#tenant=${encodeURIComponent(tenant)}` : ''),
    );
  };
  if (session.phase === 'loading') return <Status title="正在确认登录状态" detail="请稍候…" />;
  if (session.phase === 'unavailable')
    return (
      <Status
        title="暂时无法连接服务"
        detail={
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? '网络已断开，恢复网络后点“重新连接”。'
            : '暂时无法确认登录状态。请检查网络后点“重新连接”；如果网络正常，服务可能正在维护，请稍后再试。'
        }
        retry={() => void refresh()}
      />
    );
  if (
    session.phase === 'authenticated' &&
    !session.identity?.account.phone &&
    !session.identity?.account.username &&
    !phoneConfiguration.value
  )
    return (
      <Status
        title="正在确认账号入口"
        detail={
          phoneConfiguration.error ? `登录方式暂时读取失败：${message(phoneConfiguration.error)}` : '请稍候…'
        }
        retry={phoneConfiguration.error ? () => setPhoneAttempt((n) => n + 1) : undefined}
      />
    );
  if (
    session.phase === 'anonymous' ||
    inviting ||
    (!session.identity?.account.phone &&
      ((!session.identity?.account.username && !legacyAllowed) ||
        new URLSearchParams(location.hash.slice(1)).has('bind')))
  )
    return (
      <EntryFrame label="账号登录与邀请" home={entryHref('workspace')}>
        <PhoneAuth
          token={token}
          inviting={inviting}
          identity={session.identity}
          legacyAllowed={legacyAllowed}
          legacyEntry={surface === 'platform-admin'}
          welcome={surface === 'workspace' ? '欢迎回来，今天的画报已经在等你了。' : undefined}
          onJoined={(membership) => {
            cancelInvitation(membership.tenantId);
          }}
          onCancel={() => cancelInvitation()}
          onInvite={() => setInviting(true)}
        />
      </EntryFrame>
    );
  return (
    <AccessShell
      key={session.identity!.account.id}
      surface={surface}
      identity={session.identity!}
      notice={notice}
      onInvite={() => setInviting(true)}
    />
  );
}

function AccessShell(props: { surface: Surface; identity: Identity; notice: string; onInvite: () => void }) {
  return (
    <RequestGuard>
      <GuardedAccessShell {...props} />
    </RequestGuard>
  );
}

function GuardedAccessShell({
  surface,
  identity,
  notice,
  onInvite,
}: {
  surface: Surface;
  identity: Identity;
  notice: string;
  onInvite: () => void;
}) {
  const { refresh, logout } = useSession();
  useElasticReaders(surface === 'workspace');
  const pendingRequest = useContext(RequestPending);
  const [accountOpen, setAccountOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const governance = useRemote(
    async (signal) => ({
      account: identity.account.id,
      items: await Promise.all(
        identity.memberships
          .filter((m) => m.service?.status !== 'SUSPENDED')
          .map(async (m) => {
            try {
              return await governanceClient.snapshot(m.tenantId, signal);
            } catch {
              return null;
            }
          }),
      ),
    }),
    [identity],
  );
  const management =
    governance.value?.account === identity.account.id
      ? governance.value.items.filter((v) => v?.canEnterManagement).map((v) => v!.tenantId)
      : [];
  const eligible =
    surface === 'tenant-admin'
      ? identity.memberships.filter((m) => m.service?.status !== 'SUSPENDED')
      : identity.memberships;
  const [routeHash, setRouteHash] = useState(location.hash);
  const [briefingMonth, setBriefingMonth] = useState<string | null>(null);
  const editionDate = new Date();
  const editionLabel = briefingMonth
    ? `${briefingMonth.slice(0, 4)}年${Number(briefingMonth.slice(5))}月`
    : editionDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const params = new URLSearchParams(routeHash.slice(1));
  const [initialTenant] = useState(() => rememberedTenant(identity.account.id, surface));
  const tenant = entryTenant(params.get('tenant'), eligible, initialTenant);
  const view = params.get('view');
  const departure = view === 'departure',
    plans = view === 'plans',
    experiences = view === 'experiences',
    profiles = view === 'profiles',
    conversations = view === 'conversations',
    skills = view === 'skills',
    documents = view === 'documents',
    briefing = view === 'briefing' || (surface === 'workspace' && !view),
    fromBriefing = params.get('from') === 'briefing',
    library = view === 'library' || view === 'spaces';
  const legacySpace = params.get('space');
  const libraryScope = params.get('scope');
  useEffect(() => {
    if (surface !== 'workspace' || view !== 'spaces' || !tenant || pendingRequest) return;
    const next = libraryHref(tenant, uuid(legacySpace) ? legacySpace : 'enterprise');
    history.replaceState(history.state, '', next);
    setRouteHash(next);
  }, [surface, view, tenant, legacySpace, pendingRequest]);
  const mainRef = useRef<HTMLElement>(null);
  useViewScroll(mainRef, tenant, surface + ':' + routeHash);
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setRouteHash(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const selected = identity.memberships.find((m) => m.tenantId === tenant);
  useEffect(() => {
    if (selected) rememberTenant(identity.account.id, selected.tenantId, surface);
  }, [identity.account.id, selected?.tenantId, surface]);
  const allowed = surface === 'platform-admin' ? identity.platformAdmin : !!selected;
  const notifications = useWorkspaceNotifications(
    tenant,
    surface === 'workspace' && allowed,
    routeHash,
    identity.account.id,
  );
  const links: Surface[] = [
    'workspace',
    ...(management.includes(tenant) ? ['tenant-admin' as const] : []),
    ...(identity.platformAdmin ? ['platform-admin' as const] : []),
  ];
  const surfaceHref = (target: Surface) => {
    if (target === 'platform-admin') return '/platform-admin/';
    if (target === 'workspace' && surface !== 'workspace') return returnToWorkspaceHref(routeHash, tenant);
    if (target !== 'workspace' && surface === 'workspace') return managementHref(target, tenant, routeHash);
    return entryHref(target, tenant || undefined);
  };
  const choose = (id: string) => {
    location.hash = skills
      ? skillsHref(id)
      : departure
        ? `tenant=${encodeURIComponent(id)}&view=departure`
        : plans
          ? `tenant=${encodeURIComponent(id)}&view=plans`
          : experiences
            ? `tenant=${encodeURIComponent(id)}&view=experiences`
            : profiles
              ? `tenant=${encodeURIComponent(id)}&view=profiles`
              : documents
                ? documentsHref(id)
                : briefing
                  ? briefingHref(id)
                  : library
                    ? libraryHref(id, libraryScope && libraryScope !== 'personal' ? 'enterprise' : 'personal')
                    : conversations
                      ? conversationHref(id)
                      : `tenant=${encodeURIComponent(id)}${new URLSearchParams(location.hash.slice(1)).get('view') === 'spaces' ? '&view=spaces' : ''}`;
  };
  if (selected?.service?.status === 'SUSPENDED')
    return <SuspendedEnterprise membership={selected} identity={identity} />;
  if (surface !== 'platform-admin' && !allowed && !tenant && eligible.length > 1)
    return (
      <ChooseTenant
        memberships={eligible}
        canSwitchSurface={identity.platformAdmin || management.length > 0}
        onChoose={choose}
      />
    );
  if (surface === 'tenant-admin' && selected)
    return (
      <UploadProvider>
        {new URLSearchParams(location.search).get('view') === 'business' ||
        // 地址里有 place 时是场景外壳（它的板块里会嵌旧版管理台、带上 admin/tab 等参数）；否则按旧链接打开旧版管理台。
        (!new URLSearchParams(location.hash.slice(1)).has('place') &&
          ['admin', 'manage', 'tab', 'scope'].some((key) =>
            new URLSearchParams(location.hash.slice(1)).has(key),
          )) ? (
          <TenantConsole key={tenant} tenant={tenant} name={selected.tenantName} />
        ) : (
          <TenantScene key={tenant} tenant={tenant} />
        )}
      </UploadProvider>
    );
  return (
    <UploadShell key={`${identity.account.id}:${tenant}:${allowed}`} actionsTarget={actionsTarget}>
      <div
        className={`access-shell ${surface === 'workspace' ? 'workspace-shell' : ''} ${surface === 'workspace' && conversations ? `workspace-conversations ${fromBriefing ? 'workspace-contextual' : ''}` : ''} ${surface === 'workspace' && briefing ? 'workspace-briefing' : ''}`}
      >
        <aside className="access-sidebar" aria-label="工作导航">
          <a href={surfaceHref('workspace')} className="access-brand" aria-label="梦擎工作空间">
            <DreamcoreLogo />
          </a>
          <nav aria-label="主导航" inert={pendingRequest}>
            {surface === 'workspace' && selected ? (
              <WorkspaceNavigation
                routeKey={routeHash}
                primary={[
                  {
                    label: '会话',
                    icon: MessageSquare,
                    active: conversations,
                    href: conversationHref(tenant),
                    notification: notifications?.conversations ? '会话有待处理内容' : undefined,
                  },
                  {
                    label: '智能画报',
                    icon: LayoutPanelTop,
                    active: briefing,
                    href: briefingHref(tenant),
                    notification: notifications?.briefing ? '智能画报有未读卡片' : undefined,
                  },
                  {
                    label: '资料库',
                    icon: LibraryBig,
                    active: library || documents,
                    href: libraryHref(tenant),
                  },
                  { label: '技能中心', icon: Puzzle, active: skills, href: skillsHref(tenant) },
                ]}
              />
            ) : (
              links.map((link) => (
                <div className="nav-item" key={link}>
                  <NavigationButton
                    label={labels[link]}
                    icon={icons[link]}
                    active={surface === link}
                    href={surfaceHref(link)}
                  />
                </div>
              ))
            )}
          </nav>
          <button
            type="button"
            className="access-avatar"
            disabled={pendingRequest}
            onClick={() => setAccountOpen(true)}
            aria-label="个人设置与账号"
          >
            {identity.account.displayName.slice(0, 1)}
          </button>
        </aside>
        <div className="access-main">
          <PageHeader
            className={surface === 'workspace' && (library || skills) ? 'material-topbar' : ''}
            heading={
              <>
                <h1>
                  {surface === 'workspace' && departure
                    ? '迁出与清理记录'
                    : surface === 'workspace' && plans
                      ? '我的计划'
                      : surface === 'workspace' && experiences
                        ? '工作空间'
                        : surface === 'workspace' && profiles
                          ? '我的档案与偏好'
                          : surface === 'workspace' && documents
                            ? '个人文稿'
                            : surface === 'workspace' && briefing
                              ? '智能画报'
                              : surface === 'workspace' && conversations
                                ? '会话'
                                : surface === 'workspace' && library
                                  ? '资料库'
                                  : skills
                                    ? '技能中心'
                                    : labels[surface]}
                </h1>
                {surface === 'workspace' && briefing && (
                  <time
                    className="workspace-edition"
                    dateTime={briefingMonth ?? editionDate.toLocaleDateString('en-CA')}
                  >
                    {editionLabel}
                  </time>
                )}
              </>
            }
            actionsRef={setActionsTarget}
            actions={
              surface !== 'workspace' ||
              library ||
              skills ||
              conversations ||
              briefing ||
              documents ||
              plans ||
              experiences ||
              profiles ? undefined : (
                <Button variant="ghost" icon={RefreshCw} onClick={() => void refresh()}>
                  刷新
                </Button>
              )
            }
          />
          <main ref={mainRef} className="access-content" key={`${identity.account.id}:${surface}:${tenant}`}>
            {surface !== 'workspace' && (
              <div className="surface-return-actions">
                <a className="button ghost workspace-return" href={surfaceHref('workspace')}>
                  {workspaceReturnHash(new URLSearchParams(routeHash.slice(1)).get('back') || '', tenant)
                    ? '返回原工作'
                    : '返回工作空间'}
                </a>
                <a
                  className="button ghost"
                  href={surfaceHref('workspace')}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="在新标签页打开客户端"
                  title="在新标签页打开客户端"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  新标签页打开客户端
                </a>
              </div>
            )}
            {pendingRequest && !(surface === 'workspace' && view === 'briefing') && (
              <p className="access-alert" role="status">
                正在核对本次提交，请在原处完成或重试后再切换页面。
              </p>
            )}
            {notice && (
              <p className="access-success" role="status">
                {notice}
              </p>
            )}
            {allowed && surface !== 'platform-admin' && tenant && <DepartureStatus tenant={tenant} />}
            {!allowed ? (
              <section className="access-panel">
                <Empty
                  icon={ShieldX}
                  title={
                    surface === 'workspace' && !identity.memberships.length ? '尚未加入企业' : '没有访问权限'
                  }
                  text={
                    surface === 'workspace' && !identity.memberships.length
                      ? '使用企业管理员提供的邀请加入工作空间。'
                      : '请使用已获授权的账号，或切换到你有权访问的企业。'
                  }
                >
                  <Button onClick={onInvite}>接受邀请</Button>
                  {surface !== 'workspace' && (
                    <a className="button" href={surfaceHref('workspace')}>
                      返回工作空间
                    </a>
                  )}
                </Empty>
              </section>
            ) : surface === 'platform-admin' ? (
              <PlatformHome />
            ) : surface === 'tenant-admin' ? (
              <ManagementHome tenant={tenant} />
            ) : departure ? (
              <DeparturePanel tenant={tenant} recordsOnly />
            ) : plans ? (
              featureEntries.ongoingPlans ? (
                <Plans tenant={tenant} />
              ) : (
                <Empty
                  icon={CalendarClock}
                  title="持续计划暂未开放"
                  text="首期暂不提供持续计划入口，后续完善后开放。你可以继续会话或查看智能画报。"
                >
                  <a className="button primary" href={briefingHref(tenant)}>
                    返回智能画报
                  </a>
                </Empty>
              )
            ) : experiences ? (
              <Empty
                icon={FolderOpen}
                title="此功能暂未开放"
                text="首版客户端暂不提供经验库展示与维护。你可以继续会话或查看智能画报。"
              >
                <a className="button primary" href={briefingHref(tenant)}>
                  返回智能画报
                </a>
              </Empty>
            ) : profiles ? (
              <Profiles tenant={tenant} personalOnly />
            ) : skills ? (
              <SkillCenter key={tenant} tenant={tenant} />
            ) : documents ? (
              <Documents key={tenant} tenant={tenant} />
            ) : briefing || conversations ? (
              <WorkspaceConversationPages
                key={tenant}
                tenant={tenant}
                briefing={briefing}
                conversations={conversations}
                overlay={conversations && fromBriefing}
                onMonthChange={setBriefingMonth}
              />
            ) : view === 'spaces' ? (
              <Status title="正在打开资料库" detail="请稍候…" />
            ) : library ? (
              <LiveLibrary key={tenant} tenant={tenant} />
            ) : (
              <LiveLibrary key={tenant} tenant={tenant} />
            )}
          </main>
          {surface === 'workspace' && briefing && allowed && (
            <WorkspaceComposer
              key={`${identity.account.id}:${tenant}`}
              account={identity.account.id}
              tenant={tenant}
            />
          )}
        </div>
        {accountOpen && (
          <AccountPanel
            identity={identity}
            tenant={tenant}
            memberships={identity.memberships}
            links={links
              .filter((link) => link !== surface)
              .map((link) => ({
                label: link === 'workspace' ? '工作空间' : link === 'tenant-admin' ? '企业管理端' : '总台',
                href: surfaceHref(link),
              }))}
            onChoose={choose}
            onClose={() => setAccountOpen(false)}
            onLogout={logout}
          />
        )}
      </div>
    </UploadShell>
  );
}

/** Enterprise choice before entering; the same card as login, not the workspace shell. */
function ChooseTenant({
  memberships,
  canSwitchSurface,
  onChoose,
}: {
  memberships: Membership[];
  canSwitchSurface: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <EntryFrame label="选择企业">
      {canSwitchSurface && (
        <button
          type="button"
          className="access-back"
          onClick={() => {
            requestSurfaceChoice();
            location.reload();
          }}
        >
          <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          返回选择入口
        </button>
      )}
      <h1>选择企业</h1>
      <p>你已加入 {memberships.length} 家企业，选择本次要进入的一家。</p>
      <div className="access-choices">
        {memberships.map((m) => (
          <EntryChoice
            key={m.tenantId}
            id={m.tenantId}
            name={m.tenantName}
            detail={m.role === 'TENANT_ADMIN' ? '企业管理员' : '成员'}
            mark={Array.from(m.tenantName.trim())[0] ?? '企'}
            tone="plain"
            onClick={() => onChoose(m.tenantId)}
          />
        ))}
      </div>
    </EntryFrame>
  );
}

/** Keep the briefing mounted while a contextual conversation is open. */
function WorkspaceConversationPages({
  tenant,
  briefing,
  conversations,
  overlay,
  onMonthChange,
}: {
  tenant: string;
  briefing: boolean;
  conversations: boolean;
  overlay: boolean;
  onMonthChange: (month: string | null) => void;
}) {
  const actions = useContext(PageActionsContext);
  return (
    <>
      {(briefing || overlay) && (
        <div className="workspace-briefing-background" inert={overlay || undefined}>
          <PageActionsContext.Provider value={overlay ? null : actions}>
            <LiveBriefing tenant={tenant} onMonthChange={onMonthChange} />
          </PageActionsContext.Provider>
        </div>
      )}
      {conversations && (
        <div className={overlay ? 'workspace-conversation-overlay' : 'workspace-conversation-page'}>
          {overlay && (
            <button
              type="button"
              className="workspace-conversation-scrim"
              aria-label="返回智能画报"
              onClick={() => {
                if (!requestNavigationLocked()) location.hash = briefingHref(tenant);
              }}
            />
          )}
          <Conversations tenant={tenant} />
        </div>
      )}
    </>
  );
}

function UploadShell({
  actionsTarget,
  children,
}: {
  actionsTarget: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  return (
    <UploadProvider>
      <PageActionsContext.Provider value={actionsTarget}>{children}</PageActionsContext.Provider>
    </UploadProvider>
  );
}
