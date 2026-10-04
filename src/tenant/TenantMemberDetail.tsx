import { useContext, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { tenantClient as api } from './client';
import { useSession } from '../identity/session';
import { adminHref } from '../admin/navigation';
import { Badge, Button, Modal } from '../shared/ui';
import { Failure, Loading, MutationGate, useRemote } from '../shared/admin';
import { RequestPending } from '../shared/request-guard';
import { Confirm, EmergencyStop } from './TenantAdminHome';
import { DeparturePanel } from '../departure/DeparturePanel';

export function TenantMemberDetail({
  tenant,
  account,
  hash,
}: {
  tenant: string;
  account: string;
  hash: string;
}) {
  const { session, refresh: refreshIdentity } = useSession();
  const [attempt, setAttempt] = useState(0),
    [writing, setWriting] = useState(false),
    [action, setAction] = useState<'status' | 'emergency'>();
  const [notice, setNotice] = useState('');
  const locked = useContext(RequestPending);
  useEffect(() => {
    const update = () => setAttempt((n) => n + 1);
    window.addEventListener('departure-state-changed', update);
    return () => window.removeEventListener('departure-state-changed', update);
  }, []);
  const remote = useRemote((signal) => api.member(tenant, account, signal), [tenant, account, attempt]);
  const params = new URLSearchParams(hash.slice(1)),
    offboard = params.get('flow') === 'offboard';
  const self = account === session.identity?.account.id;
  const saved = async (message: string) => {
    setAction(undefined);
    setNotice(message);
    setAttempt((n) => n + 1);
    if (self) await refreshIdentity(true);
  };
  return (
    <MutationGate.Provider value={setWriting}>
      <a className="button ghost" href={adminHref('tenant', 'members', hash, { tab: 'members' })}>
        <ArrowLeft size={16} />
        返回企业成员
      </a>
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      {remote.error ? (
        <Failure error={remote.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <section className="access-panel governance-panel">
            <h2>{remote.value.member.displayName}</h2>
            <p className="muted">{remote.value.member.phone || remote.value.member.email}</p>
            <div className="governance-toolbar">
              <Badge>
                {remote.value.owner
                  ? '企业负责人'
                  : remote.value.member.role === 'TENANT_ADMIN'
                    ? '企业管理员'
                    : '普通成员'}
              </Badge>
              <Badge>{remote.value.member.status === 'ACTIVE' ? '本企业已启用' : '本企业已停用'}</Badge>
              {remote.value.member.accountStatus === 'DISABLED' && <Badge>登录账号已停用</Badge>}
            </div>
            <p>成员身份和内容权限分别管理。空间授权请到对应共享空间核对。</p>
            {remote.value.owner && <p>当前企业负责人需要先完成负责人交接，才能普通停用或正式离职。</p>}
            <div className="governance-toolbar">
              <Button
                disabled={
                  writing ||
                  locked ||
                  remote.value.offboarded ||
                  (remote.value.owner && remote.value.member.status === 'ACTIVE')
                }
                onClick={() => setAction('status')}
              >
                {remote.value.member.status === 'ACTIVE' ? '停用本企业身份' : '恢复本企业身份'}
              </Button>
              <a
                className="button ghost"
                href={adminHref('tenant', 'members', hash, { detail: 'duties', member: account })}
              >
                身份与负责人交接
              </a>
            </div>
            {remote.value.canOffboard && !offboard && (
              <a
                className="button"
                href={adminHref('tenant', 'members', hash, {
                  detail: 'member',
                  member: account,
                  flow: 'offboard',
                })}
              >
                {remote.value.departureId ? '查看离职处理' : '办理离职'}
              </a>
            )}
            {remote.value.offboarded && (
              <p className="muted">该成员已办理离职。撤销须由获权人员在离职记录中处理。</p>
            )}
            {!remote.value.canOffboard && !self && (
              <p className="muted">正式离职需由已获离职办理资格的人员处理。</p>
            )}
            {remote.value.member.status === 'ACTIVE' && (
              <details className="governance-section">
                <summary>安全异常处置</summary>
                <p>仅用于已识别的账号安全风险。紧急停用不转移负责人职责。</p>
                <Button variant="danger" disabled={writing || locked} onClick={() => setAction('emergency')}>
                  紧急安全停用
                </Button>
              </details>
            )}
          </section>
          {offboard && remote.value.canOffboard && (
            <DeparturePanel
              tenant={tenant}
              memberId={account}
              executionId={remote.value.departureId || undefined}
            />
          )}
          {action && (
            <Modal
              title={
                action === 'emergency'
                  ? '紧急安全停用'
                  : remote.value.member.status === 'ACTIVE'
                    ? '停用本企业身份'
                    : '恢复本企业身份'
              }
              onClose={() => {
                if (!writing && !locked) setAction(undefined);
              }}
            >
              {action === 'emergency' ? (
                <EmergencyStop tenant={tenant} member={remote.value.member} complete={saved} />
              ) : (
                <Confirm
                  action={remote.value.member.status === 'ACTIVE' ? '确认停用' : '确认恢复'}
                  danger={remote.value.member.status === 'ACTIVE'}
                  submit={async (requestId) => {
                    const m = remote.value!.member;
                    await api.status(tenant, account, {
                      requestId,
                      expectedVersion: m.version,
                      status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                    });
                    await saved('本企业成员状态已更新。');
                  }}
                >
                  <p>
                    {remote.value.member.status === 'ACTIVE'
                      ? '停用后无法访问本企业，资料和原授权保留；其他企业身份不受影响。此操作不等于正式离职。'
                      : '恢复仅按当前有效授权开放本企业。已单独撤销的权限不会恢复；全局停用的账号仍需另行处理。'}
                  </p>
                </Confirm>
              )}
            </Modal>
          )}
        </>
      )}
    </MutationGate.Provider>
  );
}
