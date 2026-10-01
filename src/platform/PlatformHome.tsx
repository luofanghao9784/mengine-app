import { LocalInviteLink } from '../identity/LocalInviteLink';
import { DepartureStatus } from '../departure/DepartureStatus';
import { ObjectLifecycleWorkspace } from '../objectlifecycle/ObjectLifecycleWorkspace';
import { EvaluationWorkspace } from '../evaluation/EvaluationWorkspace';
import { MethodWorkbench } from '../methods/MethodWorkbench';
import { RequestPending } from '../shared/request-guard';
import { useContext } from 'react';
import { RecoveryForm } from '../governance/RecoveryForm';
import '../governance/governance.css';
import { useState } from 'react';
import { OperationsPanel } from '../operations/OperationsPanel';
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
import {
  Building2,
  ChevronRight,
  CirclePause,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type {
  PlatformOverview,
  TenantDetail,
  ManagementRecord,
} from '../../contracts/public-api/platform-admin';
import { Badge, Button, Empty, Field, Modal, PageActions } from '../shared/ui';
import { platformClient } from './client';
import './platform.css';

const statusLabel = (s: string) => (s === 'ACTIVE' ? '入口启用' : '入口已停用');
const invitationLabel: Record<string, string> = {
  PENDING: '等待接受',
  ACCEPTED: '已加入',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
};
const actionLabel: Record<string, string> = {
  TENANT_CREATE: '开通企业',
  TENANT_SUSPEND: '停用企业',
  TENANT_RESUME: '恢复使用',
  INITIAL_ADMIN_INVITATION_REPLACE: '重新生成初始管理员邀请',
};
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });

export function PlatformHome() {
  const pendingRequest = useContext(RequestPending);
  const [tab, setTab] = useState<'tenants' | 'operations' | 'evaluation' | 'methods' | 'content-lifecycle'>(
    'tenants',
  );
  const [attempt, setAttempt] = useState(0);
  const [writing, setWriting] = useState(false);
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [tenant, setTenant] = useState<string>();
  const [notice, setNotice] = useState('');
  const list = useRemote(
    (signal) => platformClient.tenants(query, status, page * 20, 21, signal),
    [query, status, page, attempt],
  );
  const overview = useRemote((signal) => platformClient.overview(signal), [attempt]);
  const refresh = () => setAttempt((v) => v + 1);
  return (
    <MutationGate.Provider value={setWriting}>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setCreateOpen(true)}
          disabled={overview.value?.invitationDelivery !== 'LOCAL'}
        >
          开通企业
        </Button>
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
      ) : overview.value ? (
        <Overview value={overview.value} />
      ) : (
        <Loading />
      )}
      <nav className="platform-tabs" aria-label="总台管理功能" inert={pendingRequest || undefined}>
        <Button
          variant={tab === 'tenants' ? 'primary' : 'ghost'}
          aria-current={tab === 'tenants' ? 'page' : undefined}
          onClick={() => setTab('tenants')}
        >
          企业管理
        </Button>
        <Button
          variant={tab === 'operations' ? 'primary' : 'ghost'}
          aria-current={tab === 'operations' ? 'page' : undefined}
          onClick={() => setTab('operations')}
        >
          运行概览
        </Button>
        <Button
          variant={tab === 'evaluation' ? 'primary' : 'ghost'}
          aria-current={tab === 'evaluation' ? 'page' : undefined}
          onClick={() => setTab('evaluation')}
        >
          评估与问题
        </Button>
        <Button
          variant={tab === 'methods' ? 'primary' : 'ghost'}
          aria-current={tab === 'methods' ? 'page' : undefined}
          onClick={() => setTab('methods')}
        >
          方法版本
        </Button>
        <Button
          disabled={pendingRequest}
          variant={tab === 'content-lifecycle' ? 'primary' : 'ghost'}
          aria-current={tab === 'content-lifecycle' ? 'page' : undefined}
          onClick={() => setTab('content-lifecycle')}
        >
          内容回收与清理
        </Button>
      </nav>
      {tab === 'content-lifecycle' ? (
        <ObjectLifecycleWorkspace />
      ) : tab === 'evaluation' ? (
        <EvaluationWorkspace />
      ) : tab === 'methods' ? (
        <MethodWorkbench />
      ) : tab === 'operations' ? (
        <OperationsPanel scope="platform" revision={attempt} />
      ) : (
        <section className="access-panel platform-catalog" aria-label="企业列表">
          <div className="platform-list-heading">
            <h2>企业</h2>
            <form
              className="platform-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(draftQuery.trim());
                setPage(0);
              }}
            >
              <label className="platform-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="搜索企业"
                  value={draftQuery}
                  maxLength={100}
                  placeholder="搜索企业名称"
                  onChange={(e) => setDraftQuery(e.target.value)}
                />
              </label>
              <Button type="submit">搜索</Button>
              <select
                aria-label="企业状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">全部状态</option>
                <option value="ACTIVE">入口启用</option>
                <option value="SUSPENDED">入口已停用</option>
              </select>
            </form>
          </div>
          {list.error ? (
            <Failure error={list.error} retry={refresh} />
          ) : !list.value ? (
            <Loading />
          ) : (
            <>
              {list.value.length ? (
                <ul className="platform-tenant-list">
                  {list.value.slice(0, 20).map((item) => (
                    <li key={item.id}>
                      <button
                        className="platform-tenant-row"
                        onClick={() => setTenant(item.id)}
                        aria-label={`查看企业 ${item.name}`}
                      >
                        <span className="platform-tenant-icon">
                          <Building2 size={22} />
                        </span>
                        <span className="platform-tenant-name">
                          <strong>{item.name}</strong>
                          <small>{item.id}</small>
                        </span>
                        <Badge blue={item.status === 'ACTIVE'}>{statusLabel(item.status)}</Badge>
                        <ChevronRight size={18} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty
                  icon={Building2}
                  title={query || status ? '没有符合条件的企业' : '还没有企业'}
                  text={
                    query || status
                      ? '调整搜索内容或状态后再试。'
                      : '开通企业并邀请初始管理员，开始使用梦核工作空间。'
                  }
                />
              )}
              {(page > 0 || list.value.length > 20) && (
                <Pager page={page} next={list.value.length > 20} onPage={setPage} />
              )}
            </>
          )}
        </section>
      )}
      <p className="platform-boundary">
        总台管理企业入口与技术运行信息；企业退出中的受限迁出可保留入口，实际业务状态见详情。不提供客户资料、会话或代入访问。
      </p>
      {createOpen && (
        <Modal
          title="开通企业"
          onClose={() => {
            if (!writing) setCreateOpen(false);
          }}
        >
          <CreateForm
            delivery={overview.value?.invitationDelivery}
            onCreated={(id) => {
              setCreateOpen(false);
              setTenant(id);
              setNotice('企业已开通，初始管理员邀请已生成。');
              refresh();
            }}
          />
        </Modal>
      )}
      {tenant && (
        <Modal
          title="企业详情"
          onClose={() => {
            if (!writing) setTenant(undefined);
          }}
          wide
        >
          <TenantView
            key={tenant}
            id={tenant}
            delivery={overview.value?.invitationDelivery}
            onChange={refresh}
          />
        </Modal>
      )}
    </MutationGate.Provider>
  );
}
function Overview({ value }: { value: PlatformOverview }) {
  return (
    <section className="access-panel platform-overview" aria-label="平台运行信息">
      <div className="platform-counts">
        <div>
          <span>企业总数</span>
          <strong>{value.totalTenants}</strong>
        </div>
        <div>
          <span>入口启用</span>
          <strong>{value.activeTenants}</strong>
        </div>
        <div>
          <span>入口已停用</span>
          <strong>{value.suspendedTenants}</strong>
        </div>
      </div>
      <div className="platform-runtime">
        <span>
          <ShieldCheck size={16} />
          平台服务与数据库已连接
        </span>
        <span>
          {value.invitationDelivery === 'LOCAL'
            ? '邀请使用本地投递，尚未发送短信'
            : '邀请服务未启用，暂不能开通企业或生成邀请'}
        </span>
        <time dateTime={value.checkedAt}>检查于 {time(value.checkedAt)}</time>
      </div>
    </section>
  );
}

function CreateForm({
  delivery,
  onCreated,
}: {
  delivery?: PlatformOverview['invitationDelivery'];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [designate, setDesignate] = useState(false);
  const task = useSubmission<{ name: string; adminPhone: string; designateAuthorizationOwner: boolean }>();
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(
          {
            name: name.trim(),
            adminPhone: email.trim(),
            designateAuthorizationOwner: designate,
          },
          async (body, requestId) => {
            const result = await platformClient.create({ ...body, requestId });
            onCreated(result.tenant.id);
          },
        );
      }}
    >
      <p className="muted">填写企业名称与初始管理员手机号。管理员接受邀请后，才能进入企业管理。</p>
      <fieldset disabled={task.busy || task.uncertain}>
        <Field label="企业名称">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="初始管理员手机号">
          <input
            type="tel"
            required
            maxLength={40}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <label className="governance-check">
          <input type="checkbox" checked={designate} onChange={(e) => setDesignate(e.target.checked)} />
          明确指定此初始管理员为企业授权负责人候选人
        </label>
        <p className="muted">受邀人可在加入页面明确接受职责。未勾选或存量企业不会自动获得负责人资格。</p>
      </fieldset>
      <p className="platform-help">
        {delivery === 'LOCAL'
          ? '当前环境使用本地投递，不会发送短信。邀请有效期为 72 小时。'
          : '邀请服务暂未启用，请联系平台维护者。'}
      </p>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button type="submit" variant="primary" disabled={task.busy || delivery !== 'LOCAL'}>
          {task.busy ? '正在开通…' : task.uncertain ? '重试本次开通' : '确认开通'}
        </Button>
      </FormActions>
    </form>
  );
}
function TenantView({
  id,
  delivery,
  onChange,
}: {
  id: string;
  delivery?: PlatformOverview['invitationDelivery'];
  onChange: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<'status' | 'invite'>();
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const detail = useRemote((signal) => platformClient.detail(id, signal), [id, attempt]);
  const reload = () => {
    setAction(undefined);
    setAttempt((v) => v + 1);
  };
  if (detail.error) return <Failure error={detail.error} retry={reload} />;
  if (!detail.value) return <Loading />;
  const value = detail.value;
  const changed = (result: TenantDetail) => {
    setNotice(`操作已处理，企业当前${statusLabel(result.tenant.status)}。`);
    reload();
    onChange();
  };
  if (action)
    return (
      <TenantAction
        key={action + value.version}
        detail={value}
        action={action}
        delivery={delivery}
        onBack={reload}
        onSuccess={changed}
      />
    );
  const invitation = value.initialAdminInvitation;
  return (
    <div className="platform-detail">
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      <div className="platform-detail-title">
        <div>
          <h3>{value.tenant.name}</h3>
          <code>{value.tenant.id}</code>
        </div>
        <Badge blue={value.tenant.status === 'ACTIVE'}>{statusLabel(value.tenant.status)}</Badge>
      </div>
      <DepartureStatus tenant={id} platform verification={attempt} />
      <dl className="platform-facts">
        <div>
          <dt>开通时间</dt>
          <dd>{time(value.createdAt)}</dd>
        </div>
        <div>
          <dt>有效成员</dt>
          <dd>{value.activeMemberCount}</dd>
        </div>
        <div>
          <dt>空间数量</dt>
          <dd>{value.workspaceCount}</dd>
        </div>
      </dl>
      <section className="platform-detail-section">
        <h3>初始管理员</h3>
        {invitation ? (
          <>
            <div className="platform-invitation-line">
              <strong>{invitation.phone || invitation.email}</strong>
              {invitation.phone && <LocalInviteLink invitation={invitation.id} />}
              <Badge>{invitationLabel[invitation.status]}</Badge>
            </div>
            {invitation.status !== 'ACCEPTED' && (
              <p className="muted">邀请有效至 {time(invitation.expiresAt)}</p>
            )}
            <p className="platform-invitation-id">
              邀请编号：<code>{invitation.id}</code>
            </p>
            {invitation.status !== 'ACCEPTED' && (
              <Button
                icon={Send}
                onClick={() => setAction('invite')}
                disabled={value.tenant.status !== 'ACTIVE' || delivery !== 'LOCAL'}
              >
                重新生成邀请
              </Button>
            )}
          </>
        ) : (
          <p className="muted">暂无初始管理员邀请记录，请联系平台维护者。</p>
        )}
      </section>
      <RecoveryForm tenant={id} platform />
      <FormActions>
        <Button variant="ghost" icon={RefreshCw} onClick={reload}>
          刷新详情
        </Button>
        <Button
          icon={CirclePause}
          variant={value.tenant.status === 'ACTIVE' ? 'danger' : 'secondary'}
          onClick={() => setAction('status')}
        >
          {value.tenant.status === 'ACTIVE' ? '停用企业' : '恢复使用'}
        </Button>
      </FormActions>
      {value.tenant.status === 'SUSPENDED' && (
        <p className="platform-help">企业已停用，成员访问和邀请接受已暂停；账号在其他企业的权限保留。</p>
      )}
      <div className="platform-detail-section">
        <Button aria-expanded={operationsOpen} onClick={() => setOperationsOpen((v) => !v)}>
          {operationsOpen ? '收起运行概览' : '查看企业运行概览'}
        </Button>
        {operationsOpen && <OperationsPanel scope="platform" tenant={id} revision={attempt} />}
      </div>
      <Records id={id} revision={attempt} />
    </div>
  );
}
function TenantAction({
  detail,
  action,
  delivery,
  onBack,
  onSuccess,
}: {
  detail: TenantDetail;
  action: 'status' | 'invite';
  delivery?: PlatformOverview['invitationDelivery'];
  onBack: () => void;
  onSuccess: (value: TenantDetail) => void;
}) {
  const [email, setEmail] = useState(detail.initialAdminInvitation?.phone || '');
  const task = useSubmission<{ email: string }>();
  const suspend = detail.tenant.status === 'ACTIVE';
  const label = action === 'invite' ? '重新生成邀请' : suspend ? '停用企业' : '恢复使用';
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit({ email: email.trim().toLowerCase() }, async (body, requestId) => {
          const value =
            action === 'invite'
              ? await platformClient.replaceInvitation(detail.tenant.id, {
                  requestId,
                  expectedVersion: detail.version,
                  phone: body.email,
                })
              : await platformClient.status(detail.tenant.id, {
                  requestId,
                  expectedVersion: detail.version,
                  status: suspend ? 'SUSPENDED' : 'ACTIVE',
                });
          onSuccess(value);
        });
      }}
    >
      <h3>
        {label} · {detail.tenant.name}
      </h3>
      <p className="muted">
        {action === 'invite'
          ? '生成新邀请后，原邀请立即失效。仅用于尚未加入的初始管理员；不会更改已有账号密码。'
          : suspend
            ? '停用后，该企业成员无法继续访问企业，待接受的邀请也暂停使用。不会删除资料或停用账号在其他企业的身份。'
            : '恢复后，有效成员可继续访问，仍在有效期内的邀请可接受；已停用成员的权限不会自动恢复。'}
      </p>
      {action === 'invite' && (
        <fieldset disabled={task.busy || task.uncertain}>
          <Field label="初始管理员手机号">
            <input
              type="tel"
              required
              maxLength={40}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </fieldset>
      )}
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button disabled={task.busy} onClick={onBack}>
          返回并刷新详情
        </Button>
        <Button
          type="submit"
          disabled={task.busy || (action === 'invite' && delivery !== 'LOCAL')}
          variant={action === 'status' && suspend ? 'danger' : 'primary'}
        >
          {task.busy ? '正在处理…' : task.uncertain ? '重试本次操作' : `确认${label}`}
        </Button>
      </FormActions>
    </form>
  );
}
function Records({ id, revision }: { id: string; revision: number }) {
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const records = useRemote(
    (signal) => platformClient.records(id, page * 20, signal),
    [id, page, revision, attempt],
  );
  return (
    <section className="platform-detail-section">
      <h3>管理记录</h3>
      {records.error ? (
        <Failure error={records.error} retry={() => setAttempt((v) => v + 1)} />
      ) : !records.value ? (
        <Loading />
      ) : (
        <>
          <ol className="platform-records">
            {records.value.slice(0, 20).map((item: ManagementRecord) => (
              <li key={item.id}>
                <span>
                  <strong>{actionLabel[item.action]}</strong>
                  <small>{item.actorName} · 成功</small>
                </span>
                <time dateTime={item.createdAt}>{time(item.createdAt)}</time>
              </li>
            ))}
          </ol>
          {!records.value.length && <p className="muted">暂无管理记录。</p>}
          {(page > 0 || records.value.length > 20) && (
            <Pager page={page} next={records.value.length > 20} onPage={setPage} />
          )}
        </>
      )}
    </section>
  );
}
