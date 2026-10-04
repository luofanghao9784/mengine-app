import { PlatformAccounts } from './PlatformAccounts';
import { Select } from '../shared/Select';
import { useContext, useEffect, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, Plus, RefreshCw, Search, Send } from 'lucide-react';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { useAdminRoute } from '../admin/AdminShell';
import { adminHref } from '../admin/navigation';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { LocalInviteLink } from '../identity/LocalInviteLink';
import { DepartureStatus } from '../departure/DepartureStatus';
import { RecoveryForm } from '../governance/RecoveryForm';
import { UsagePanel } from '../operations/UsagePanel';
import { useRemote, Failure, Loading, Pager, useSubmission, SubmitError, FormActions } from '../shared/admin';
import { Badge, Button, Empty, Field, Modal, PageActions } from '../shared/ui';
import type {
  PlatformOverview,
  TenantDetail,
  TenantOwner,
  ManagementRecord,
} from '../../contracts/public-api/platform-admin';
import { platformClient } from './client';
import '../governance/governance.css';
import './platform.css';
import { ownerStateLabel } from '../admin/platform-attention';

const statusLabel = (s: string) => (s === 'ACTIVE' ? '正常' : '已暂停');
const invitationLabel: Record<string, string> = {
  PENDING: '等待接受邀请',
  ACCEPTED: '已接受邀请',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
};
const ownerLabel = (owner: TenantOwner) =>
  owner.state === 'ASSIGNED'
    ? owner.name
    : {
        UNDESIGNATED: '负责人待指定',
        AWAITING_RESPONSIBILITY: '等待接受负责人职责',
        AWAITING_INVITATION: '等待接受邀请',
        INVITATION_INACTIVE: '邀请已失效，待重新邀请',
      }[owner.state];
const actionLabel: Record<string, string> = {
  TENANT_CREATE: '开通企业',
  TENANT_SUSPEND: '暂停服务',
  TENANT_RESUME: '恢复服务',
  INITIAL_ADMIN_INVITATION_REPLACE: '重新邀请初始负责人',
  INITIAL_ADMIN_INVITATION_REVOKE: '撤销初始邀请',
};
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });

export function PlatformHome({ embedded: _embedded = false }: { embedded?: boolean }) {
  const pending = useContext(RequestPending);
  const { hash } = useAdminRoute('platform');
  const params = new URLSearchParams(hash.slice(1));
  const tenant = params.get('enterprise');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useViewState('platform', 'tenants:draft', '', textState);
  const [query, setQuery] = useViewState('platform', 'tenants:query', '', textState);
  const [status, setStatus] = useViewState('platform', 'tenants:status', '', textState);
  const [page, setPage] = useViewState('platform', 'tenants:page', 0, pageState);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdTenant, setCreatedTenant] = useState<string>();
  useEffect(() => {
    if (createdTenant && !pending) {
      location.hash = adminHref('platform', 'tenants', hash, { enterprise: createdTenant });
      setCreatedTenant(undefined);
    }
  }, [createdTenant, pending, hash]);
  const list = useRemote(
    (signal) => platformClient.tenants(query, status, page * 20, 21, signal),
    [query, status, page, attempt],
  );
  const overview = useRemote((signal) => platformClient.overview(signal), [attempt]);
  const refresh = () => setAttempt((v) => v + 1);
  if (tenant)
    return (
      <TenantView key={tenant} id={tenant} delivery={overview.value?.invitationDelivery} onChange={refresh} />
    );
  return (
    <>
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh} disabled={pending}>
          刷新
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setCreateOpen(true)}
          disabled={pending || overview.value?.invitationDelivery !== 'LOCAL'}
        >
          开通企业
        </Button>
      </PageActions>
      {overview.error && <Failure error={overview.error} retry={refresh} />}
      {overview.value?.invitationDelivery === 'DISABLED' && (
        <p className="platform-help">邀请投递尚未启用，暂不能开通企业。</p>
      )}
      <section className="access-panel platform-catalog platform-enterprise-catalog" aria-label="企业列表">
        <div className="platform-list-heading">
          <form
            className="platform-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft.trim());
              setPage(0);
            }}
          >
            <div className="platform-search">
              <input
                aria-label="搜索企业"
                placeholder="搜索企业名称"
                value={draft}
                maxLength={100}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" variant="ghost" icon={Search} aria-label="搜索企业名称" />
            </div>
            <Select
              aria-label="企业状态"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">正常</option>
              <option value="SUSPENDED">已暂停</option>
            </Select>
            {(query || status) && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDraft('');
                  setQuery('');
                  setStatus('');
                  setPage(0);
                }}
              >
                清除筛选
              </Button>
            )}
          </form>
        </div>
        {list.error ? (
          <Failure error={list.error} retry={refresh} />
        ) : !list.value ? (
          <Loading />
        ) : (
          <>
            {list.value.length ? (
              <>
                <div className="platform-list-columns" aria-hidden="true">
                  <span>企业</span>
                  <span>负责人</span>
                  <span>有效成员</span>
                  <span>开通时间</span>
                  <span>服务状态</span>
                </div>
                <ul className="platform-tenant-list">
                  {list.value.slice(0, 20).map((item) => (
                    <li key={item.id}>
                      <button
                        className="platform-tenant-row"
                        aria-label={`查看企业 ${item.name}`}
                        onClick={() => {
                          location.hash = adminHref('platform', 'tenants', hash, { enterprise: item.id });
                        }}
                      >
                        <span className="platform-tenant-identity">
                          <span className="platform-tenant-name">
                            <strong>{item.name}</strong>
                          </span>
                        </span>
                        <span
                          className={`platform-owner-status ${item.owner.state === 'ASSIGNED' ? '' : 'pending'}`}
                        >
                          <small className="platform-mobile-label">负责人</small>
                          {item.owner.state === 'ASSIGNED'
                            ? item.owner.name
                            : ownerStateLabel[item.owner.state]}
                        </span>
                        <span className="platform-member-count">
                          <small className="platform-mobile-label">有效成员</small>
                          {item.activeMemberCount}
                        </span>
                        <time className="platform-created" dateTime={item.createdAt}>
                          {new Date(item.createdAt).toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </time>
                        <span className="platform-service-label">
                          <Badge blue={item.status === 'ACTIVE'}>{statusLabel(item.status)}</Badge>
                          <ChevronRight size={16} aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty
                icon={Building2}
                title={query || status ? '没有符合条件的企业' : '还没有企业'}
                text={query || status ? '调整搜索内容或清除筛选后再试。' : '开通企业并邀请负责人，开始使用。'}
              />
            )}
            {(page > 0 || list.value.length > 20) && (
              <Pager page={page} next={list.value.length > 20} onPage={setPage} />
            )}
          </>
        )}
      </section>
      {createOpen && (
        <Modal
          title="开通企业"
          onClose={() => {
            if (!pending) setCreateOpen(false);
          }}
        >
          <CreateForm
            delivery={overview.value?.invitationDelivery}
            onCreated={(id) => {
              setCreateOpen(false);
              refresh();
              setCreatedTenant(id);
            }}
          />
        </Modal>
      )}
    </>
  );
}
function CreateForm({
  delivery,
  onCreated,
}: {
  delivery?: PlatformOverview['invitationDelivery'];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [phone, setPhone] = useState('');
  const task = useSubmission<{ name: string; adminPhone: string; designateAuthorizationOwner: true }>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(
          { name: name.trim(), adminPhone: phone.trim(), designateAuthorizationOwner: true },
          async (body, requestId) => {
            const result = await platformClient.create({ ...body, requestId });
            onCreated(result.tenant.id);
          },
        );
      }}
    >
      <p className="muted">
        填写企业名称和初始负责人手机号。受邀人加入企业并明确接受职责后，成为企业负责人；已有客户账号可直接接受邀请。
      </p>
      <fieldset disabled={task.busy || task.uncertain}>
        <Field label="企业名称">
          <input required maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="初始负责人手机号">
          <input
            type="tel"
            required
            maxLength={40}
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </fieldset>
      <p className="platform-help">
        {delivery === 'LOCAL'
          ? '当前为本地投递，不会发送短信。生成后可查看邀请有效期。'
          : '邀请投递尚未启用。'}
      </p>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button type="submit" variant="primary" disabled={task.busy || delivery !== 'LOCAL'}>
          {task.busy ? '正在开通…' : task.uncertain ? '重试本次开通' : '开通并邀请负责人'}
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
  const pending = useContext(RequestPending);
  const { hash } = useAdminRoute('platform');
  const tab = new URLSearchParams(hash.slice(1)).get('section') || 'basic';
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<'status' | 'invite' | 'revoke'>();
  const [notice, setNotice] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const detail = useRemote((signal) => platformClient.detail(id, signal), [id, attempt]);
  const reload = () => {
    setAction(undefined);
    setAttempt((v) => v + 1);
  };
  if (detail.error) return <Failure error={detail.error} retry={reload} />;
  if (!detail.value) return <Loading />;
  const value = detail.value,
    invitation = value.initialAdminInvitation;
  return (
    <section
      className="access-panel platform-enterprise-detail platform-enterprise-redesign"
      aria-label="企业详情"
    >
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={reload} disabled={pending}>
          刷新详情
        </Button>
      </PageActions>
      <div className="platform-enterprise-heading">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          className="platform-detail-back"
          aria-label="返回企业列表"
          disabled={pending || !!action}
          onClick={() => {
            location.hash = adminHref('platform', 'tenants', hash);
          }}
        />
        <div className="platform-enterprise-heading-text">
          <h2>{value.tenant.name}</h2>
          <p>负责人：{ownerLabel(value.owner)}</p>
        </div>
        <Badge blue={value.tenant.status === 'ACTIVE'}>{statusLabel(value.tenant.status)}</Badge>
      </div>
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      <nav className="platform-detail-nav" aria-label="企业详情内容">
        {[
          ['basic', '基本信息'],
          ['accounts', '企业账号'],
          ['usage', '运行与用量'],
          ['records', '管理记录'],
        ].map(([key, label]) => (
          <Button
            key={key}
            disabled={pending || !!action}
            variant="ghost"
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => {
              location.hash = adminHref('platform', 'tenants', hash, { enterprise: id, section: key });
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === 'accounts' ? (
        <PlatformAccounts key={id} tenant={id} revision={attempt} />
      ) : tab === 'usage' ? (
        <UsagePanel scope="platform" tenant={id} revision={attempt} />
      ) : tab === 'records' ? (
        <Records id={id} revision={attempt} />
      ) : (
        <>
          <DepartureStatus tenant={id} platform verification={attempt} />
          {value.serviceChange && (
            <section className="platform-service-state" aria-label="最近服务变更">
              <p>
                <strong>
                  {value.serviceChange.status === 'SUSPENDED' ? '暂停' : '恢复'}于{' '}
                  {time(value.serviceChange.changedAt)}
                </strong>
              </p>
              <p>企业可见说明：{value.serviceChange.publicReason}</p>
              <p className="muted">内部处理备注：{value.serviceChange.internalReason}</p>
            </section>
          )}
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
          <details
            className="platform-detail-section platform-invite-history"
            open={invitation?.status !== 'ACCEPTED' || undefined}
          >
            <summary>
              {invitation?.status === 'ACCEPTED' ? '初始邀请记录' : '初始负责人邀请'}
              <span>{invitation && invitationLabel[invitation.status]}</span>
            </summary>
            {invitation ? (
              <>
                <div className="platform-invitation-line">
                  <strong>{invitation.phone || invitation.email}</strong>
                  <Badge>{invitationLabel[invitation.status]}</Badge>
                </div>
                {invitation.status === 'PENDING' && (
                  <>
                    <p className="muted">有效至 {time(invitation.expiresAt)}</p>
                    {delivery === 'LOCAL' && <LocalInviteLink platform invitation={invitation.id} />}
                  </>
                )}
                {invitation.status === 'ACCEPTED' ? (
                  <p className="muted">
                    邀请已被接受。后续负责人交接由企业当前负责人发起，总台不替换负责人。
                  </p>
                ) : (
                  <FormActions>
                    <Button
                      icon={Send}
                      onClick={() => setAction('invite')}
                      disabled={value.tenant.status !== 'ACTIVE' || delivery !== 'LOCAL'}
                    >
                      重新邀请或更换手机号
                    </Button>
                    {invitation.status !== 'REVOKED' && (
                      <Button variant="ghost" onClick={() => setAction('revoke')}>
                        撤销邀请
                      </Button>
                    )}
                  </FormActions>
                )}
              </>
            ) : (
              <p className="muted">没有初始邀请记录。</p>
            )}
          </details>
          <section className="platform-enterprise-management" aria-label="企业管理操作">
            <h3>管理操作</h3>
            <div className="platform-management-row">
              <div>
                <strong>企业服务</strong>
                <p>
                  {value.tenant.status === 'ACTIVE'
                    ? '调整企业访问与后续运行的服务状态。'
                    : '企业服务已暂停，可在核对后恢复。'}
                </p>
              </div>
              <Button
                variant={value.tenant.status === 'ACTIVE' ? 'ghost' : 'primary'}
                onClick={() => setAction('status')}
                disabled={pending}
              >
                {value.tenant.status === 'ACTIVE' ? '暂停服务' : '恢复服务'}
              </Button>
            </div>
            <div className="platform-management-row">
              <div>
                <strong>负责人恢复受理</strong>
                <p>负责人无法履职或身份未核实时，登记申请并等待核验。</p>
              </div>
              <Button variant="ghost" onClick={() => setRecoveryOpen(true)} disabled={pending}>
                登记申请
              </Button>
            </div>
          </section>
        </>
      )}
      {action && (
        <Modal
          className="platform-management-modal"
          title={
            action === 'invite'
              ? '重新邀请负责人'
              : action === 'revoke'
                ? '撤销邀请'
                : value.tenant.status === 'ACTIVE'
                  ? '暂停企业服务'
                  : '恢复企业服务'
          }
          onClose={() => {
            if (!pending) setAction(undefined);
          }}
        >
          <TenantAction
            key={action}
            detail={value}
            action={action}
            delivery={delivery}
            onBack={reload}
            onSuccess={() => {
              setNotice('操作已处理，已重新核对企业状态。');
              reload();
              onChange();
            }}
          />
        </Modal>
      )}
      {recoveryOpen && (
        <Modal
          className="platform-management-modal"
          title="负责人恢复受理"
          onClose={() => {
            if (!pending) setRecoveryOpen(false);
          }}
        >
          <RecoveryForm tenant={id} platform />
        </Modal>
      )}
    </section>
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
  action: 'status' | 'invite' | 'revoke';
  delivery?: PlatformOverview['invitationDelivery'];
  onBack: () => void;
  onSuccess: (value: TenantDetail) => void;
}) {
  const [email, setEmail] = useState(detail.initialAdminInvitation?.phone || '');
  const [internalReason, setInternalReason] = useState('');
  const [publicReason, setPublicReason] = useState('');
  const task = useSubmission<{ email: string; internalReason: string; publicReason: string }>();
  useRequestLock(task.busy || task.uncertain);
  const suspend = detail.tenant.status === 'ACTIVE';
  const label =
    action === 'invite'
      ? '重新邀请负责人'
      : action === 'revoke'
        ? '撤销邀请'
        : suspend
          ? '暂停服务'
          : '恢复服务';
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(
          {
            email: email.trim().toLowerCase(),
            internalReason: internalReason.trim(),
            publicReason: publicReason.trim(),
          },
          async (body, requestId) => {
            const value =
              action === 'revoke'
                ? await platformClient.revokeInvitation(detail.tenant.id, {
                    requestId,
                    expectedVersion: detail.version,
                  })
                : action === 'invite'
                  ? await platformClient.replaceInvitation(detail.tenant.id, {
                      requestId,
                      expectedVersion: detail.version,
                      phone: body.email,
                    })
                  : await platformClient.status(detail.tenant.id, {
                      requestId,
                      expectedVersion: detail.version,
                      status: suspend ? 'SUSPENDED' : 'ACTIVE',
                      internalReason: body.internalReason,
                      publicReason: body.publicReason,
                    });
            onSuccess(value);
          },
        );
      }}
    >
      <p className="platform-action-target">{detail.tenant.name}</p>
      <p className="muted">
        {action === 'revoke'
          ? '撤销后，此邀请立即失效；企业仍保留，可稍后重新邀请。已接受的邀请不能撤销或由总台更换负责人。'
          : action === 'invite'
            ? '生成新邀请后，原邀请立即失效。仅用于尚未加入的初始负责人；不会更改已有账号密码。'
            : suspend
              ? '暂停后，该企业成员无法继续访问企业，待接受的邀请也暂停使用。不会删除资料或停用账号在其他企业的身份。'
              : '恢复后，有效成员可继续访问，仍在有效期内的邀请可接受；已停用成员的权限不会自动恢复。'}
      </p>
      {action === 'invite' && (
        <fieldset disabled={task.busy || task.uncertain}>
          <Field label="初始负责人手机号">
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
      {action === 'status' && (
        <fieldset disabled={task.busy || task.uncertain}>
          <Field label="内部处理备注">
            <textarea
              required
              maxLength={1000}
              value={internalReason}
              onChange={(e) => setInternalReason(e.target.value)}
              placeholder="仅总台管理人员可见"
            />
          </Field>
          <Field label="企业可见说明">
            <textarea
              required
              maxLength={1000}
              value={publicReason}
              onChange={(e) => setPublicReason(e.target.value)}
              placeholder="说明服务状态与联系指引，勿填写内部敏感信息"
            />
          </Field>
          <p className="platform-help">
            {suspend
              ? '暂停后不再发起新任务；在途任务停止后续动作，已发生结果另行核对。暂停不会删除资料或启动企业退出。'
              : '恢复有效访问及后续正常调度，不补跑错过的执行，不恢复单独停用的成员、授权或计划。未完成任务仍需单独处理。'}
          </p>
        </fieldset>
      )}
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button disabled={task.busy || task.uncertain} onClick={onBack}>
          取消
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
                  {item.internalReason && <small>内部：{item.internalReason}</small>}
                  {item.publicReason && <small>企业可见：{item.publicReason}</small>}
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
