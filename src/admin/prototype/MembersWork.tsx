import { useContext, useEffect, useState } from 'react';
import { tenantClient as api } from '../../tenant/client';
import { MutationGate, useRemote } from '../../shared/admin';
import { Modal } from '../../shared/ui';
import { RequestPending, requestNavigationLocked } from '../../shared/request-guard';
import { useSession } from '../../identity/session';
import { LocalInviteLink } from '../../identity/LocalInviteLink';
import { auditActions } from '../../tenant/audit-labels';
import { Confirm, EmergencyStop, MemberInviteForm, SpaceDetail } from '../../tenant/TenantAdminHome';
import { SpaceOwnerForm } from '../../tenant/SpaceOwnerForm';
import { DeparturePanel } from '../../departure/DeparturePanel';
import { GovernancePanel, type MemberSelection } from '../../governance/GovernancePanel';
import { governanceClient } from '../../governance/client';
import { LibraryDepartments, useLibraryPermissionsEnabled } from '../../material/Permissions';
import type { Invitation } from '../../../contracts/public-api/identity';
import type { SharedWorkspace, TenantMember } from '../../../contracts/public-api/tenant-admin';
import { KnowledgeListRow } from './KnowledgeListRow';
import { MemberForm, Department, Policy, statuses, useSceneAccess } from './AccessWork';
import { WorkRoles } from './WorkRoles';
import { Facts, ListBody, ListHead, SectionTabs, errorText, useDebounced, useHashParams, usePaged } from './section-kit';
import type { Tone } from './data';

/**
 * 成员与权限：一排栏目页签 + 清单卡 / 详情卡 / 概况卡，与数据底座、知识星链同一套。
 * 动作全部沿用原有流程（停用与恢复、紧急停用、离职、交接、邀请与撤销、共享空间管理、数据访问、岗位与关注）。
 * 栏目记在 hash 的 tab，选中项记在 member / item，刷新回原处。
 */
type Tab = 'members' | 'invitations' | 'spaces' | 'duties' | 'access' | 'roles' | 'departments' | 'departure';
const NAMES: Record<Tab, string> = {
  members: '成员',
  invitations: '邀请',
  spaces: '共享空间',
  duties: '职责与交接',
  access: '数据访问',
  roles: '岗位与关注',
  departments: '资料部门',
  departure: '离职办理',
};
const role = (v: string) => (v === 'TENANT_ADMIN' ? '企业管理员' : '成员');
const when = (at: string) =>
  new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const INVITE: Record<Invitation['status'], [string, Tone]> = {
  PENDING: ['待接受', 'warn'],
  ACCEPTED: ['已加入', 'ok'],
  REVOKED: ['已撤销', 'plain'],
  EXPIRED: ['已过期', 'plain'],
};
const memberOff = (m: TenantMember) => m.status !== 'ACTIVE' || m.accountStatus === 'DISABLED';

export function MembersWork({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [params, write, hash] = useHashParams();
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const [writing, setWriting] = useState(false);
  const governance = useRemote((s) => governanceClient.snapshot(tenant, s), [tenant, attempt, session.identity]);
  const g = governance.value;
  const limited = !!g && !g.canConfigure;
  const offboarder = !!g?.capabilities.some((c) => c.capability === 'MEMBER_OFFBOARD' && c.workspaceId === null);
  const departments = useLibraryPermissionsEnabled(tenant);
  const tabs: Tab[] = limited
    ? ['spaces', 'duties', ...(offboarder ? (['departure'] as Tab[]) : []), 'access', 'roles']
    : ['members', 'invitations', 'spaces', 'duties', 'access', 'roles', ...(departments ? (['departments'] as Tab[]) : [])];
  const asked = params.get('tab') as Tab | null;
  // 旧链接与旧组件里的跳转：detail=duties 是职责与交接，detail=member 是成员详情。
  const tab: Tab =
    asked && tabs.includes(asked)
      ? asked
      : params.get('detail') === 'duties'
        ? 'duties'
        : tabs[0];
  const go = (next: Tab, item?: string) => {
    if (requestNavigationLocked() || writing) return;
    write({ tab: next, detail: null, flow: null, item: item ?? null, member: next === 'members' || next === 'roles' ? (item ?? null) : null }, true);
  };

  const overview = useRemote((s) => (limited ? Promise.resolve(null) : api.overview(tenant, s)), [tenant, attempt, limited]);
  const records = useRemote((s) => (limited ? Promise.resolve([]) : api.records(tenant, 0, s)), [tenant, attempt, limited]);
  const o = overview.value;
  const counts: Partial<Record<Tab, number>> = o
    ? { members: o.activeMemberCount + o.disabledMemberCount, spaces: o.sharedWorkspaceCount }
    : {};
  const list = tab === 'members' || (tab === 'roles' && !limited) || tab === 'invitations' || tab === 'spaces' || tab === 'access';

  return (
    <MutationGate.Provider value={setWriting}>
      <section className={`cards work glass section-work members-work${list ? '' : ' wide'}`} aria-label="成员与权限">
        {governance.error ? (
          <article className="card wide-card">
            <p className="none">{errorText(governance.error)}</p>
          </article>
        ) : !g ? (
          <article className="card wide-card">
            <p className="none">正在读取管理权限…</p>
          </article>
        ) : limited && tab === 'roles' ? (
          <article className="card wide-card">
            <Tabs tabs={tabs} counts={counts} go={go} active="roles" />
            <div className="card-scroll legacy-skin">
              <WorkRoles tenant={tenant} account={session.identity?.account.id} />
            </div>
          </article>
        ) : tab === 'members' || tab === 'roles' ? (
          <MemberPane
            key={tab}
            tenant={tenant}
            tab={tab}
            tabs={tabs}
            counts={counts}
            go={go}
            selected={params.get('member') || ''}
            select={(id) => write({ member: id, flow: null })}
            hash={hash}
            attempt={attempt}
            refresh={refresh}
            canInvite={o?.invitationDelivery === 'LOCAL'}
          />
        ) : tab === 'invitations' ? (
          <InvitationPane
            tenant={tenant}
            tabs={tabs}
            counts={counts}
            go={go}
            selected={params.get('item') || ''}
            select={(id) => write({ item: id })}
            attempt={attempt}
            refresh={refresh}
            canInvite={o?.invitationDelivery === 'LOCAL'}
          />
        ) : tab === 'spaces' ? (
          <SpacePane
            tenant={tenant}
            tabs={tabs}
            counts={counts}
            go={go}
            selected={params.get('item') || params.get('space') || ''}
            select={(id) => write({ item: id, space: null })}
            attempt={attempt}
            refresh={refresh}
            canCreate={!limited}
          />
        ) : tab === 'access' ? (
          <AccessPane tabs={tabs} counts={counts} go={go} />
        ) : (
          <article className="card wide-card">
            <SectionTabs label="成员与权限栏目" tabs={tabs.map((t) => [t, NAMES[t], counts[t]])} active={tab} onChange={(t) => go(t)} />
            <div className="card-scroll embedded legacy-skin">
              {tab === 'duties' ? (
                <Duties tenant={tenant} snapshot={g} changed={refresh} target={params.get('member') || ''} />
              ) : tab === 'departments' ? (
                <LibraryDepartments tenant={tenant} />
              ) : (
                <DeparturePanel tenant={tenant} only="member" />
              )}
            </div>
          </article>
        )}

        <div className="side">
          {limited ? (
            <Facts
              title="我的管理范围"
              rows={[
                ['空间职责', g?.capabilities.filter((c) => c.workspaceId !== null).length ?? 0],
                ['企业负责人', g?.ownerName || '—'],
              ]}
            />
          ) : (
            <Facts
              title="成员概况"
              rows={[
                ['已启用成员', o?.activeMemberCount],
                ['已停用成员', o?.disabledMemberCount],
                ['共享空间', o?.sharedWorkspaceCount],
                ['企业负责人', g?.ownerName || '—'],
              ]}
            />
          )}
          {!limited && (
            <article className="card facts more">
              <header>
                <h2>最近管理记录</h2>
              </header>
              {(records.value || []).slice(0, 8).map((r) => (
                <div key={r.id} className="fact line">
                  <span>
                    {auditActions[r.action] || r.action} · {r.targetName || '—'}
                    {r.relatedAccountName && ` → ${r.relatedAccountName}`}
                  </span>
                  <small>
                    {r.actorName} · {when(r.createdAt)}
                  </small>
                </div>
              ))}
              {records.value && !records.value.length && <p className="none">暂无管理记录</p>}
              {records.error != null && <p className="none">{errorText(records.error)}</p>}
            </article>
          )}
        </div>
      </section>
    </MutationGate.Provider>
  );
}

type PaneProps = {
  tabs: Tab[];
  counts: Partial<Record<Tab, number>>;
  go: (t: Tab, item?: string) => void;
};
function Tabs({ tabs, counts, go, active }: PaneProps & { active: Tab }) {
  return <SectionTabs label="成员与权限栏目" tabs={tabs.map((t) => [t, NAMES[t], counts[t]])} active={active} onChange={(t) => go(t)} />;
}

/* ---- 成员 / 岗位与关注：同一份成员清单，详情分别是成员管理和岗位资料 ---- */
function MemberPane({
  tenant,
  tab,
  selected,
  select,
  hash,
  attempt,
  refresh,
  canInvite,
  ...pane
}: PaneProps & {
  tenant: string;
  tab: 'members' | 'roles';
  selected: string;
  select: (id: string) => void;
  hash: string;
  attempt: number;
  refresh: () => void;
  canInvite: boolean;
}) {
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const query = useDebounced(q);
  const members = usePaged((offset, s) => api.members(tenant, query, status, offset, s), [tenant, query, status, attempt]);
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState('');
  const items = members.value?.items || [];
  const current = items.find((m) => m.accountId === selected) || (selected ? undefined : items[0]);
  const id = current?.accountId || selected;
  return (
    <>
      <article className="card list">
        <Tabs {...pane} active={tab} />
        <ListHead title="全部成员" search={[q, setQ]} placeholder="搜索姓名或手机号">
          <select aria-label="成员状态" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="ACTIVE">已启用</option>
            <option value="DISABLED">已停用</option>
          </select>
        </ListHead>
        <div className="card-scroll">
          <ListBody remote={members} empty="没有找到成员。调整搜索条件，或邀请同事加入企业。">
            {(rows) =>
              rows.map((m) => (
                <KnowledgeListRow
                  key={m.accountId}
                  name={m.displayName + (m.accountId === session.identity?.account.id ? ' · 你' : '')}
                  summary={m.phone || m.email || ''}
                  side={m.accountStatus === 'DISABLED' ? '账号已停用' : m.status !== 'ACTIVE' ? '已停用' : role(m.role)}
                  tone={memberOff(m) ? 'plain' : m.role === 'TENANT_ADMIN' ? 'run' : 'ok'}
                  selected={m.accountId === id}
                  onSelect={() => select(m.accountId)}
                />
              ))
            }
          </ListBody>
        </div>
        {tab === 'members' && (
          <footer className="list-foot">
            <button type="button" disabled={!canInvite} onClick={() => setInviting(true)}>
              邀请成员
            </button>
            {!canInvite && <small>邀请服务尚未启用</small>}
            {notice && <small role="status">{notice}</small>}
          </footer>
        )}
      </article>
      <article className="card detail" aria-live="polite">
        {!id ? (
          <header>
            <h2>没有可查看的成员</h2>
          </header>
        ) : tab === 'members' ? (
          <MemberDetail key={id} tenant={tenant} account={id} hash={hash} changed={refresh} roles={() => pane.go('roles', id)} />
        ) : (
          <>
            <header>
              <h2>{current?.displayName || '成员'}</h2>
              <span>岗位、职责与治理目标</span>
            </header>
            <div className="card-scroll legacy-skin">
              <WorkRoles key={id} tenant={tenant} account={id} />
            </div>
          </>
        )}
      </article>
      {inviting && (
        <Modal title="邀请成员" onClose={() => setInviting(false)}>
          <MemberInviteForm
            tenant={tenant}
            done={() => {
              setInviting(false);
              setNotice('成员邀请已生成，等待接受。');
              refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function MemberDetail({
  tenant,
  account,
  hash,
  changed,
  roles,
}: {
  tenant: string;
  account: string;
  hash: string;
  changed: () => void;
  roles: () => void;
}) {
  const { session, refresh: refreshIdentity } = useSession();
  const locked = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<'status' | 'emergency'>();
  const [notice, setNotice] = useState('');
  const [, write] = useHashParams();
  useEffect(() => {
    const update = () => setAttempt((n) => n + 1);
    window.addEventListener('departure-state-changed', update);
    return () => window.removeEventListener('departure-state-changed', update);
  }, []);
  const d = useRemote((s) => api.member(tenant, account, s), [tenant, account, attempt]);
  const offboard = new URLSearchParams(hash.slice(1)).get('flow') === 'offboard';
  const self = account === session.identity?.account.id;
  const saved = async (message: string) => {
    setAction(undefined);
    setNotice(message);
    setAttempt((n) => n + 1);
    changed();
    if (self) await refreshIdentity(true);
  };
  if (d.error)
    return (
      <div className="card-scroll">
        <p className="verdict tone-bad">{errorText(d.error)}</p>
      </div>
    );
  if (!d.value) return <p className="none">正在读取成员…</p>;
  const { member: m, owner, offboarded, canOffboard, departureId } = d.value;
  const active = m.status === 'ACTIVE';
  return (
    <>
      <header>
        <h2>{m.displayName}</h2>
        <span>{m.phone || m.email}</span>
      </header>
      <div className="card-scroll">
        <p className={`verdict ${offboarded ? '' : active && m.accountStatus === 'ACTIVE' ? 'tone-ok' : 'tone-warn'}`}>
          {notice ||
            (offboarded
              ? '该成员已办理离职。撤销须由获权人员在离职记录中处理。'
              : owner && active
                ? '企业负责人：需要先完成负责人交接，才能停用或正式离职。'
                : active
                  ? '正常在岗。成员身份和内容权限分别管理，空间授权到对应共享空间核对。'
                  : '本企业身份已停用，资料和原授权保留，恢复后可继续使用。')}
        </p>
        <table>
          <tbody>
            <tr>
              <th>企业角色</th>
              <td>{owner ? '企业负责人' : role(m.role)}</td>
            </tr>
            <tr>
              <th>本企业身份</th>
              <td className={active ? 'tone-ok-text' : undefined}>{active ? '已启用' : '已停用'}</td>
            </tr>
            <tr>
              <th>登录账号</th>
              <td>{m.accountStatus === 'ACTIVE' ? '可登录' : '已停用（需平台维护者处理）'}</td>
            </tr>
            <tr>
              <th>离职</th>
              <td>{offboarded ? '已办理' : departureId ? '处理中' : '未办理'}</td>
            </tr>
          </tbody>
        </table>
        {!canOffboard && !self && !offboarded && <p className="note">正式离职需由已获离职办理资格的人员处理。</p>}
        {offboard && canOffboard && (
          <div className="legacy-skin related">
            <DeparturePanel tenant={tenant} memberId={account} executionId={departureId || undefined} />
          </div>
        )}
      </div>
      <footer>
        <button
          type="button"
          className="primary"
          disabled={locked || offboarded || (owner && active)}
          onClick={() => setAction('status')}
        >
          {active ? '停用本企业身份' : '恢复本企业身份'}
        </button>
        {canOffboard && !offboard && (
          <button type="button" disabled={locked} onClick={() => write({ flow: 'offboard' })}>
            {departureId ? '查看离职处理' : '办理离职'}
          </button>
        )}
        <button
          type="button"
          disabled={locked}
          onClick={() => write({ tab: 'duties', member: account, flow: null }, true)}
        >
          身份与负责人交接
        </button>
        {active && <button type="button" onClick={roles}>岗位与关注</button>}
        {active && (
          <button type="button" className="danger" disabled={locked} onClick={() => setAction('emergency')}>
            紧急安全停用
          </button>
        )}
      </footer>
      {action && (
        <Modal
          title={action === 'emergency' ? '紧急安全停用' : active ? '停用本企业身份' : '恢复本企业身份'}
          onClose={() => {
            if (!locked) setAction(undefined);
          }}
        >
          {action === 'emergency' ? (
            <>
              <p>仅用于已识别的账号安全风险。紧急停用不转移负责人职责。</p>
              <EmergencyStop tenant={tenant} member={m} complete={saved} />
            </>
          ) : (
            <Confirm
              action={active ? '确认停用' : '确认恢复'}
              danger={active}
              submit={async (requestId) => {
                await api.status(tenant, account, {
                  requestId,
                  expectedVersion: m.version,
                  status: active ? 'DISABLED' : 'ACTIVE',
                });
                await saved('本企业成员状态已更新。');
              }}
            >
              <p>
                {active
                  ? '停用后无法访问本企业，资料和原授权保留；其他企业身份不受影响。此操作不等于正式离职。'
                  : '恢复仅按当前有效授权开放本企业。已单独撤销的权限不会恢复；全局停用的账号仍需另行处理。'}
              </p>
            </Confirm>
          )}
        </Modal>
      )}
    </>
  );
}

/* ---- 邀请 ---- */
function InvitationPane({
  tenant,
  selected,
  select,
  attempt,
  refresh,
  canInvite,
  ...pane
}: PaneProps & {
  tenant: string;
  selected: string;
  select: (id: string) => void;
  attempt: number;
  refresh: () => void;
  canInvite: boolean;
}) {
  const invitations = usePaged((offset, s) => api.invitations(tenant, offset, s), [tenant, attempt]);
  const [dialog, setDialog] = useState<'invite' | 'revoke'>();
  const [notice, setNotice] = useState('');
  const items = invitations.value?.items || [];
  const v = items.find((x) => x.id === selected) || items[0];
  const done = (message: string) => {
    setDialog(undefined);
    setNotice(message);
    refresh();
  };
  return (
    <>
      <article className="card list">
        <Tabs {...pane} active="invitations" />
        <ListHead title="最近邀请" />
        <div className="card-scroll">
          <ListBody remote={invitations} empty="还没有邀请。邀请同事，共同开始使用工作空间。">
            {(rows) =>
              rows.map((x) => (
                <KnowledgeListRow
                  key={x.id}
                  name={x.phone || x.email || '未填写联系方式'}
                  summary={`${role(x.role)} · ${when(x.expiresAt)} 到期`}
                  side={INVITE[x.status][0]}
                  tone={INVITE[x.status][1]}
                  selected={x.id === v?.id}
                  onSelect={() => select(x.id)}
                />
              ))
            }
          </ListBody>
        </div>
        <footer className="list-foot">
          <button type="button" disabled={!canInvite} onClick={() => setDialog('invite')}>
            邀请成员
          </button>
          <small>{canInvite ? '当前为本地投递，邀请不会发送短信。' : '邀请服务尚未启用，暂不能生成邀请。'}</small>
        </footer>
      </article>
      <article className="card detail" aria-live="polite">
        {!v ? (
          <header>
            <h2>没有可查看的邀请</h2>
          </header>
        ) : (
          <>
            <header>
              <h2>{v.phone || v.email}</h2>
              <span>{role(v.role)}</span>
            </header>
            <div className="card-scroll">
              <p className={`verdict tone-${INVITE[v.status][1]}`}>
                {notice || `${INVITE[v.status][0]} · 有效期至 ${when(v.expiresAt)}`}
              </p>
              {v.phone && v.status === 'PENDING' && (
                <div className="related legacy-skin">
                  <h3>本地邀请链接</h3>
                  <LocalInviteLink invitation={v.id} />
                </div>
              )}
            </div>
            {['PENDING', 'EXPIRED'].includes(v.status) && (
              <footer>
                <button type="button" className="danger" onClick={() => setDialog('revoke')}>
                  撤销邀请
                </button>
              </footer>
            )}
          </>
        )}
      </article>
      {dialog === 'invite' && (
        <Modal title="邀请成员" onClose={() => setDialog(undefined)}>
          <MemberInviteForm tenant={tenant} done={() => done('成员邀请已生成，等待接受。')} />
        </Modal>
      )}
      {dialog === 'revoke' && v && (
        <Modal title="撤销邀请" onClose={() => setDialog(undefined)}>
          <Confirm
            action="确认撤销"
            danger
            submit={async () => {
              await api.revoke(tenant, v.id);
              done('邀请已撤销。');
            }}
          >
            <p>
              撤销发给 <strong>{v.phone || v.email}</strong> 的邀请，原邀请码将失效。
            </p>
          </Confirm>
        </Modal>
      )}
    </>
  );
}

/* ---- 共享空间：详情沿用原有空间管理（成员授权、负责人、改名、归档） ---- */
function SpacePane({
  tenant,
  selected,
  select,
  attempt,
  refresh,
  canCreate,
  ...pane
}: PaneProps & {
  tenant: string;
  selected: string;
  select: (id: string) => void;
  attempt: number;
  refresh: () => void;
  canCreate: boolean;
}) {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const spaces = usePaged((offset, s) => api.spaces(tenant, query, offset, s), [tenant, query, attempt]);
  const [creating, setCreating] = useState(false);
  const items = spaces.value?.items || [];
  const v: SharedWorkspace | undefined = items.find((x) => x.id === selected) || (selected ? undefined : items[0]);
  const id = v?.id || selected;
  return (
    <>
      <article className="card list">
        <Tabs {...pane} active="spaces" />
        <ListHead title={canCreate ? '全部空间' : '我负责的空间'} search={[q, setQ]} placeholder="搜索空间" />
        <div className="card-scroll">
          <ListBody remote={spaces} empty="还没有共享空间。为团队、业务或项目创建共享空间，再授予成员访问权限。">
            {(rows) =>
              rows.map((x) => (
                <KnowledgeListRow
                  key={x.id}
                  name={x.name}
                  summary={x.ownerName ? `负责人 ${x.ownerName}` : '负责人待指定'}
                  side={`${x.memberCount} 人`}
                  tone={x.ownerId ? 'ok' : 'warn'}
                  selected={x.id === id}
                  onSelect={() => select(x.id)}
                />
              ))
            }
          </ListBody>
        </div>
        {canCreate && (
          <footer className="list-foot">
            <button type="button" onClick={() => setCreating(true)}>
              新建共享空间
            </button>
          </footer>
        )}
      </article>
      <article className="card detail" aria-live="polite">
        {!id ? (
          <header>
            <h2>没有可查看的空间</h2>
          </header>
        ) : (
          <>
            <header>
              <h2>{v?.name || '共享空间'}</h2>
              <span>{v ? `${v.memberCount} 位成员 · ${v.ownerName ? `负责人 ${v.ownerName}` : '负责人待指定'}` : ''}</span>
            </header>
            <div className="card-scroll legacy-skin space-detail">
              {v?.description && <p className="note">{v.description}</p>}
              <SpaceDetail key={id} tenant={tenant} id={id} onChange={refresh} />
            </div>
          </>
        )}
      </article>
      {creating && (
        <Modal title="创建共享空间" onClose={() => setCreating(false)}>
          <SpaceOwnerForm
            tenant={tenant}
            saved={(space) => {
              setCreating(false);
              select(space.id);
              refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}

/* ---- 职责与交接：沿用原有负责人与管理职责面板 ---- */
function Duties({
  tenant,
  snapshot,
  changed,
  target,
}: {
  tenant: string;
  snapshot: Parameters<typeof GovernancePanel>[0]['snapshot'];
  changed: () => void;
  target: string;
}) {
  const [selection, select] = useState<MemberSelection>({ query: '', page: 0, target });
  useEffect(() => {
    if (target) select({ query: '', page: 0, target });
  }, [target]);
  return <GovernancePanel tenant={tenant} snapshot={snapshot} changed={changed} selection={selection} select={select} />;
}

/* ---- 数据访问：左边资源（或审批、部门与成员、审计），右边对应的设置 ---- */
type AccessView = 'policy' | 'approvals' | 'organization' | 'audit';
function AccessPane(pane: PaneProps) {
  const a = useSceneAccess();
  const [view, setView] = useState<AccessView>('policy');
  const [pick, setPick] = useState('');
  if (!a.data)
    return (
      <>
        <article className="card list">
          <Tabs {...pane} active="access" />
          <p className="none">{a.error || '正在读取企业权限…'}</p>
        </article>
        <article className="card detail" />
      </>
    );
  const data = a.data;
  const admin = data.user.role === 'admin';
  const views: [AccessView, string][] = [
    ['policy', '资源权限'],
    ['approvals', `审批 ${data.pending}`],
    ...(admin ? ([['organization', '部门与成员']] as [AccessView, string][]) : []),
    ...(data.canViewAudit ? ([['audit', '操作审计']] as [AccessView, string][]) : []),
  ];
  const resource = data.resources.find((r) => r.id === a.selected);
  const proposal = data.proposals.find((p) => p.id === pick) || data.proposals[0];
  const member = data.members.find((m) => m.id === pick);
  const department = data.departments.find((d) => d.id === pick);
  const audit = a.audits?.items.find((x) => x.id === pick) || a.audits?.items[0];
  const switchView = (v: AccessView) => {
    setView(v);
    setPick('');
    a.setError('');
    if (v === 'audit') a.loadAudits();
  };
  return (
    <>
      <article className="card list">
        <Tabs {...pane} active="access" />
        <div className="views" role="group" aria-label="数据访问视角">
          {views.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => switchView(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="card-scroll">
          {view === 'policy' &&
            (data.resources.length ? (
              data.resources.map((r) => (
                <KnowledgeListRow
                  key={r.id}
                  name={r.title}
                  summary={`${r.audience === 'private' ? '私有' : r.audience === 'department' ? '所属部门' : '本企业'} · L${r.classification} · ${r.grants.length} 项授权`}
                  side={r.status === 'ready' ? '可用' : '受限'}
                  tone={r.status === 'ready' ? 'ok' : 'warn'}
                  selected={r.id === a.selected}
                  onSelect={() => a.setSelected(r.id)}
                />
              ))
            ) : (
              <p className="none">没有当前可查看权限配置的资源。</p>
            ))}
          {view === 'approvals' &&
            (data.proposals.length ? (
              data.proposals.map((p) => (
                <KnowledgeListRow
                  key={p.id}
                  name={p.title}
                  summary={p.reason}
                  side={statuses[p.status] || p.status}
                  tone={p.status === 'pending' ? 'warn' : 'plain'}
                  selected={p.id === proposal?.id}
                  onSelect={() => setPick(p.id)}
                />
              ))
            ) : (
              <p className="none">暂无可见申请。</p>
            ))}
          {view === 'organization' && (
            <>
              <h3>
                部门 <span>{data.departments.length}</span>
              </h3>
              {data.departments.map((d) => (
                <KnowledgeListRow
                  key={d.id}
                  name={d.name}
                  summary={`${d.active} 位在岗成员`}
                  tone="plain"
                  selected={d.id === pick}
                  onSelect={() => setPick(d.id)}
                />
              ))}
              <KnowledgeListRow name="新增部门" summary="填写部门名称" tone="plain" selected={pick === 'new-department'} onSelect={() => setPick('new-department')} />
              <h3>
                成员与独立职责 <span>{data.members.length}</span>
              </h3>
              {data.members.map((m) => (
                <KnowledgeListRow
                  key={m.id}
                  name={m.name}
                  summary={`${data.roles[m.role]} · L${m.role === 'admin' ? 3 : m.clearance}`}
                  side={m.active ? '启用' : '停用'}
                  tone={m.active ? 'ok' : 'plain'}
                  selected={m.id === pick}
                  onSelect={() => setPick(m.id)}
                />
              ))}
            </>
          )}
          {view === 'audit' &&
            (a.audits ? (
              a.audits.items.map((x) => (
                <KnowledgeListRow
                  key={x.id}
                  name={x.action}
                  summary={`${x.actor} · ${new Date(x.at).toLocaleString()}`}
                  tone="plain"
                  selected={x.id === audit?.id}
                  onSelect={() => setPick(x.id)}
                />
              ))
            ) : (
              <p className="none">正在读取审计…</p>
            ))}
        </div>
      </article>
      <article className="card detail" aria-live="polite">
        <header>
          <h2>
            {view === 'policy'
              ? resource?.title || '资源权限'
              : view === 'approvals'
                ? proposal?.title || '审批中心'
                : view === 'organization'
                  ? member?.name || department?.name || (pick === 'new-department' ? '新增部门' : '部门与成员')
                  : '操作审计'}
          </h2>
          <span>
            {data.user.name} · {data.roles[data.user.role]} · L{admin ? 3 : data.user.clearance} · 企业内容只读
          </span>
        </header>
        <div className="card-scroll legacy-skin">
          <div className="access-work">
            {a.error && <p role="alert">{a.error}</p>}
            {a.notice && <p role="status">{a.notice}</p>}
            {view === 'policy' &&
              (resource ? (
                <>
                  <p>授权只决定读取范围。密级、治理状态和 AI 使用限制仍会独立校验。</p>
                  <Policy
                    key={resource.id + ':' + resource.policyVersion + ':' + resource.version}
                    resource={resource}
                    data={data}
                    busy={a.busy}
                    submit={(body) => a.mutate('/scene-access/policy', body)}
                  />
                </>
              ) : (
                <p>在左侧选择一项资源。</p>
              ))}
            {view === 'approvals' &&
              (proposal ? (
                <article>
                  <p>
                    {statuses[proposal.status] || proposal.status} · {proposal.reason}
                  </p>
                  <p>待处理数量与清单中“待审批”的申请一致；过期申请必须重新提交。</p>
                  {proposal.canApprove && (
                    <button disabled={a.busy} onClick={() => void a.mutate(`/scene-access/proposals/${proposal.id}/resolve`, { decision: 'approve' })}>
                      批准并生效
                    </button>
                  )}{' '}
                  {proposal.canReject && (
                    <button disabled={a.busy} onClick={() => void a.mutate(`/scene-access/proposals/${proposal.id}/resolve`, { decision: 'reject' })}>
                      拒绝
                    </button>
                  )}{' '}
                  {proposal.canWithdraw && (
                    <button disabled={a.busy} onClick={() => void a.mutate(`/scene-access/proposals/${proposal.id}/withdraw`, {})}>
                      撤回
                    </button>
                  )}
                </article>
              ) : (
                <p>暂无可见申请。</p>
              ))}
            {view === 'organization' &&
              (member ? (
                <>
                  <p>角色不等于治理职责。下方分配不授予内容编辑能力；停用成员会撤销其会话。</p>
                  <MemberForm
                    open
                    key={member.id + JSON.stringify(member)}
                    member={member}
                    data={data}
                    busy={a.busy}
                    submit={(body) => a.mutate(`/scene-access/members/${member.id}`, body)}
                  />
                </>
              ) : department ? (
                <Department
                  key={department.id + ':' + department.name}
                  department={department}
                  busy={a.busy}
                  submit={(body) => a.mutate('/scene-access/departments', body)}
                />
              ) : pick === 'new-department' ? (
                <Department busy={a.busy} submit={(body) => a.mutate('/scene-access/departments', body)} />
              ) : (
                <p>在左侧选择部门或成员，或新增部门。</p>
              ))}
            {view === 'audit' &&
              (audit ? (
                <>
                  <p>审计完整性：{a.audits?.valid ? '校验通过' : '校验未通过'}</p>
                  <p>
                    {new Date(audit.at).toLocaleString()} · {audit.actor} · {audit.action}
                  </p>
                  <pre>{audit.detail}</pre>
                </>
              ) : (
                <p>暂无审计记录。</p>
              ))}
          </div>
        </div>
      </article>
    </>
  );
}
