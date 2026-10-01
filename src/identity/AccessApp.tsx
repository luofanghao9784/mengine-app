import { WorkspaceNavigation } from './WorkspaceNavigation';
import { WorkspaceComposer } from './WorkspaceComposer';
import { DepartureStatus } from '../departure/DepartureStatus';
import { DeparturePanel } from '../departure/DeparturePanel';
import { RequestGuard, RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { useContext } from 'react';
import { Plans } from '../plans/Plans';
import { WorkspaceExperiences } from '../experience/WorkspaceExperiences';
import { SharedActivity } from '../activity/Activity';
import { Documents } from '../documents/Documents';
import { documentsHref } from '../documents/routes';
import { Conversations, conversationHref } from '../conversation/Conversations';
import { LiveBriefing, briefingHref } from '../briefing-live/Briefing';
import { MessageSquare, Newspaper } from 'lucide-react';
import { ManagementHome } from '../governance/ManagementHome';
import { Profiles } from '../profile/Profiles';
import { governanceClient } from '../governance/client';
import { useRemote } from '../shared/admin';
import { PlatformHome } from '../platform/PlatformHome';
import { PageActionsContext } from '../shared/ui';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Building2,
  CircleUserRound,
  FolderOpen,
  LibraryBig,
  LogOut,
  RefreshCw,
  ShieldX,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type { Identity, Membership, TenantContext } from '../../contracts/public-api/identity';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import { Button, Badge, Empty, Field, Modal } from '../shared/ui';
import { NavigationButton, PageHeader } from '../shared/layout';
import { IdentityError } from './client';
import { identityClient, useSession } from './session';
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
function Alert({ text }: { text: string }) {
  return (
    <p className="access-alert" role="alert">
      {text}
    </p>
  );
}
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

// Strip invitation secrets before mounting or requesting any service. Keep only in memory.
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
  const [authPage, setAuthPage] = useState<'login' | 'activate'>(inviting ? 'activate' : 'login');
  const [notice, setNotice] = useState('');
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
        setAuthPage('activate');
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
    setAuthPage('login');
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
      <Status title="暂时无法连接服务" detail="当前状态尚未确认，请重新连接。" retry={() => void refresh()} />
    );
  if (session.phase === 'anonymous' || inviting)
    return (
      <div className="access-auth-layout">
        <a className="access-wordmark" href={entryHref('workspace')}>
          <DreamcoreLogo wordmark />
        </a>
        <section className="access-auth-card" aria-label="账号登录与邀请">
          {session.identity ? (
            <>
              <span className="eyebrow">加入企业</span>
              <h1>接受邀请</h1>
              <p className="muted">使用 {session.identity.account.email} 加入受邀企业。</p>
              <InviteForm
                token={token}
                setToken={setToken}
                onSuccess={async (membership) => {
                  cancelInvitation(membership.tenantId);
                  setNotice(`已加入 ${membership.tenantName}`);
                  await refresh();
                }}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setAuthPage('login');
                  void logout().catch(() => {});
                }}
              >
                切换账号
              </Button>
              <Button variant="ghost" onClick={() => cancelInvitation()}>
                返回{labels[surface]}
              </Button>
            </>
          ) : (
            <>
              <span className="eyebrow">{labels[surface]}</span>
              <h1>{authPage === 'login' ? '登录梦擎工作空间' : '接受邀请'}</h1>
              <p className="muted">
                {authPage === 'login'
                  ? '使用受邀邮箱和密码，继续你的工作。'
                  : '使用管理员提供的邀请码，设置你的账号。'}
              </p>
              {notice && (
                <p className="access-success" role="status">
                  {notice}
                </p>
              )}
              {authPage === 'login' ? (
                <LoginForm />
              ) : (
                <InviteForm
                  token={token}
                  setToken={setToken}
                  newAccount
                  onSuccess={(membership) => {
                    cancelInvitation(membership.tenantId);
                    setNotice(`已加入 ${membership.tenantName}，请使用受邀邮箱登录。`);
                  }}
                />
              )}
              <div className="access-auth-links">
                {authPage === 'login' ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNotice('');
                      setInviting(true);
                      setAuthPage('activate');
                    }}
                  >
                    我有邀请码
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setAuthPage('login')}>
                    已有账号，先登录
                  </Button>
                )}
                <Button variant="ghost" icon={RefreshCw} onClick={() => void refresh()}>
                  重新确认登录状态
                </Button>
              </div>
            </>
          )}
        </section>
        <p className="access-auth-note">邀请制使用 · 企业成员身份由所属企业授予</p>
      </div>
    );
  return (
    <AccessShell
      surface={surface}
      identity={session.identity!}
      notice={notice}
      onInvite={() => {
        setInviting(true);
        setAuthPage('activate');
      }}
    />
  );
}

function LoginForm() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await login(email.trim(), password);
        } catch (e) {
          setError(message(e));
        } finally {
          setPassword('');
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <Field label="邮箱">
          <input
            type="email"
            name="email"
            autoComplete="username"
            maxLength={254}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Alert text={error} />}
        <Button type="submit" variant="primary" className="full" icon={ArrowRight}>
          {busy ? '正在登录…' : '登录'}
        </Button>
      </fieldset>
    </form>
  );
}

function InviteForm({
  token,
  setToken,
  newAccount = false,
  onSuccess,
}: {
  token: string;
  setToken: (token: string) => void;
  newAccount?: boolean;
  onSuccess: (membership: Membership) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { expire } = useSession();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (newAccount && password !== confirmation) {
          setError('两次输入的密码不一致。');
          return;
        }
        setBusy(true);
        setError('');
        try {
          const result = await identityClient.accept(
            newAccount ? { token, displayName: name.trim(), password } : { token },
          );
          setToken('');
          await onSuccess(result);
        } catch (e) {
          if (e instanceof IdentityError && e.status === 401) expire();
          setError(message(e));
        } finally {
          setBusy(false);
          setPassword('');
          setConfirmation('');
        }
      }}
    >
      <fieldset disabled={busy}>
        <Field label="邀请码">
          <input
            name="invitation"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            required
            pattern="[A-Za-z0-9_\-]{43}"
            maxLength={64}
          />
        </Field>
        {newAccount && (
          <>
            <Field label="你的姓名">
              <input
                name="displayName"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </Field>
            <Field label="设置密码" hint="15–128 个字符，建议使用便于记忆的长密码。">
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={15}
                maxLength={128}
                required
              />
            </Field>
            <Field label="确认密码">
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                minLength={15}
                maxLength={128}
                required
              />
            </Field>
          </>
        )}
        {error && <Alert text={error} />}
        <Button type="submit" variant="primary" className="full">
          {busy ? '正在加入…' : newAccount ? '创建账号并加入' : '确认加入企业'}
        </Button>
      </fieldset>
    </form>
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
  const pendingRequest = useContext(RequestPending);
  const [accountOpen, setAccountOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const governance = useRemote(
    async (signal) => ({
      account: identity.account.id,
      items: await Promise.all(
        identity.memberships.map(async (m) => {
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
      ? identity.memberships.filter((m) => management.includes(m.tenantId))
      : identity.memberships;
  const readTenant = () =>
    new URLSearchParams(location.hash.slice(1)).get('tenant') || identity.memberships[0]?.tenantId || '';
  const [tenant, setTenant] = useState(readTenant);
  const [departure, setDeparture] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'departure',
  );
  const [plans, setPlans] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'plans',
  );
  const [experiences, setExperiences] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'experiences',
  );
  const [profiles, setProfiles] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'profiles',
  );
  const [conversations, setConversations] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'conversations',
  );
  const [documents, setDocuments] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'documents',
  );
  const [briefing, setBriefing] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'briefing',
  );
  const [library, setLibrary] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('view') === 'library',
  );
  useEffect(() => {
    const change = () => {
      if (requestNavigationLocked()) return;
      setTenant(readTenant());
      setDeparture(new URLSearchParams(location.hash.slice(1)).get('view') === 'departure');
      setPlans(new URLSearchParams(location.hash.slice(1)).get('view') === 'plans');
      setExperiences(new URLSearchParams(location.hash.slice(1)).get('view') === 'experiences');
      setProfiles(new URLSearchParams(location.hash.slice(1)).get('view') === 'profiles');
      setLibrary(new URLSearchParams(location.hash.slice(1)).get('view') === 'library');
      setDocuments(new URLSearchParams(location.hash.slice(1)).get('view') === 'documents');
      setBriefing(new URLSearchParams(location.hash.slice(1)).get('view') === 'briefing');
      setConversations(new URLSearchParams(location.hash.slice(1)).get('view') === 'conversations');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [identity, surface]);
  const selected = identity.memberships.find((m) => m.tenantId === tenant);
  const allowed = surface === 'platform-admin' ? identity.platformAdmin : !!selected;
  const links: Surface[] = [
    'workspace',
    ...(management.length || surface === 'tenant-admin' ? ['tenant-admin' as const] : []),
    ...(identity.platformAdmin ? ['platform-admin' as const] : []),
  ];
  const surfaceHref = (target: Surface) => {
    const membership = identity.memberships.find((m) => m.tenantId === tenant);
    const carry =
      target !== 'platform-admin' &&
      membership &&
      (target === 'workspace' || management.includes(membership.tenantId));
    return entryHref(target, carry ? tenant : target === 'tenant-admin' ? management[0] : undefined);
  };
  const choose = (id: string) => {
    setTenant(id);
    location.hash = departure
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
                  ? libraryHref(id)
                  : conversations
                    ? conversationHref(id)
                    : `tenant=${encodeURIComponent(id)}`;
  };
  return (
    <PageActionsContext.Provider value={actionsTarget}>
      <div
        className={`access-shell ${surface === 'workspace' ? 'workspace-shell' : ''} ${surface === 'workspace' && conversations ? 'workspace-conversations' : ''} ${surface === 'workspace' && briefing ? 'workspace-briefing' : ''}`}
      >
        <aside className="access-sidebar" aria-label="工作导航">
          <a href={surfaceHref('workspace')} className="access-brand" aria-label="梦擎工作空间">
            <DreamcoreLogo />
          </a>
          <nav aria-label="主导航" inert={pendingRequest}>
            {surface === 'workspace' && selected ? (
              <WorkspaceNavigation
                routeKey={`${tenant}:${location.hash}`}
                primary={[
                  {
                    label: '会话',
                    icon: MessageSquare,
                    active: conversations,
                    href: conversationHref(tenant),
                  },
                  { label: '智能画报', icon: Newspaper, active: briefing, href: briefingHref(tenant) },
                  {
                    label: '资料库',
                    icon: LibraryBig,
                    active: library || documents,
                    href: libraryHref(tenant),
                  },
                ]}
                more={[
                  {
                    label: '工作空间',
                    icon: FolderOpen,
                    active: !(
                      library ||
                      conversations ||
                      briefing ||
                      documents ||
                      profiles ||
                      experiences ||
                      plans ||
                      departure
                    ),
                    href: surfaceHref('workspace'),
                  },
                  {
                    label: '档案',
                    icon: CircleUserRound,
                    active: profiles,
                    href: `#tenant=${tenant}&view=profiles`,
                  },
                  {
                    label: '经验库',
                    icon: BookOpen,
                    active: experiences,
                    href: `#tenant=${tenant}&view=experiences`,
                  },
                  {
                    label: '持续计划',
                    icon: CalendarClock,
                    active: plans,
                    href: `#tenant=${tenant}&view=plans`,
                  },
                  ...links
                    .filter((link) => link !== 'workspace')
                    .map((link) => ({ label: labels[link], icon: icons[link], href: surfaceHref(link) })),
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
            aria-label="账号与退出"
          >
            {identity.account.displayName.slice(0, 1)}
          </button>
        </aside>
        <div className="access-main">
          <PageHeader
            className={surface === 'workspace' && library ? 'material-topbar' : ''}
            heading={
              <>
                <h1>
                  {surface === 'workspace' && departure
                    ? '迁出与清理记录'
                    : surface === 'workspace' && plans
                      ? '持续计划'
                      : surface === 'workspace' && experiences
                        ? '经验库'
                        : surface === 'workspace' && profiles
                          ? '档案'
                          : surface === 'workspace' && documents
                            ? '个人文稿'
                            : surface === 'workspace' && briefing
                              ? '智能画报'
                              : surface === 'workspace' && conversations
                                ? '会话'
                                : surface === 'workspace' && library
                                  ? '资料库'
                                  : labels[surface]}
                </h1>
                {surface === 'workspace' && briefing && (
                  <time className="workspace-edition" dateTime={new Date().toLocaleDateString('en-CA')}>
                    {new Date().toLocaleDateString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}
                  </time>
                )}
              </>
            }
            actionsRef={setActionsTarget}
            actions={
              surface !== 'workspace' ||
              library ||
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
            meta={
              surface !== 'platform-admin' && eligible.length > 0 ? (
                <label className="access-tenant-picker">
                  <span className="sr-only">当前企业</span>
                  <select
                    aria-label="当前企业"
                    disabled={pendingRequest}
                    value={selected?.tenantId || ''}
                    onChange={(e) => choose(e.target.value)}
                  >
                    {!selected && <option value="">请选择有权访问的企业</option>}
                    {eligible.map((m) => (
                      <option key={m.tenantId} value={m.tenantId}>
                        {m.tenantName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Badge>
                  {surface === 'platform-admin' && identity.platformAdmin ? '平台管理员' : '成员账号'}
                </Badge>
              )
            }
          />
          <main className="access-content" key={`${identity.account.id}:${surface}:${tenant}`}>
            {pendingRequest && (
              <p className="access-alert" role="status">
                正在核对本次提交，请在原处完成或重试后再切换页面。
              </p>
            )}
            {notice && (
              <p className="access-success" role="status">
                {notice}
              </p>
            )}
            {allowed && surface !== 'platform-admin' && tenant && (
              <DepartureStatus
                tenant={tenant}
                compact={surface === 'workspace' && (conversations || briefing)}
              />
            )}
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
              <DeparturePanel tenant={tenant} />
            ) : plans ? (
              <Plans tenant={tenant} />
            ) : experiences ? (
              <WorkspaceExperiences tenant={tenant} />
            ) : profiles ? (
              <Profiles tenant={tenant} />
            ) : documents ? (
              <Documents key={tenant} tenant={tenant} />
            ) : briefing ? (
              <LiveBriefing key={tenant} tenant={tenant} />
            ) : conversations ? (
              <Conversations key={tenant} tenant={tenant} />
            ) : library ? (
              <LiveLibrary key={tenant} tenant={tenant} />
            ) : (
              <TenantHome tenant={tenant} />
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
          <Modal title="账号" onClose={() => setAccountOpen(false)}>
            <div className="access-account">
              <CircleUserRound size={32} />
              <strong>{identity.account.displayName}</strong>
              <p>{identity.account.email}</p>
            </div>
            <div className="access-account-actions">
              <Button onClick={onInvite}>接受另一企业邀请</Button>
              <Button icon={LogOut} onClick={() => void logout().catch(() => {})}>
                退出登录
              </Button>
            </div>
          </Modal>
        )}
      </div>
    </PageActionsContext.Provider>
  );
}

function TenantHome({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const result = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, session.identity],
  );
  if (result.error)
    return (
      <section className="access-panel">
        <Empty
          icon={result.error instanceof IdentityError && result.error.status === 403 ? ShieldX : WifiOff}
          title={
            result.error instanceof IdentityError && result.error.status === 403
              ? '没有访问权限'
              : '暂时无法读取企业信息'
          }
          text={message(result.error)}
        >
          <Button onClick={() => setAttempt((v) => v + 1)}>重试</Button>
        </Empty>
      </section>
    );
  if (!result.value) return <Status title="正在读取企业信息" detail="请稍候…" />;
  const context = result.value;
  return (
    <>
      <section className="access-panel access-welcome">
        <div>
          <span className="eyebrow">我的企业</span>
          <h2>{context.tenant.name}</h2>
          <p>当前身份：{context.role === 'TENANT_ADMIN' ? '企业管理员' : '企业成员'}</p>
        </div>
        <Badge blue>已连接</Badge>
      </section>
      <section className="access-panel">
        <header className="access-section-heading">
          <h2>我的空间</h2>
          <span className="muted">仅显示你有权访问的空间</span>
        </header>
        {context.workspaces.length ? (
          <ul className="access-spaces">
            {context.workspaces.map((space) => (
              <li key={space.id}>
                <FolderOpen size={22} />
                <a href={libraryHref(tenant, space.kind === 'PERSONAL' ? 'personal' : space.id)}>
                  {space.name}
                </a>
                <Badge>{space.kind === 'PERSONAL' ? '个人' : '共享'}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={FolderOpen} title="还没有可访问的空间" text="请联系企业管理员确认空间权限。" />
        )}
        <div className="access-footnote">
          点击空间进入资料库；在“会话”中开展工作，完成的会话成果会汇集到“智能画报”。
        </div>
      </section>
      <SharedActivity tenant={tenant} context={context} />
    </>
  );
}
