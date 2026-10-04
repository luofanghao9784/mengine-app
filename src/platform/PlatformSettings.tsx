import { useContext, useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Button, Badge, Empty, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { useSession } from '../identity/session';
import { PasswordField } from '../identity/PhoneAuth';
import { IdentityError } from '../identity/client';
import { PlatformStaffList } from './PlatformStaff';
import { settingsClient as api, type ManagementRecord } from './settings-client';

const actions: Record<string, string> = {
  TENANT_CREATE: '开通企业',
  TENANT_SUSPEND: '暂停企业服务',
  TENANT_RESUME: '恢复企业服务',
  INITIAL_ADMIN_INVITATION_REPLACE: '重新邀请初始负责人',
  INITIAL_ADMIN_INVITATION_REVOKE: '撤销初始负责人邀请',
  CUSTOMER_ACCOUNT_DISABLE: '停用客户账号',
  CUSTOMER_ACCOUNT_ENABLE: '恢复客户账号',
  PLATFORM_BOOTSTRAP: '初始化总台人员',
  PLATFORM_STAFF_INVITE: '邀请管理人员',
  PLATFORM_INVITE_REVOKE: '撤销管理人员邀请',
  PLATFORM_STAFF_REVOKE: '撤销管理资格',
  PLATFORM_INVITE_ACCEPT: '接受管理邀请',
  PLATFORM_LOGIN: '登录总台',
  PLATFORM_LOGOUT: '退出总台',
  PLATFORM_LOGIN_FAILED: '总台登录被拒绝',
  PLATFORM_PASSWORD_CHANGE: '修改本人密码',
  PLATFORM_PASSWORD_CHANGE_FAILED: '改密校验未通过',
};
function targetHref(r: ManagementRecord) {
  if (r.category === 'ENTERPRISE' && r.tenantId)
    return `#admin=tenants&enterprise=${r.tenantId}&section=records`;
  if (r.category === 'ACCOUNT' && r.targetId) return `#admin=accounts&account=${r.targetId}`;
  if (r.category === 'STAFF') return '#admin=settings&section=staff';
  return null;
}
export function PlatformSettings({ hash }: { hash: string }) {
  const section = new URLSearchParams(hash.slice(1)).get('section');
  const current = section === 'records' || section === 'account' ? section : 'staff';
  const pending = useContext(RequestPending);
  return (
    <div className="admin-dashboard">
      <nav className="platform-detail-nav" aria-label="总台设置栏目">
        {(
          [
            ['staff', '管理人员'],
            ['records', '管理记录'],
            ['account', '我的账号'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            disabled={pending}
            variant={current === key ? 'primary' : 'ghost'}
            aria-current={current === key ? 'page' : undefined}
            onClick={() => {
              location.hash = `admin=settings&section=${key}`;
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      {current === 'staff' ? (
        <PlatformStaffList />
      ) : current === 'records' ? (
        <ManagementRecords />
      ) : (
        <MyPlatformAccount />
      )}
    </div>
  );
}
function ManagementRecords() {
  const [category, setCategory] = useViewState('platform', 'records:category', '', textState);
  const [outcome, setOutcome] = useViewState('platform', 'records:outcome', '', textState);
  const [page, setPage] = useViewState('platform', 'records:page', 0, pageState);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.records(category, outcome, page * 20, signal),
    [category, outcome, page, attempt],
  );
  return (
    <section className="admin-section admin-records">
      <PageActions>
        <Button icon={RefreshCw} variant="ghost" onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <div className="admin-section-heading">
        <h2>管理记录</h2>
        <div className="platform-filters">
          <select
            aria-label="操作类别"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部类别</option>
            <option value="ENTERPRISE">企业服务</option>
            <option value="ACCOUNT">客户账号</option>
            <option value="STAFF">管理人员</option>
            <option value="SECURITY">登录与安全</option>
          </select>
          <select
            aria-label="执行结果"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部结果</option>
            <option value="SUCCESS">已完成</option>
            <option value="DENIED">已拒绝</option>
          </select>
        </div>
      </div>
      <p className="admin-note">企业服务、账号和管理人员的操作记录。</p>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <Empty icon={History} title="暂无匹配的记录" text="可调整筛选条件后查看。" />
      ) : (
        <>
          {data.value.slice(0, 20).map((r) => {
            const href = targetHref(r);
            return (
              <article className="admin-account-record" key={r.id}>
                <div className="admin-section-heading">
                  <strong>{actions[r.action] || '管理操作'}</strong>
                  <Badge>{r.outcome === 'SUCCESS' ? '已完成' : '已拒绝'}</Badge>
                </div>
                <span>
                  {r.actorName || (r.actorId ? '历史管理人员' : '未验证身份')} ·{' '}
                  {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
                {href ? (
                  <a href={href}>{r.targetName || r.tenantName || '查看管理对象'}</a>
                ) : (
                  r.targetName && <p>{r.targetName}</p>
                )}
                {r.internalReason && <p>内部备注：{r.internalReason}</p>}
                {r.publicReason && <p>企业可见说明：{r.publicReason}</p>}
              </article>
            );
          })}
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function MyPlatformAccount() {
  const { session, expire } = useSession();
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'unknown'>('idle');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useRequestLock(state !== 'idle');
  return (
    <section className="admin-section admin-credentials">
      <h2>我的账号</h2>
      <p>
        {session.identity?.account.displayName} ·{' '}
        {session.identity?.account.phone || session.identity?.account.email}
      </p>
      {state === 'done' || state === 'unknown' ? (
        <div>
          <p role="status">
            {state === 'done'
              ? '密码已修改，所有总台登录已失效。请使用新密码重新登录。'
              : '暂时无法确认密码是否修改成功。请重新登录核对，先尝试新密码；如果不成功，再尝试原密码。'}
          </p>
          <Button variant="primary" onClick={expire}>
            返回总台登录
          </Button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            if (next !== confirm) {
              setError('两次输入的新密码不一致。');
              return;
            }
            if (next === current) {
              setError('新密码需要与当前密码不同。');
              return;
            }
            submitting.current = true;
            setState('busy');
            setError('');
            try {
              await api.password(current, next);
              setCurrent('');
              setNext('');
              setConfirm('');
              setState('done');
            } catch (e) {
              if (
                e instanceof IdentityError &&
                e.status >= 400 &&
                e.status < 500 &&
                !['UNCERTAIN_RESULT', 'CONTRACT_MISMATCH'].includes(e.code)
              ) {
                if (e.status === 401) {
                  expire();
                  return;
                }
                setError(e.message);
                setState('idle');
              } else {
                setCurrent('');
                setNext('');
                setConfirm('');
                setState('unknown');
              }
            } finally {
              submitting.current = false;
            }
          }}
        >
          <fieldset disabled={state === 'busy'}>
            <PasswordField label="当前总台密码" value={current} change={setCurrent} />
            <PasswordField label="新总台密码" value={next} change={setNext} creating />
            <PasswordField label="确认新密码" value={confirm} change={setConfirm} creating />
            <p className="admin-note">
              修改后，所有设备上的总台登录会失效。客户账号与企业管理端登录保持原状。
            </p>
            {error && (
              <p className="access-alert" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary">
              {state === 'busy' ? '正在修改…' : '修改密码'}
            </Button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
