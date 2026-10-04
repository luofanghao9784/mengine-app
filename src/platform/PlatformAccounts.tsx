import { Select } from '../shared/Select';
import { useEffect, useState } from 'react';
import { uuid } from '../identity/client';
import { ArrowLeft, Search, Users } from 'lucide-react';
import { Button, Badge, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { useRequestLock } from '../shared/request-guard';
import { directoryClient as api, type CustomerAccount } from './directory-client';

export function PlatformAccounts({ tenant, revision = 0 }: { tenant: string; revision?: number }) {
  const suppliedAccount = new URLSearchParams(location.hash.slice(1)).get('account');
  const routeAccount = uuid(suppliedAccount) ? suppliedAccount : null;
  const [query, setQuery] = useViewState('platform', `accounts:${tenant}:query`, '', textState);
  const [draft, setDraft] = useState(query);
  const [status, setStatus] = useViewState('platform', `accounts:${tenant}:status`, '', textState);
  const [page, setPage] = useViewState('platform', `accounts:${tenant}:page`, 0, pageState);
  const [selected, setSelected] = useViewState('platform', `accounts:${tenant}:selected`, '', textState);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.list(tenant, query, status, page * 20, signal),
    [tenant, query, status, page, attempt, revision],
  );
  if (routeAccount || selected)
    return (
      <AccountDetail
        id={routeAccount || selected}
        tenant={tenant}
        close={() => {
          setSelected('');
          if (routeAccount) location.hash = `#admin=tenants&enterprise=${tenant}&section=accounts`;
        }}
        changed={refresh}
      />
    );
  return (
    <section className="admin-section">
      <div className="platform-list-heading admin-directory-heading">
        <form
          className="platform-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft.trim());
            setPage(0);
          }}
        >
          <label className="platform-search">
            <Search size={18} />
            <input
              aria-label="搜索账号"
              placeholder="姓名、手机号或邮箱"
              maxLength={180}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <Button type="submit">搜索</Button>
          <Select
            aria-label="账号状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">已启用</option>
            <option value="DISABLED">已停用</option>
          </Select>
          {(query || status) && (
            <Button
              variant="ghost"
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
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <Empty
          icon={Users}
          title="没有匹配的账号"
          text={query || status ? '调整搜索条件后重试。' : '客户接受企业邀请后会显示在这里。'}
        />
      ) : (
        <>
          <div className="admin-directory-list">
            {data.value.slice(0, 20).map((account) => (
              <button
                type="button"
                className="admin-directory-row"
                key={account.id}
                onClick={() => setSelected(account.id)}
              >
                <span>
                  <strong>{account.displayName}</strong>
                  <small>{account.phone || account.email}</small>
                </span>

                <Badge>{account.status === 'ACTIVE' ? '已启用' : '已停用'}</Badge>
              </button>
            ))}
          </div>
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function AccountDetail({ id, tenant, close, changed }: { id: string; tenant: string; close: () => void; changed: () => void }) {
  const [attempt, setAttempt] = useState(0),
    [confirm, setConfirm] = useState(false);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote((signal) => api.detail(id, signal), [id, attempt]);
  if (data.error) return <Failure error={data.error} retry={refresh} />;
  if (!data.value) return <Loading />;
  const { account, records } = data.value;
  const memberships = data.value.memberships.filter((m) => m.tenantId === tenant);
  if (!memberships.length) return <Empty icon={Users} title="该账号不属于当前企业" text="返回企业账号列表查看。" />;
  return (
    <div className="admin-dashboard">
      <div>
        <Button variant="ghost" icon={ArrowLeft} onClick={close}>
          返回账号列表
        </Button>
      </div>
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>{account.displayName}</h2>
            <p className="admin-note">{account.phone || account.email}</p>
          </div>
          <Badge>{account.status === 'ACTIVE' ? '已启用' : '已停用'}</Badge>
        </div>
        <p className="admin-note">安全处置影响该账号的所有企业登录，不变更企业成员身份或空间授权。</p>
        <Button
          variant={account.status === 'ACTIVE' ? 'danger' : 'secondary'}
          onClick={() => setConfirm(true)}
        >
          {account.status === 'ACTIVE' ? '停用账号' : '恢复账号'}
        </Button>
      </section>
      <section className="admin-section">
        <h2>企业身份</h2>
        {memberships.length ? (
          memberships.map((m) => (
            <div className="admin-directory-row" key={m.tenantId}>
              <span>
                {m.tenantName}
                <small>{m.role === 'TENANT_ADMIN' ? '企业管理员' : '成员'}</small>
              </span>
              <Badge>{m.membershipStatus === 'ACTIVE' ? '成员已启用' : '成员已停用'}</Badge>
              <span>{m.serviceStatus === 'ACTIVE' ? '服务正常' : '企业已暂停'}</span>
            </div>
          ))
        ) : (
          <p className="admin-note">尚无企业成员身份。</p>
        )}
      </section>
      <section className="admin-section">
        <h2>账号处理记录</h2>
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
      </section>
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
      title={disable ? '停用客户账号' : '恢复客户账号'}
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
    if (membership) location.hash = `#admin=tenants&enterprise=${membership.tenantId}&section=accounts&account=${id}`;
  }, [membership, id]);
  if (data.error) return <Failure error={data.error} retry={() => location.reload()} />;
  if (!data.value || membership) return <Loading />;
  return <Empty icon={Users} title="该账号暂无关联企业" text="企业接受成员后，可在对应企业中查看账号。" />;
}
