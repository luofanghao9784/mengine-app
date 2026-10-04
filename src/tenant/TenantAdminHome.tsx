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
const actions: Record<string, string> = {
  INVITATION_CREATE: '创建邀请',
  INVITATION_REVOKE: '撤销邀请',
  INVITATION_ACCEPT: '接受邀请',
  MEMBER_ENABLE: '恢复成员',
  MEMBER_DISABLE: '停用成员',
  MEMBER_SECURITY_DISABLE: '紧急安全停用成员',
  MEMBER_ROLE: '调整管理员角色',
  WORKSPACE_CREATE: '创建共享空间',
  WORKSPACE_RENAME: '修改空间名称',
  WORKSPACE_GRANT: '授权空间成员',
  WORKSPACE_REVOKE: '撤销空间授权',
  WORKSPACE_MAINTAIN: '授予资料维护权限',
  WORKSPACE_READONLY: '取消资料维护权限',
  TENANT_RENAME: '修改企业名称',
};
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
const role = (value: string) => (value === 'TENANT_ADMIN' ? '企业管理员' : '成员');
export function TenantAdminHome({
  tenant,
  compact = false,
  initialTab,
}: {
  tenant: string;
  compact?: boolean;
  initialTab?: Tab;
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
        {tab !== 'records' && (
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
          {compact && !initialTab && (
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
              <Members
                tenant={tenant}
                attempt={attempt}
                refresh={refresh}
                onStatus={(member) => setDialog({ kind: 'status', member })}
                onEmergency={(member) => setDialog({ kind: 'emergency', member })}
              />
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
              <TextForm
                label="受邀手机号"
                phone
                action="生成邀请"
                description="邀请成员加入当前企业。当前为本地验证，可从邀请列表复制本地邀请链接，未发送真实短信。"
                submit={async (value, requestId) => {
                  await api.invite(tenant, { requestId, phone: value });
                  complete('成员邀请已生成，等待接受。');
                }}
              />
            )}
            {dialog.kind === 'create' && (
              <TextForm
                label="空间名称"
                action="创建空间"
                description="创建供团队共同使用的空间，再按需添加成员。创建空间不会自动授予内容访问权。"
                submit={async (name, requestId) => {
                  const result = await api.createSpace(tenant, { requestId, name });
                  setDialog({ kind: 'space', id: result.id });
                  setNotice('共享空间已创建，可继续添加成员。');
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
function Members({
  tenant,
  attempt,
  refresh,
  onStatus,
  onEmergency,
}: {
  tenant: string;
  attempt: number;
  refresh: () => void;
  onStatus: (m: TenantMember) => void;
  onEmergency: (m: TenantMember) => void;
}) {
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
          <ul className="tenant-rows">
            {data.value.slice(0, 20).map((m) => (
              <li key={m.accountId}>
                <span className="tenant-person">
                  <strong>{m.displayName}</strong>
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
                {m.status === 'ACTIVE' && (
                  <Button variant="danger" onClick={() => onEmergency(m)}>
                    紧急安全停用
                  </Button>
                )}
                <Button variant="ghost" onClick={() => onStatus(m)}>
                  {m.status === 'ACTIVE' ? '停用' : '恢复'}
                </Button>
              </li>
            ))}
          </ul>
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
          <ul className="tenant-rows">
            {data.value.slice(0, 20).map((i) => (
              <li key={i.id}>
                <span className="tenant-person">
                  <strong>{i.phone || i.email}</strong>
                  {i.phone && i.status === 'PENDING' && <LocalInviteLink invitation={i.id} />}
                  <small>
                    {role(i.role)} · 到期 {time(i.expiresAt)}
                  </small>
                </span>
                <Badge blue={i.status === 'PENDING'}>{inviteLabels[i.status]}</Badge>
                {['PENDING', 'EXPIRED'].includes(i.status) && (
                  <Button variant="ghost" onClick={() => revoke(i)}>
                    撤销邀请
                  </Button>
                )}
              </li>
            ))}
          </ul>
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
  create: () => void;
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
          <Button icon={Plus} onClick={create}>
            创建空间
          </Button>
        </Filter>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <ul className="platform-tenant-list">
            {data.value.slice(0, 20).map((s) => (
              <li key={s.id}>
                <button
                  className="platform-tenant-row"
                  onClick={() => open(s.id)}
                  aria-label={`管理空间 ${s.name}`}
                >
                  <span className="platform-tenant-icon">
                    <FolderOpen size={22} />
                  </span>
                  <span className="platform-tenant-name">
                    <strong>{s.name}</strong>
                    <small>{s.memberCount} 位已授权成员（含停用成员）</small>
                  </span>
                  <span>管理</span>
                </button>
              </li>
            ))}
          </ul>
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
                    {actions[r.action]} · {r.targetName || r.targetId}
                    {r.relatedAccountName && ` → ${r.relatedAccountName}`}
                  </strong>
                  <small>操作人：{r.actorName}</small>
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
function Confirm({
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
function SpaceDetail({ tenant, id, onChange }: { tenant: string; id: string; onChange: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((signal) => api.space(tenant, id, signal), [tenant, id, attempt]);
  const refresh = () => {
    setAttempt((v) => v + 1);
    onChange();
  };
  return data.error ? (
    <Failure error={data.error} retry={refresh} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <SpaceContents key={`${id}:${attempt}`} tenant={tenant} space={data.value} refresh={refresh} />
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
  const [mode, setMode] = useState<'list' | 'add' | 'rename'>('list'),
    [page, setPage] = useState(0);
  const [revoking, setRevoking] = useState<WorkspaceGrant>();
  const [maintenance, setMaintenance] = useState<WorkspaceGrant>();
  const { session } = useSession();
  const data = useRemote(
    (signal) => api.grants(tenant, space.id, page * 20, signal),
    [tenant, space.id, page],
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
        <Button variant="ghost" onClick={() => setMode('rename')}>
          修改名称
        </Button>
      </div>
      <div className="platform-detail-section">
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
                    <strong>{m.displayName}</strong>
                    <small>{m.phone || m.email}</small>
                  </span>
                  <Badge>{m.canMaintain ? '可维护' : '只读'}</Badge>
                  <Button
                    variant="ghost"
                    disabled={
                      !m.canMaintain &&
                      (m.accountId === session.identity?.account.id ||
                        m.status !== 'ACTIVE' ||
                        m.accountStatus !== 'ACTIVE')
                    }
                    onClick={() => setMaintenance(m)}
                  >
                    {m.canMaintain ? '设为只读' : '允许维护'}
                  </Button>
                  {(m.status === 'DISABLED' || m.accountStatus === 'DISABLED') && <Badge>访问暂停</Badge>}
                  <Button variant="ghost" onClick={() => setRevoking(m)}>
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
    (signal) => api.members(tenant, q, 'ACTIVE', page * 20, signal),
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
        仅可新增有效成员。配置管理员不能为自己新增内容权限；企业授权负责人可明确授权。
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
                  <strong>{m.displayName}</strong>
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

function EmergencyStop({
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
