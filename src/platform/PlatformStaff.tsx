import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { Badge, Button, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { useSession } from '../identity/session';
import { directoryClient as api, type StaffInvitation } from './directory-client';

export function PlatformStaffList() {
  const { session, refresh: refreshIdentity } = useSession();
  const [attempt, setAttempt] = useState(0),
    [invite, setInvite] = useState(false);
  const [revoke, setRevoke] = useState<{
    id: string;
    name: string;
    invitation: boolean;
    version: number;
  } | null>(null);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    async (signal) => ({ staff: await api.staff(signal), invitations: await api.invitations(signal) }),
    [attempt],
  );
  return (
    <div className="admin-dashboard">
      <PageActions>
        <Button icon={Plus} variant="primary" onClick={() => setInvite(true)}>
          邀请管理人员
        </Button>
      </PageActions>
      <section className="admin-section">
        <h2>管理人员</h2>
        <p className="admin-note">管理人员使用独立平台账号。管理资格不包含客户业务内容访问权。</p>
        {data.error ? (
          <Failure error={data.error} retry={refresh} />
        ) : !data.value ? (
          <Loading />
        ) : (
          data.value.staff.map((staff) => (
            <div className="admin-directory-row" key={staff.id}>
              <span>
                <strong>{staff.displayName}</strong>
                <small>{staff.loginName}</small>
              </span>
              <Badge>
                {staff.status !== 'ACTIVE' ? '账号已停用' : staff.administrator ? '平台管理员' : '资格已撤销'}
              </Badge>
              {staff.administrator && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setRevoke({
                      id: staff.id,
                      name: staff.displayName,
                      invitation: false,
                      version: staff.version,
                    })
                  }
                >
                  撤销资格
                </Button>
              )}
            </div>
          ))
        )}
      </section>
      <section className="admin-section">
        <h2>成员邀请</h2>
        <p className="admin-note">展示最近 100 条邀请，对方接受后才具备平台管理资格。</p>
        {data.value?.invitations.length === 0 && <p className="admin-note">暂无邀请。</p>}
        {data.value?.invitations.map((item) => (
          <div key={item.id} className="admin-directory-row">
            <span>
              <strong>{item.loginName}</strong>
              <small>有效至 {new Date(item.expiresAt).toLocaleString('zh-CN', { hour12: false })}</small>
            </span>
            <Badge>
              {{ PENDING: '待接受', ACCEPTED: '已接受', REVOKED: '已撤销', EXPIRED: '已过期' }[item.status]}
            </Badge>
            {item.status === 'PENDING' && (
              <>
                <LocalStaffLink invitation={item} />
                <Button
                  variant="ghost"
                  onClick={() =>
                    setRevoke({ id: item.id, name: item.loginName, invitation: true, version: 0 })
                  }
                >
                  撤销邀请
                </Button>
              </>
            )}
          </div>
        ))}
      </section>
      {invite && (
        <InviteStaff
          close={() => setInvite(false)}
          saved={() => {
            setInvite(false);
            refresh();
          }}
        />
      )}
      {revoke && (
        <RevokeStaff
          target={revoke}
          close={() => setRevoke(null)}
          saved={() => {
            setRevoke(null);
            refresh();
            if (!revoke.invitation && revoke.id === session.identity?.account.id) void refreshIdentity();
          }}
        />
      )}
    </div>
  );
}
function InviteStaff({ close, saved }: { close: () => void; saved: () => void }) {
  const [phone, setPhone] = useState('');
  const task = useSubmission<{ phone: string }>();
  const locked = task.busy || task.uncertain;
  useRequestLock(locked);
  return (
    <Modal
      title="邀请管理人员"
      onClose={() => {
        if (!locked) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.submit({ phone }, async (body, id) => {
            await api.invite(body.phone, id);
            saved();
          });
        }}
      >
        <p>受邀人将拥有全部平台管理职责。与其客户账号分别登录和管理。</p>
        <Field label="手机号">
          <input
            type="tel"
            required
            maxLength={40}
            value={phone}
            disabled={locked}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <SubmitError error={task.error} uncertain={task.uncertain} />
        <div className="form-actions">
          <Button disabled={locked} onClick={close}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={task.busy || !phone.trim()}>
            {task.busy ? '正在创建…' : task.uncertain ? '核对并重试' : '创建邀请'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function RevokeStaff({
  target,
  close,
  saved,
}: {
  target: { id: string; name: string; invitation: boolean; version: number };
  close: () => void;
  saved: () => void;
}) {
  const task = useSubmission<Record<string, never>>();
  const locked = task.busy || task.uncertain;
  useRequestLock(locked);
  return (
    <Modal
      title={target.invitation ? '撤销邀请' : '撤销总台资格'}
      onClose={() => {
        if (!locked) close();
      }}
    >
      <p>
        {target.invitation
          ? `撤销给 ${target.name} 的邀请，原链接将失效。`
          : `撤销 ${target.name} 的总台资格，其总台登录和未接受的管理人员邀请将失效。客户账号及企业成员身份不受影响。`}
      </p>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <div className="form-actions">
        <Button onClick={close} disabled={locked}>
          取消
        </Button>
        <Button
          variant="danger"
          disabled={task.busy}
          onClick={() =>
            void task.submit({}, async (_, id) => {
              await (target.invitation
                ? api.revokeInvite(target.id, id)
                : api.revokeStaff(target.id, id, target.version));
              saved();
            })
          }
        >
          {task.busy ? '正在提交…' : task.uncertain ? '核对并重试' : '确认撤销'}
        </Button>
      </div>
    </Modal>
  );
}
function LocalStaffLink({ invitation }: { invitation: StaffInvitation }) {
  const [path, setPath] = useState(''),
    [error, setError] = useState(false);
  if (invitation.deliveryMode !== 'LOCAL') return null;
  return (
    <span>
      {path ? (
        <a href={path} target="_blank" rel="noopener noreferrer">
          打开合成邀请
        </a>
      ) : (
        <Button
          variant="ghost"
          onClick={() =>
            void api
              .localLink(invitation.id)
              .then((v) => setPath(v.path))
              .catch(() => setError(true))
          }
        >
          本地合成投递
        </Button>
      )}
      {error && <small role="alert">本地预览不可用</small>}
    </span>
  );
}
export function PlatformInvitation({ token, done }: { token: string; done: () => void }) {
  const { authenticated } = useSession();
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((signal) => api.previewInvite(token, signal), [token, attempt]);
  const [password, setPassword] = useState(''),
    [name, setName] = useState('');
  const task = useSubmission<{ username: string; password: string; displayName: string }>();
  const locked = task.busy || task.uncertain;
  useRequestLock(locked);
  return (
    <main className="platform-login">
      <section className="platform-login-card">
        <ShieldCheck size={32} />
        <h1>加入梦擎总台</h1>
        {data.error ? (
          <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void task.submit(
                { username: data.value!.loginName, password, displayName: name },
                async (body) => {
                  const identity = await api.acceptInvite({ ...body, token });
                  setPassword('');
                  authenticated(identity);
                  done();
                },
              );
            }}
          >
            <p>接受后可承担平台管理职责。此账号独立于客户端账号。</p>
            <Field label="受邀管理账号">
              <input readOnly value={data.value.loginName} autoComplete="username" />
            </Field>
            {!data.value.existingAccount && (
              <Field label="姓名">
                <input
                  required
                  maxLength={80}
                  value={name}
                  disabled={locked}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
            <Field label={data.value.existingAccount ? '平台账号密码' : '设置平台账号密码'}>
              <input
                type="password"
                required
                minLength={6}
                maxLength={128}
                autoComplete={data.value.existingAccount ? 'current-password' : 'new-password'}
                value={password}
                disabled={locked}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <SubmitError error={task.error} uncertain={task.uncertain} />
            <Button variant="primary" type="submit" disabled={task.busy}>
              {task.busy
                ? '正在接受…'
                : task.uncertain
                  ? '核对接受结果'
                  : data.value.existingAccount
                    ? '登录并接受邀请'
                    : '创建账号并接受邀请'}
            </Button>
          </form>
        )}
        <Button variant="ghost" disabled={locked} onClick={done}>
          返回总台登录
        </Button>
      </section>
    </main>
  );
}
