import { useContext, useEffect, useState } from 'react';
import { uuid } from '../identity/client';
import { ChevronRight, Users } from 'lucide-react';
import { Button, Badge, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useViewState, pageState } from '../shared/useViewState';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { directoryClient as api, type CustomerAccount } from './directory-client';

export function PlatformAccounts({ tenant, revision = 0 }: { tenant: string; revision?: number }) {
  const suppliedAccount = new URLSearchParams(location.hash.slice(1)).get('account');
  const routeAccount = uuid(suppliedAccount) ? suppliedAccount : null;
  const [page, setPage] = useViewState('platform', `accounts:${tenant}:page`, 0, pageState);
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.list(tenant, '', '', page * 20, signal),
    [tenant, page, attempt, revision],
  );
  return (
    <section className="platform-account-list" aria-label="企业账号列表">
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <Empty icon={Users} title="暂无企业账号" text="客户接受企业邀请后会显示在这里。" />
      ) : (
        <>
          <div className="platform-account-columns" aria-hidden="true">
            <span>姓名</span>
            <span>手机号</span>
            <span>邮箱</span>
            <span>账号状态</span>
            <span />
          </div>
          <div className="platform-account-rows">
            {data.value.slice(0, 20).map((account) => (
              <button
                type="button"
                className="platform-account-row"
                aria-label={`查看账号 ${account.displayName}`}
                key={account.id}
                onClick={() => setSelected(account.id)}
              >
                <strong>{account.displayName}</strong>
                <span>{account.phone || '—'}</span>
                <span>{account.email || '—'}</span>
                <span className="platform-account-status">
                  <Badge>{account.status === 'ACTIVE' ? '已启用' : '已停用'}</Badge>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          {(page > 0 || data.value.length > 20) && (
            <Pager page={page} next={data.value.length > 20} onPage={setPage} />
          )}
        </>
      )}
      {(routeAccount || selected) && (
        <AccountDetail
          id={routeAccount || selected}
          tenant={tenant}
          close={() => {
            setSelected('');
            if (routeAccount) location.hash = `#admin=tenants&enterprise=${tenant}&section=accounts`;
          }}
          changed={refresh}
        />
      )}
    </section>
  );
}
function AccountDetail({
  id,
  tenant,
  close,
  changed,
}: {
  id: string;
  tenant: string;
  close: () => void;
  changed: () => void;
}) {
  const pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0),
    [confirm, setConfirm] = useState(false);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote((signal) => api.detail(id, signal), [id, attempt]);
  if (data.error)
    return (
      <Modal title="账号详情" onClose={close}>
        <Failure error={data.error} retry={refresh} />
      </Modal>
    );
  if (!data.value)
    return (
      <Modal title="账号详情" onClose={close}>
        <Loading />
      </Modal>
    );
  const { account, records } = data.value;
  const memberships = data.value.memberships.filter((m) => m.tenantId === tenant);
  if (!memberships.length)
    return (
      <Modal title="账号详情" onClose={close}>
        <Empty icon={Users} title="该账号不属于当前企业" text="关闭弹窗后查看企业账号列表。" />
      </Modal>
    );
  return (
    <Modal
      title="账号详情"
      className="platform-account-modal"
      onClose={() => {
        if (!pending && !confirm) close();
      }}
    >
      <div className="platform-account-detail">
        <header className="platform-account-detail-heading">
          <h2>{account.displayName}</h2>
          <Badge>{account.status === 'ACTIVE' ? '已启用' : '已停用'}</Badge>
        </header>
        <section className="platform-account-info" aria-label="账号信息">
          <h3>账号信息</h3>
          <dl>
            <div>
              <dt>手机号</dt>
              <dd>{account.phone || '未绑定'}</dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>{account.email || '未绑定'}</dd>
            </div>
          </dl>
        </section>
        <section className="platform-account-info" aria-label="当前企业身份">
          <h3>企业身份</h3>
          {memberships.map((m) => (
            <dl key={m.tenantId}>
              <div>
                <dt>企业角色</dt>
                <dd>{m.role === 'TENANT_ADMIN' ? '企业管理员' : '成员'}</dd>
              </div>
              <div>
                <dt>成员状态</dt>
                <dd>{m.membershipStatus === 'ACTIVE' ? '已启用' : '已停用'}</dd>
              </div>
              <div>
                <dt>企业服务</dt>
                <dd>{m.serviceStatus === 'ACTIVE' ? '运行中' : '已暂停'}</dd>
              </div>
            </dl>
          ))}
        </section>
        <section className="platform-account-safety" aria-label="账号安全操作">
          <div>
            <h3>账号安全</h3>
            <p>停用影响该账号的三端和所有企业登录，成员身份与空间授权保留。</p>
          </div>
          <Button
            variant={account.status === 'ACTIVE' ? 'danger' : 'primary'}
            onClick={() => setConfirm(true)}
          >
            {account.status === 'ACTIVE' ? '停用账号' : '恢复账号'}
          </Button>
        </section>
        <details className="platform-account-history">
          <summary>
            账号处理记录 <span>{records.length ? `最近 ${records.length} 条` : '暂无记录'}</span>
          </summary>
          {records.length ? (
            records.map((r) => (
              <div className="admin-account-record" key={r.id}>
                <strong>{r.nextStatus === 'DISABLED' ? '停用账号' : '恢复账号'}</strong>
                <span>
                  {r.actorName} · {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
                <p>{r.reason}</p>
              </div>
            ))
          ) : (
            <p className="admin-note">暂无账号处理记录。</p>
          )}
        </details>
        {confirm && (
          <AccountStatus
            account={account}
            close={() => setConfirm(false)}
            saved={() => {
              setConfirm(false);
              refresh();
              changed();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
function AccountStatus({
  account,
  close,
  saved,
}: {
  account: CustomerAccount;
  close: () => void;
  saved: () => void;
}) {
  const [reason, setReason] = useState('');
  const task = useSubmission<{ reason: string; status: string }>();
  useRequestLock(task.busy || task.uncertain);
  const disable = account.status === 'ACTIVE';
  return (
    <Modal
      title={disable ? '停用统一账号' : '恢复统一账号'}
      onClose={() => {
        if (!task.busy && !task.uncertain) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.submit(
            { reason: reason.trim(), status: disable ? 'DISABLED' : 'ACTIVE' },
            async (body, requestId) => {
              await api.status(account.id, { ...body, requestId, expectedVersion: account.version });
              saved();
            },
          );
        }}
      >
        <p>
          {disable
            ? '该账号将无法登录任何企业，已有登录会话将失效。原有成员身份和资料保留。'
            : '恢复后需重新登录。已单独停用的成员身份、已撤销的空间授权或已暂停的企业不会恢复。'}
        </p>
        <Field label="处理原因">
          <textarea
            required
            maxLength={500}
            value={reason}
            disabled={task.busy || task.uncertain}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <SubmitError error={task.error} uncertain={task.uncertain} />
        <div className="form-actions">
          <Button onClick={close} disabled={task.busy || task.uncertain}>
            取消
          </Button>
          <Button
            type="submit"
            variant={disable ? 'danger' : 'primary'}
            disabled={task.busy || !reason.trim()}
          >
            {task.busy ? '正在提交…' : task.uncertain ? '核对并重试' : disable ? '确认停用' : '确认恢复'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** 旧账号审计链接定位到关联企业，不再打开全平台账号目录。 */
export function AccountEnterpriseLink({ id }: { id: string }) {
  const data = useRemote((signal) => api.detail(id, signal), [id]);
  const membership = data.value?.memberships[0];
  useEffect(() => {
    if (membership)
      location.hash = `#admin=tenants&enterprise=${membership.tenantId}&section=accounts&account=${id}`;
  }, [membership, id]);
  if (data.error) return <Failure error={data.error} retry={() => location.reload()} />;
  if (!data.value || membership) return <Loading />;
  return <Empty icon={Users} title="该账号暂无关联企业" text="企业接受成员后，可在对应企业中查看账号。" />;
}
