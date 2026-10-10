import { Select } from '../shared/Select';
import { useContext, useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Button, Badge, Empty, PageActions, Field } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { useSession } from '../identity/session';
import { PasswordField } from '../identity/PhoneAuth';
import { IdentityError } from '../identity/client';
import { PlatformStaffList } from './PlatformStaff';
import { settingsClient as api, type ManagementRecord } from './settings-client';

const actions: Record<string, string> = {
  GENERAL_EXPERIENCE_ADJUSTMENT_SUBMITTED: '提交经验调整',
  GENERAL_EXPERIENCE_ADJUSTMENT_PUBLISHED: '自动发布经验调整',
  GENERAL_EXPERIENCE_STOP: '停用通用经验',
  GENERAL_EXPERIENCE_RESTORE: '恢复通用经验',
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
  PLATFORM_INITIALIZATION_REQUEST: '发起首位管理员激活',
  PLATFORM_CREDENTIALS_SET: '设置总台专用凭据',
  UNIFIED_IDENTITY_LINK: '关联统一账号',
  PLATFORM_PASSWORD_CHANGE: '修改本人密码',
  PLATFORM_PASSWORD_CHANGE_FAILED: '改密校验未通过',
};
function targetHref(r: ManagementRecord) {
  if (r.category === 'ENTERPRISE' && r.tenantId)
    return `#admin=tenants&enterprise=${r.tenantId}&section=records`;
  if (r.category === 'ACCOUNT' && r.targetId)
    return `#admin=tenants&directory=accounts&account=${r.targetId}`;
  if (r.category === 'STAFF') return '#admin=settings&section=staff';
  return null;
}
export function PlatformSettings({ hash }: { hash: string }) {
  const section = new URLSearchParams(hash.slice(1)).get('section');
  const current = section === 'records' || section === 'account' ? section : 'staff';
  const pending = useContext(RequestPending);
  return (
    <div className="admin-dashboard">
      <nav className="platform-detail-nav platform-settings-nav" aria-label="总台设置栏目">
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
            variant="ghost"
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
        <>
          <MyPlatformAccount />
          <LinkCustomerAccount />
        </>
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
          <Select
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
            <option value="EXPERIENCE">通用经验</option>
          </Select>
          <Select
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
          </Select>
        </div>
      </div>
      <p className="admin-note">企业服务、账号、管理人员与通用经验的操作记录。</p>
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
  const credentials = useRemote(() => api.credentials(), []);
  const [username, setUsername] = useState('');
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
      {!session.identity?.account.phone && (
        <p>
          <a href="/workspace/#bind">绑定手机号并设置统一登录密码</a>（需要已启用手机核验）
        </p>
      )}
      {state === 'done' || state === 'unknown' ? (
        <div>
          <p role="status">
            {state === 'done'
              ? '专用凭据已保存，三端旧登录均已失效。请重新登录。'
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
              await api.configureCredentials(username || credentials.value!.username, current, next);
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
            {!credentials.value ? (
              <p>正在读取专用凭据…</p>
            ) : (
              <>
                <Field label="总台专用账号">
                  <input
                    required
                    maxLength={254}
                    value={username || credentials.value.username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="手机号或英文账号"
                    autoComplete="username"
                  />
                </Field>
                <PasswordField
                  label={credentials.value.configured ? '当前总台专用密码' : '当前统一登录密码'}
                  value={current}
                  change={setCurrent}
                />
              </>
            )}
            <PasswordField label="新总台密码" value={next} change={setNext} creating />
            <PasswordField label="确认新密码" value={confirm} change={setConfirm} creating />
            <p className="admin-note">
              总台专用账号可使用手机号或以字母开头的英文账号。修改后，该账号所有设备上的三端登录均会失效，请重新登录。统一登录密码保持不变。
            </p>
            {error && (
              <p className="access-alert" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={!credentials.value}>
              {state === 'busy' ? '正在修改…' : '修改密码'}
            </Button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

function LinkCustomerAccount() {
  const { expire } = useSession();
  const [phone, setPhone] = useState(''),
    [current, setCurrent] = useState(''),
    [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useRequestLock(busy);
  return (
    <details className="admin-section">
      <summary>关联已有客户账号</summary>
      <p>
        仅用于历史上分开的总台和客户账号。分别验证两个账号后，把总台登录与权限关联到客户账号，原操作历史保留；旧总台身份停止使用，待接受的平台邀请撤销，在途平台管理工作按撤权停止。完成后所有旧登录失效。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await api.linkCustomer(current, phone, customer);
            setCurrent('');
            setCustomer('');
            expire();
          } catch (e) {
            setError(e instanceof IdentityError ? e.message : '关联结果未确认，请重新登录核对。');
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <PasswordField label="原总台专用密码" value={current} change={setCurrent} />
          <Field label="已有客户账号手机号">
            <input
              required
              autoComplete="username"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <PasswordField label="已有客户账号密码" value={customer} change={setCustomer} />
          {error && <p role="alert">{error}</p>}
          <Button type="submit">验证并关联账号</Button>
        </fieldset>
      </form>
    </details>
  );
}
