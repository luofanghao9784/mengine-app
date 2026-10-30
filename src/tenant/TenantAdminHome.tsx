import { actionLabel, actorLabel } from '../admin/display-labels';
import { LibraryDepartments } from '../material/Permissions';
import { WorkspaceArchive, readWorkspaceArchive } from './WorkspaceArchive';
import { adminHref } from '../admin/navigation';
import { SpaceOwnerForm } from './SpaceOwnerForm';
import { useRequestLock } from '../shared/request-guard';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { LocalInviteLink } from '../identity/LocalInviteLink';
import { RequestPending } from '../shared/request-guard';
import { useContext } from 'react';
import { useEffect, useState, type ReactNode } from 'react';
import { OperationsPanel } from '../operations/OperationsPanel';
import {
  Building2,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Users,
  Mail,
  History,
  Settings,
  BarChart3,
} from 'lucide-react';
import type { Invitation } from '../../contracts/public-api/identity';
import type {
  TenantMember,
  SharedWorkspace,
  WorkspaceGrant,
  TenantOverview,
} from '../../contracts/public-api/tenant-admin';
import { useSession } from '../identity/session';
import { Badge, Button, Empty, Field, Modal, PageActions } from '../shared/ui';
import {
  MutationGate,
  useRemote,
  Failure,
  Loading,
  Pager,
  useSubmission,
  SubmitError,
  FormActions,
} from '../shared/admin';
import { tenantClient as api } from './client';
import '../platform/platform.css';
import './tenant.css';

type Tab = 'members' | 'invitations' | 'spaces' | 'records' | 'settings' | 'operations';
type Dialog =
  | { kind: 'invite' }
  | { kind: 'create' }
  | { kind: 'status'; member: TenantMember }
  | { kind: 'emergency'; member: TenantMember }
  | { kind: 'revoke'; invitation: Invitation }
  | { kind: 'space'; id: string }
  | { kind: 'settings'; overview: TenantOverview };
const tabs = [
  ['members', '企业成员', Users],
  ['invitations', '成员邀请', Mail],
  ['spaces', '共享空间', FolderOpen],
  ['operations', '运行概览', BarChart3],
  ['records', '管理记录', History],
  ['settings', '企业设置', Settings],
] as const;
const inviteLabels = { PENDING: '等待接受', ACCEPTED: '已加入', REVOKED: '已撤销', EXPIRED: '已过期' };
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
const role = (value: string) => (value === 'TENANT_ADMIN' ? '企业管理员' : '成员');
export function TenantAdminHome({
  tenant,
  compact = false,
  initialTab,
  hideNavigation = false,
}: {
  tenant: string;
  compact?: boolean;
  initialTab?: Tab;
  hideNavigation?: boolean;
}) {
  const { session, refresh: refreshIdentity } = useSession();
  const [tab, setTab] = useState<Tab>(
    () =>
      initialTab ||
      (new URLSearchParams(location.hash.slice(1)).get('tab') === 'spaces'
        ? 'spaces'
        : new URLSearchParams(location.hash.slice(1)).get('tab') === 'invitations'
          ? 'invitations'
          : 'members'),
  );
  useEffect(() => {
    const change = () => {
      const next = new URLSearchParams(location.hash.slice(1)).get('tab');
      if (next === 'spaces' || next === 'invitations' || next === 'members') setTab(next);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const pendingRequest = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog | undefined>(() => {
    const id = new URLSearchParams(location.hash.slice(1)).get('space');
    return id && /^[a-f0-9-]{36}$/i.test(id) ? { kind: 'space', id } : undefined;
  });
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');
  const overview = useRemote((signal) => api.overview(tenant, signal), [tenant, attempt]);
  const refresh = () => setAttempt((v) => v + 1);
  const complete = (notice: string) => {
    setDialog(undefined);
    setNotice(notice);
    refresh();
  };
  return (
    <MutationGate.Provider value={setWriting}>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh} disabled={writing}>
          刷新
        </Button>
        {!['records', 'settings', 'operations'].includes(tab) && (
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => setDialog({ kind: 'invite' })}
            disabled={overview.value?.invitationDelivery !== 'LOCAL'}
          >
            邀请成员
          </Button>
        )}
      </PageActions>
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      {overview.error ? (
        <section className="access-panel">
          <Failure error={overview.error} retry={refresh} />
        </section>
      ) : !overview.value ? (
        <Loading />
      ) : (
        <>
          {!compact && (
            <section className="access-panel access-welcome">
              <div>
                <span className="eyebrow">企业管理</span>
                <h2>{overview.value.name}</h2>
                <p>
                  {overview.value.activeMemberCount} 位启用成员 · {overview.value.sharedWorkspaceCount}{' '}
                  个共享空间
                </p>
              </div>
              <Badge blue>企业管理员</Badge>
            </section>
          )}
          {!compact && (
            <nav className="tenant-tabs" aria-label="企业管理功能">
              {tabs.map(([key, label, Icon]) => (
                <Button
                  key={key}
                  disabled={pendingRequest || writing}
                  icon={Icon}
                  variant={tab === key ? 'primary' : 'ghost'}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => setTab(key)}
                >
                  {label}
                </Button>
              ))}
            </nav>
          )}
          {compact && !initialTab && !hideNavigation && (
            <nav className="tenant-tabs" aria-label="成员与空间">
              {tabs
                .filter(([key]) => ['members', 'invitations', 'spaces'].includes(key))
                .map(([key, label, Icon]) => (
                  <Button
                    key={key}
                    icon={Icon}
                    variant={tab === key ? 'primary' : 'ghost'}
                    disabled={pendingRequest || writing}
                    onClick={() => {
                      setTab(key);
                      const params = new URLSearchParams(location.hash.slice(1));
                      params.set('tab', key);
                      location.hash = '#' + params;
                    }}
                  >
                    {label}
                  </Button>
                ))}
            </nav>
          )}
          <section className="access-panel tenant-section" key={tab}>
            {tab === 'members' && (
              <>
                <Members tenant={tenant} attempt={attempt} refresh={refresh} />
                <LibraryDepartments tenant={tenant} />
              </>
            )}
            {tab === 'invitations' && (
              <Invitations
                tenant={tenant}
                attempt={attempt}
                refresh={refresh}
                delivery={overview.value.invitationDelivery}
                revoke={(invitation) => setDialog({ kind: 'revoke', invitation })}
              />
            )}
            {tab === 'spaces' && (
              <Spaces
                tenant={tenant}
                attempt={attempt}
                refresh={refresh}
                create={() => setDialog({ kind: 'create' })}
                open={(id) => setDialog({ kind: 'space', id })}
              />
            )}
            {tab === 'records' && <Records tenant={tenant} attempt={attempt} refresh={refresh} />}
            {tab === 'operations' && <OperationsPanel scope="tenant" tenant={tenant} revision={attempt} />}
            {tab === 'settings' && (
              <div className="tenant-settings">
                <h2>企业设置</h2>
                <dl>
                  <dt>企业名称</dt>
                  <dd>{overview.value.name}</dd>
                  <dt>企业编号</dt>
                  <dd>
                    <code>{tenant}</code>
                  </dd>
                </dl>
                <Button onClick={() => setDialog({ kind: 'settings', overview: overview.value! })}>
                  修改名称
                </Button>
                <p className="muted">
                  企业管理仅用于维护成员和共享空间。个人资料与私人会话仍按各自权限访问。
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {dialog && !overview.error && (
        <Modal
          title={
            {
              invite: '邀请成员',
              create: '创建共享空间',
              status: '调整成员状态',
              emergency: '紧急安全停用',
              revoke: '撤销邀请',
              space: '共享空间管理',
              settings: '修改企业名称',
            }[dialog.kind]
          }
          wide={dialog.kind === 'space'}
          onClose={() => {
            if (!writing) setDialog(undefined);
          }}
        >
          <fieldset className="tenant-modal-fields" disabled={writing}>
            {dialog.kind === 'invite' && (
              <MemberInviteForm tenant={tenant} done={() => complete('成员邀请已生成，等待接受。')} />
            )}
            {dialog.kind === 'create' && (
              <SpaceOwnerForm
                tenant={tenant}
                saved={(result) => {
                  setDialog({ kind: 'space', id: result.id });
                  setNotice('共享空间已创建，负责人授权已生效。');
                  refresh();
                }}
              />
            )}
            {dialog.kind === 'settings' && (
              <TextForm
                label="企业名称"
                initial={dialog.overview.name}
                action="保存名称"
                submit={async (name, requestId) => {
                  await api.settings(tenant, { requestId, name, expectedVersion: dialog.overview.version });
                  complete('企业名称已更新。');
                  await refreshIdentity(true);
                }}
              />
            )}
            {dialog.kind === 'emergency' && (
              <EmergencyStop
                tenant={tenant}
                member={dialog.member}
                complete={async (message) => {
                  complete(message);
                  if (dialog.member.accountId === session.identity?.account.id) await refreshIdentity(true);
                }}
              />
            )}
            {dialog.kind === 'status' && (
              <Confirm
                action={dialog.member.status === 'ACTIVE' ? '确认停用' : '恢复成员'}
                danger={dialog.member.status === 'ACTIVE'}
                submit={async (requestId) => {
                  await api.status(tenant, dialog.member.accountId, {
                    requestId,
                    expectedVersion: dialog.member.version,
                    status: dialog.member.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                  });
                  complete('成员状态已更新。');
                  if (dialog.member.accountId === session.identity?.account.id) await refreshIdentity(true);
                }}
              >
                <p>
                  <strong>{dialog.member.displayName}</strong> · {dialog.member.phone || dialog.member.email}
                </p>
                <p className="muted">
                  {dialog.member.status === 'ACTIVE'
                    ? '停用后将无法访问本企业；原有资料和空间授权保留，恢复后可继续使用。其他企业的身份不受影响。'
                    : '恢复后将重新获得本企业及先前已授权空间的访问权。账号本身若已停用，仍需平台维护者处理。'}
                </p>
              </Confirm>
            )}
            {dialog.kind === 'revoke' && (
              <Confirm
                action="确认撤销"
                danger
                submit={async () => {
                  await api.revoke(tenant, dialog.invitation.id);
                  complete('邀请已撤销。');
                }}
              >
                <p>
                  撤销发给 <strong>{dialog.invitation.phone || dialog.invitation.email}</strong>{' '}
                  的邀请，原邀请码将失效。
                </p>
              </Confirm>
            )}
            {dialog.kind === 'space' && <SpaceDetail tenant={tenant} id={dialog.id} onChange={refresh} />}
          </fieldset>
        </Modal>
      )}
    </MutationGate.Provider>
  );
}
function Filter({
  initial = '',
  label,
  submit,
  children,
}: {
  initial?: string;
  label: string;
  submit: (value: string) => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      className="platform-filters"
      onSubmit={(e) => {
        e.preventDefault();
        submit(draft.trim());
      }}
    >
      <label className="platform-search">
        <Search size={16} />
        <input
          aria-label={label}
          placeholder={label}
          maxLength={100}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <Button type="submit">搜索</Button>
      {children}
    </form>
  );
}
function Members({ tenant, attempt, refresh }: { tenant: string; attempt: number; refresh: () => void }) {
  const { session } = useSession();
  const [q, setQ] = useViewState(tenant, 'admin:members:query', '', textState),
    [status, setStatus] = useViewState(tenant, 'admin:members:status', '', textState),
    [page, setPage] = useViewState(tenant, 'admin:members:page', 0, pageState);
  const data = useRemote(
    (signal) => api.members(tenant, q, status, page * 20, signal),
    [tenant, q, status, page, attempt],
  );
  return (
    <>
      <div className="platform-list-heading">
        <h2>企业成员</h2>
        <Filter
          initial={q}
          label="搜索姓名或手机号"
          submit={(q) => {
            setQ(q);
            setPage(0);
          }}
        >
          <select
            aria-label="成员状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">已启用</option>
            <option value="DISABLED">已停用</option>
          </select>
        </Filter>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="tenant-directory-scroll">
            <div className="tenant-list-columns tenant-member-grid">
              <span>成员</span>
              <span>企业角色</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <ul className="tenant-rows tenant-member-directory">
              {data.value.slice(0, 20).map((m) => (
                <li className="tenant-member-grid" key={m.accountId}>
                  <span className="tenant-person">
                    <strong>
                      <span className="tenant-member-avatar" aria-hidden="true">
                        {Array.from(m.displayName).slice(-2).join('')}
                      </span>
                      {m.displayName}
                      {m.accountId === session.identity?.account.id && <small> · 你</small>}
                    </strong>
                    <small>{m.phone || m.email}</small>
                  </span>
                  <Badge>{role(m.role)}</Badge>
                  <Badge blue={m.status === 'ACTIVE' && m.accountStatus === 'ACTIVE'}>
                    {m.accountStatus === 'DISABLED'
                      ? '账号已停用'
                      : m.status === 'ACTIVE'
                        ? '已启用'
                        : '已停用'}
                  </Badge>
                  <a
                    className="button ghost"
                    href={adminHref('tenant', 'members', location.hash, {
                      detail: 'member',
                      member: m.accountId,
                    })}
                    aria-label={`查看成员 ${m.displayName}`}
                  >
                    查看详情
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {!data.value.length && (
            <Empty icon={Users} title="没有找到成员" text="调整搜索条件，或邀请同事加入企业。" />
          )}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </>
  );
}
function Invitations({
  tenant,
  attempt,
  refresh,
  delivery,
  revoke,
}: {
  tenant: string;
  attempt: number;
  refresh: () => void;
  delivery: string;
  revoke: (i: Invitation) => void;
}) {
  const [page, setPage] = useState(0);
  const data = useRemote((signal) => api.invitations(tenant, page * 20, signal), [tenant, page, attempt]);
  return (
    <>
      <div className="platform-list-heading">
        <div>
          <h2>成员邀请</h2>
          <p className="platform-help">
            {delivery === 'LOCAL'
              ? '当前为本地投递，邀请不会发送短信。'
              : '邀请服务尚未启用，暂不能生成邀请。'}
          </p>
        </div>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="tenant-directory-scroll">
            <div className="tenant-list-columns tenant-invitation-grid">
              <span>受邀账号</span>
              <span>企业角色</span>
              <span>有效期至</span>
              <span>状态</span>
              <span>操作</span>
            </div>
            <ul className="tenant-rows tenant-invitation-directory">
              {data.value.slice(0, 20).map((i) => (
                <li className="tenant-invitation-grid" key={i.id}>
                  <span className="tenant-person">
                    <strong>{i.phone || i.email}</strong>
                    {i.phone && i.status === 'PENDING' && <LocalInviteLink invitation={i.id} />}
                  </span>
                  <span>{role(i.role)}</span>
                  <time>{time(i.expiresAt)}</time>
                  <Badge blue={i.status === 'PENDING'}>{inviteLabels[i.status]}</Badge>
                  <span>
                    {['PENDING', 'EXPIRED'].includes(i.status) && (
                      <Button variant="ghost" onClick={() => revoke(i)}>
                        撤销邀请
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {!data.value.length && (
            <Empty icon={Mail} title="还没有邀请" text="邀请同事，共同开始使用工作空间。" />
          )}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </>
  );
}
function Spaces({
  tenant,
  attempt,
  refresh,
  create,
  open,
}: {
  tenant: string;
  attempt: number;
  refresh: () => void;
  create?: () => void;
  open: (id: string) => void;
}) {
  const [q, setQ] = useViewState(tenant, 'admin:spaces:query', '', textState),
    [page, setPage] = useViewState(tenant, 'admin:spaces:page', 0, pageState);
  const data = useRemote((signal) => api.spaces(tenant, q, page * 20, signal), [tenant, q, page, attempt]);
  return (
    <>
      <div className="platform-list-heading">
        <h2>共享空间</h2>
        <Filter
          initial={q}
          label="搜索空间"
          submit={(q) => {
            setQ(q);
            setPage(0);
          }}
        >
          {create && (
            <Button icon={Plus} onClick={create}>
              创建空间
            </Button>
          )}
        </Filter>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="tenant-directory-scroll">
            <div className="tenant-list-columns tenant-space-grid">
              <span>空间名称</span>
              <span>负责人</span>
              <span>授权成员</span>
              <span>操作</span>
            </div>
            <ul className="platform-tenant-list">
              {data.value.slice(0, 20).map((s) => (
                <li key={s.id}>
                  <button
                    className="platform-tenant-row tenant-space-grid"
                    onClick={() => open(s.id)}
                    aria-label={`管理空间 ${s.name}`}
                  >
                    <span className="platform-tenant-name">
                      <strong>{s.name}</strong>
                    </span>
                    <span>{s.ownerName || '负责人待指定'}</span>
                    <span>{s.memberCount} 人</span>
                    <span>管理</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {!data.value.length && (
            <Empty
              icon={FolderOpen}
              title="还没有共享空间"
              text="为团队、业务或项目创建共享空间，再授予成员访问权限。"
            />
          )}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </>
  );
}
function Records({ tenant, attempt, refresh }: { tenant: string; attempt: number; refresh: () => void }) {
  const [page, setPage] = useState(0);
  const data = useRemote((signal) => api.records(tenant, page * 20, signal), [tenant, page, attempt]);
  return (
    <>
      <div className="platform-list-heading">
        <h2>管理记录</h2>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <ul className="platform-records tenant-records">
            {data.value.slice(0, 20).map((r) => (
              <li key={r.id}>
                <span>
                  <strong>
                    {actionLabel(r.action)} · {r.targetName || r.targetId}
                    {r.relatedAccountName && ` → ${r.relatedAccountName}`}
                  </strong>
                  <small>操作人：{actorLabel(r.actorName)}</small>
                </span>
                <time dateTime={r.createdAt}>{time(r.createdAt)}</time>
              </li>
            ))}
          </ul>
          {!data.value.length && (
            <Empty icon={History} title="暂无管理记录" text="成员、邀请和共享空间的管理操作会记录在这里。" />
          )}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </>
  );
}
function TextForm({
  label,
  initial = '',
  phone = false,
  action,
  description,
  submit,
}: {
  label: string;
  initial?: string;
  phone?: boolean;
  action: string;
  description?: string;
  submit: (v: string, key: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const task = useSubmission<string>();
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(value.trim(), submit);
      }}
    >
      {description && <p className="muted">{description}</p>}
      <fieldset disabled={task.busy || task.uncertain}>
        <Field label={label}>
          <input
            autoFocus
            required
            type={phone ? 'tel' : 'text'}
            maxLength={phone ? 40 : 100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </fieldset>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button type="submit" variant="primary" disabled={task.busy}>
          {task.busy ? '正在提交…' : task.uncertain ? '按原内容重试' : action}
        </Button>
      </FormActions>
    </form>
  );
}
export function Confirm({
  action,
  danger = false,
  submit,
  children,
}: {
  action: string;
  danger?: boolean;
  submit: (key: string) => Promise<void>;
  children: ReactNode;
}) {
  const task = useSubmission<null>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <div className="platform-form">
      {children}
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={task.busy}
          onClick={() => void task.submit(null, async (_, key) => submit(key))}
        >
          {task.busy ? '正在提交…' : task.uncertain ? '按原内容重试' : action}
        </Button>
      </FormActions>
    </div>
  );
}
export function SpaceDetail({ tenant, id, onChange }: { tenant: string; id: string; onChange: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    async (signal) => {
      const [space, archive] = await Promise.all([
        api.space(tenant, id, signal),
        readWorkspaceArchive(tenant, id, signal),
      ]);
      return { space, archive };
    },
    [tenant, id, attempt],
  );
  const refresh = () => {
    setAttempt((v) => v + 1);
    onChange();
  };
  return data.error ? (
    <Failure error={data.error} retry={refresh} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <>
      <WorkspaceArchive tenant={tenant} id={id} onChange={refresh} />
      {!data.value.archive.archived && (
        <SpaceContents key={`${id}:${attempt}`} tenant={tenant} space={data.value.space} refresh={refresh} />
      )}
    </>
  );
}
function SpaceContents({
  tenant,
  space,
  refresh,
}: {
  tenant: string;
  space: SharedWorkspace;
  refresh: () => void;
}) {
  const [mode, setMode] = useState<'list' | 'add' | 'rename' | 'owner'>('list'),
    [page, setPage] = useState(0);
  const [revoking, setRevoking] = useState<WorkspaceGrant>();
  const [maintenance, setMaintenance] = useState<WorkspaceGrant>();
  const { session } = useSession();
  const data = useRemote(
    (signal) => api.grants(tenant, space.id, page * 20, signal),
    [tenant, space.id, page],
  );
  const canConfigure = session.identity?.memberships.some(
    (m) => m.tenantId === tenant && m.role === 'TENANT_ADMIN',
  );
  if (mode === 'owner')
    return (
      <>
        <Button variant="ghost" onClick={() => setMode('list')}>
          返回空间详情
        </Button>
        <SpaceOwnerForm tenant={tenant} space={space} saved={refresh} />
      </>
    );
  if (mode === 'rename')
    return (
      <>
        <Button variant="ghost" onClick={() => setMode('list')}>
          返回成员授权
        </Button>
        <TextForm
          label="空间名称"
          initial={space.name}
          action="保存名称"
          submit={async (name, requestId) => {
            await api.renameSpace(tenant, space.id, { requestId, name, expectedVersion: space.version });
            refresh();
          }}
        />
      </>
    );
  if (mode === 'add')
    return (
      <>
        <Button variant="ghost" onClick={() => setMode('list')}>
          返回成员授权
        </Button>
        <AddGrant tenant={tenant} space={space} refresh={refresh} />
      </>
    );
  if (maintenance)
    return (
      <Confirm
        action={maintenance.canMaintain ? '确认设为只读' : '确认允许维护'}
        submit={async (requestId) => {
          await api.maintenance(tenant, space.id, maintenance.accountId, {
            requestId,
            expectedVersion: space.version,
            enabled: !maintenance.canMaintain,
          });
          refresh();
        }}
      >
        <p>
          {maintenance.canMaintain ? '取消' : '授予'} <strong>{maintenance.displayName}</strong>{' '}
          的资料维护权限。
        </p>
        <p className="muted">维护权限允许上传资料、创建文件夹和更新历史版本；取消后仍可查看和下载。</p>
      </Confirm>
    );
  if (revoking)
    return (
      <Confirm
        action="确认撤销授权"
        danger
        submit={async (requestId) => {
          await api.grant(tenant, space.id, revoking.accountId, {
            requestId,
            expectedVersion: space.version,
            enabled: false,
          });
          refresh();
        }}
      >
        <p>
          撤销 <strong>{revoking.displayName}</strong> 对“{space.name}”的访问权限。
        </p>
        <p className="muted">保留原有资料，成员下一次请求即不再获得此空间的访问权。</p>
      </Confirm>
    );
  return (
    <>
      <div className="platform-detail-title">
        <h3>{space.name}</h3>
        {canConfigure && (
          <Button variant="ghost" onClick={() => setMode('rename')}>
            修改名称
          </Button>
        )}
      </div>
      <p className="platform-help">{space.description || '未填写空间说明'}</p>
      <div className="tenant-space-heading">
        <p>负责人：{space.ownerName || '尚未明确指定'}</p>
        {canConfigure && (
          <Button onClick={() => setMode('owner')}>{space.ownerId ? '更换负责人' : '指定负责人'}</Button>
        )}
      </div>
      <div className="platform-detail-section">
        <SpaceOwnerRecords tenant={tenant} space={space.id} />
        <div className="tenant-space-heading">
          <h3>已授权成员</h3>
          <Button icon={Plus} onClick={() => setMode('add')}>
            添加成员
          </Button>
        </div>
        <p className="platform-help">
          成员默认只读，资料维护权限单独授予。管理员的管理身份不自动获得内容访问权；停用期间授权保留。
        </p>
        {data.error ? (
          <Failure error={data.error} retry={refresh} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <ul className="tenant-rows tenant-grants">
              {data.value.slice(0, 20).map((m) => (
                <li key={m.accountId}>
                  <span className="tenant-person">
                    <strong>
                      <span className="tenant-member-avatar" aria-hidden="true">
                        {Array.from(m.displayName).slice(-2).join('')}
                      </span>
                      {m.displayName}
                      {m.accountId === session.identity?.account.id && <small> · 你</small>}
                    </strong>
                    <small>{m.phone || m.email}</small>
                  </span>
                  <Badge>{m.canMaintain ? '可维护' : '只读'}</Badge>
                  <Button
                    variant="ghost"
                    disabled={
                      m.accountId === space.ownerId ||
                      (!m.canMaintain &&
                        (m.accountId === session.identity?.account.id ||
                          m.status !== 'ACTIVE' ||
                          m.accountStatus !== 'ACTIVE'))
                    }
                    onClick={() => setMaintenance(m)}
                  >
                    {m.canMaintain ? '设为只读' : '允许维护'}
                  </Button>
                  {(m.status === 'DISABLED' || m.accountStatus === 'DISABLED') && <Badge>访问暂停</Badge>}
                  <Button
                    variant="ghost"
                    disabled={m.accountId === space.ownerId}
                    onClick={() => setRevoking(m)}
                  >
                    撤销授权
                  </Button>
                </li>
              ))}
            </ul>
            {!data.value.length && (
              <Empty icon={Users} title="还没有授权成员" text="添加需要共同使用这个空间的同事。" />
            )}
            <Pager page={page} next={data.value.length > 20} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
function AddGrant({
  tenant,
  space,
  refresh,
}: {
  tenant: string;
  space: SharedWorkspace;
  refresh: () => void;
}) {
  const { session } = useSession();
  const [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState<TenantMember>();
  const data = useRemote(
    (signal) => api.spaceCandidates(tenant, space.id, q, page * 20, signal),
    [tenant, q, page, attempt],
  );
  if (selected)
    return (
      <Confirm
        action="确认添加"
        submit={async (requestId) => {
          await api.grant(tenant, space.id, selected.accountId, {
            requestId,
            expectedVersion: space.version,
            enabled: true,
          });
          refresh();
        }}
      >
        <p>
          允许 <strong>{selected.displayName}</strong>（{selected.phone || selected.email}）访问“{space.name}
          ”。
        </p>
      </Confirm>
    );
  return (
    <>
      <h3>选择要授权的成员</h3>
      <p className="platform-help">
        仅可新增本企业有效成员。新成员默认只读；负责人权限需通过更换负责人调整。
      </p>
      <Filter
        label="搜索授权成员"
        submit={(q) => {
          setQ(q);
          setPage(0);
        }}
      />
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((v) => v + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <ul className="tenant-rows tenant-grants">
            {data.value.slice(0, 20).map((m) => (
              <li key={m.accountId}>
                <span className="tenant-person">
                  <strong>
                    <span className="tenant-member-avatar" aria-hidden="true">
                      {Array.from(m.displayName).slice(-2).join('')}
                    </span>
                    {m.displayName}
                    {m.accountId === session.identity?.account.id && <small> · 你</small>}
                  </strong>
                  <small>{m.phone || m.email}</small>
                </span>
                <Button
                  disabled={m.accountId === session.identity?.account.id || m.accountStatus !== 'ACTIVE'}
                  onClick={() => setSelected(m)}
                >
                  选择
                </Button>
              </li>
            ))}
          </ul>
          {!data.value.length && (
            <Empty icon={Users} title="没有可选成员" text="调整搜索条件，或先邀请同事加入企业。" />
          )}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </>
  );
}

export function EmergencyStop({
  tenant,
  member,
  complete,
}: {
  tenant: string;
  member: TenantMember;
  complete: (message: string) => Promise<void>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const task = useSubmission<boolean>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (acknowledged)
          void task.submit(true, async (_, requestId) => {
            const result = await api.emergencyDisable(tenant, member.accountId, {
              requestId,
              expectedVersion: member.version,
              securityAction: 'SECURITY_RISK',
            });
            await complete(
              result.recoveryRequestId
                ? `已紧急停用。恢复申请 ${result.recoveryRequestId} 待核验；未变更负责人。`
                : '已紧急停用该成员的本企业资格。',
            );
          });
      }}
    >
      <p>
        <strong>{member.displayName}</strong> · {member.phone || member.email}
      </p>
      <p>
        用于已识别的账号安全风险，可先停用负责人或最后管理员。操作立即撤销该成员的本企业使用资格；停用本人后将失去本企业入口。
      </p>
      <p>负责人归属与私人内容不转移。涉及负责人或最后管理员时进入待核验恢复，不能通过普通恢复绕过。</p>
      <label className="governance-check">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={task.busy || task.uncertain}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        确认存在安全风险，需要立即停用
      </label>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button type="submit" variant="danger" disabled={!acknowledged || task.busy}>
          {task.uncertain ? '重试本次紧急停用' : '确认紧急安全停用'}
        </Button>
      </FormActions>
    </form>
  );
}

/** Ordinary space owners see only their assigned spaces, never the enterprise member/invite console. */
export function ManagedSpaces({ tenant }: { tenant: string }) {
  const [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(''),
    [writing, setWriting] = useState(false);
  const pending = useContext(RequestPending);
  useRequestLock(writing);
  const refresh = () => setAttempt((n) => n + 1);
  return (
    <MutationGate.Provider value={setWriting}>
      <section className="admin-section">
        <p className="admin-note">只显示你负责的共享空间，可在空间内添加已入企成员并调整其权限。</p>
        <Spaces tenant={tenant} attempt={attempt} refresh={refresh} open={setSelected} />
      </section>
      {selected && (
        <Modal
          title="空间管理"
          onClose={() => {
            if (!writing && !pending) setSelected('');
          }}
        >
          <SpaceDetail tenant={tenant} id={selected} onChange={refresh} />
        </Modal>
      )}
    </MutationGate.Provider>
  );
}

function SpaceOwnerRecords({ tenant, space }: { tenant: string; space: string }) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((signal) => api.ownerChanges(tenant, space, signal), [tenant, space, attempt]);
  return (
    <details>
      <summary>负责人变更记录</summary>
      <p className="platform-help">最近 50 条记录</p>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <p>暂无负责人变更。</p>
      ) : (
        data.value.map((item) => (
          <div className="admin-account-record" key={item.id}>
            <strong>
              {item.previousOwnerName || '未指定'} → {item.nextOwnerName}
            </strong>
            <p>
              {item.actorName} · {time(item.createdAt)}
            </p>
            <p>
              {
                {
                  READ: '原负责人保留只读',
                  MAINTAIN: '原负责人保留资料维护',
                  REMOVE: '原负责人移出空间',
                  NONE: '首次明确指定负责人，原有成员授权保留',
                }[item.previousAccess]
              }
            </p>
          </div>
        ))
      )}
    </details>
  );
}

export function MemberInviteForm({ tenant, done }: { tenant: string; done: () => void }) {
  const [phone, setPhone] = useState(''),
    [spaces, setSpaces] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const choices = useRemote((signal) => api.spaces(tenant, '', page * 20, signal), [tenant, page]);
  const task = useSubmission<{ phone: string; workspaceIds: string[] }>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit({ phone, workspaceIds: spaces }, async (body, requestId) => {
          await api.invite(tenant, { ...body, requestId });
          done();
        });
      }}
    >
      <fieldset disabled={task.busy || task.uncertain}>
        <Field label="受邀手机号">
          <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <p>
          可选初始共享空间，加入后获得阅读权限。最多选择 20 个，已选择 {spaces.length}{' '}
          个。授权范围尚未确认时，请先不选业务空间；加入后再按确认范围授权。当前邀请仅用于本地验证，不会发送真实短信。
        </p>
        {choices.error ? (
          <Failure error={choices.error} retry={() => window.location.reload()} />
        ) : (
          choices.value?.map((space) => (
            <label key={space.id} style={{ display: 'block' }}>
              <input
                type="checkbox"
                disabled={!spaces.includes(space.id) && spaces.length >= 20}
                checked={spaces.includes(space.id)}
                onChange={(e) =>
                  setSpaces((old) =>
                    e.target.checked ? [...old, space.id] : old.filter((id) => id !== space.id),
                  )
                }
              />
              {space.name}
            </label>
          ))
        )}
        <Pager page={page} next={choices.value?.length === 20} onPage={setPage} />
        <SubmitError error={task.error} uncertain={task.uncertain} />
        <Button type="submit">生成邀请</Button>
      </fieldset>
      {task.uncertain && (
        <Button
          onClick={() =>
            void task.submit({ phone, workspaceIds: spaces }, async (body, requestId) => {
              await api.invite(tenant, { ...body, requestId });
              done();
            })
          }
        >
          核对并重试
        </Button>
      )}
    </form>
  );
}
