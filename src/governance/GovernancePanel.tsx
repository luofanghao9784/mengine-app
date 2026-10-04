import { supportRoute } from '../identity/support-request';
import { useContext, useState } from 'react';
import type { Capability, CapabilityChange, GovernanceSnapshot } from '../../contracts/public-api/governance';
import type { TenantMember } from '../../contracts/public-api/tenant-admin';
import { useSession, identityClient } from '../identity/session';
import { tenantClient } from '../tenant/client';
import { Button, Field, Badge } from '../shared/ui';
import {
  Failure,
  Loading,
  useRemote,
  useSubmission,
  SubmitError,
  FormActions,
  MutationGate,
  Pager,
} from '../shared/admin';
import { capabilityLabels, governanceClient as api } from './client';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { RecoveryForm } from './RecoveryForm';
import './governance.css';
export type MemberSelection = { query: string; page: number; target: string };
export function GovernancePanel({
  tenant,
  snapshot,
  changed,
  selection,
  select,
}: {
  tenant: string;
  snapshot: GovernanceSnapshot;
  changed: () => void;
  selection: MemberSelection;
  select: (value: MemberSelection) => void;
}) {
  const { session } = useSession(),
    [busy, setBusy] = useState(false);
  const locked = useContext(RequestPending);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, snapshot.revision]);
  const name = (workspace: string | null) =>
    workspace ? context.value?.workspaces.find((w) => w.id === workspace)?.name || workspace : '企业范围';
  return (
    <MutationGate.Provider value={setBusy}>
      <section className="access-panel governance-panel">
        <h2>职责与授权</h2>
        <p className="muted">
          配置管理、范围维护和企业负责人是分别授予的职责。管理资格不会自动开放个人资料或私人会话。
        </p>
        <div className="governance-toolbar">
          <Badge>{supportRoute() ? '总部支持' : snapshot.owner ? '企业负责人' : snapshot.canConfigure ? '企业管理员' : '范围职责'}</Badge>
          <Button onClick={changed} disabled={busy || locked}>
            刷新职责
          </Button>
        </div>
        <p>
          当前负责人：
          {snapshot.ownerId ? (
            <code>
              {snapshot.ownerId === session.identity?.account.id
                ? '本人'
                : snapshot.ownerName || snapshot.ownerId}
            </code>
          ) : (
            '尚未明确接受职责'
          )}
        </p>
        {snapshot.canAcceptInitialResponsibility && (
          <Acceptance
            label="接受企业负责人职责"
            description="你是开通时明确指定的初始负责人。接受后可以任命管理员、明确授予范围职责和发起负责人交接；内容访问仍需独立授权。"
            submit={async (requestId) => {
              await api.acceptInitial(tenant, { requestId, expectedVersion: snapshot.revision });
              changed();
            }}
          />
        )}
        {snapshot.pendingHandover && (
          <PendingHandover tenant={tenant} snapshot={snapshot} changed={changed} />
        )}
        {!snapshot.pendingHandover && snapshot.latestHandover && (
          <p role="status">
            最近一次交接：{snapshot.latestHandover.fromName} → {snapshot.latestHandover.toName}，
            {
              {
                ACCEPTED: '已接受',
                REJECTED: '已拒绝，原负责人继续负责',
                CANCELLED: '已撤销，原负责人继续负责',
              }[snapshot.latestHandover.status]
            }
            。
          </p>
        )}
        {snapshot.capabilities.length > 0 && (
          <section className="governance-section">
            <h3>我的范围能力</h3>
            {snapshot.capabilities.length ? (
              <ul>
                {snapshot.capabilities.map((c) => (
                  <li key={`${c.workspaceId}:${c.capability}`}>
                    {name(c.workspaceId)} · {capabilityLabels[c.capability]}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">暂无额外范围能力。</p>
            )}
            <p className="muted">职责清单只说明已授予的资格；具体业务功能以当前可用入口为准。</p>
          </section>
        )}
        {(snapshot.owner || supportRoute()) && (
          <OwnerControls
            tenant={tenant}
            snapshot={snapshot}
            changed={changed}
            selection={selection}
            select={select}
          />
        )}
        {!supportRoute() && <details className="governance-section">
          <summary>负责人异常恢复</summary>
          <RecoveryForm tenant={tenant} />
        </details>}
      </section>
    </MutationGate.Provider>
  );
}
function PendingHandover({
  tenant,
  snapshot,
  changed,
}: {
  tenant: string;
  snapshot: GovernanceSnapshot;
  changed: () => void;
}) {
  const { session, refresh } = useSession();
  type Action = 'accept' | 'reject' | 'cancel';
  const task = useSubmission<Action>();
  const [accepted, setAccepted] = useState(false);
  const [pendingAction, setPendingAction] = useState<Action>();
  useRequestLock(task.busy || task.uncertain);
  const handover = snapshot.pendingHandover!;
  const receiver = handover.toAccount === session.identity?.account.id;
  const act = (action: Action) => {
    setPendingAction(action);
    void task.submit(action, async (action, requestId) => {
      const body = { requestId, expectedVersion: snapshot.revision };
      if (action === 'accept') await api.acceptHandover(tenant, handover.id, body);
      else await api.closeHandover(tenant, handover.id, action, body);
      changed();
      await refresh(true);
    });
  };
  return (
    <section className="governance-section">
      <h3>负责人交接待接受</h3>
      <p>
        {handover.fromName} → {handover.toName}。接受前负责人及管理员身份保持不变。
      </p>
      <p>
        交接后，{handover.fromName} 将
        {handover.previousOwnerRole === 'TENANT_ADMIN' ? '保留企业管理员身份' : '变为普通成员'}
        ；原有空间职责和内容权限保持不变。
      </p>
      {receiver && (
        <>
          <p>接受后，你将成为企业负责人并获得企业管理员身份。</p>
          <label className="governance-check">
            <input
              type="checkbox"
              checked={accepted}
              disabled={task.busy || task.uncertain}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已了解并愿意承担上述职责
          </label>
        </>
      )}
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        {receiver && (
          <Button
            variant="primary"
            disabled={!accepted || task.busy || (task.uncertain && pendingAction !== 'accept')}
            onClick={() => act('accept')}
          >
            {task.uncertain && pendingAction === 'accept' ? '重试本次接受' : '接受负责人交接'}
          </Button>
        )}
        <Button
          disabled={task.busy || (task.uncertain && pendingAction === 'accept')}
          onClick={() => act(receiver ? 'reject' : 'cancel')}
        >
          {task.uncertain && pendingAction !== 'accept' ? '重试本次操作' : receiver ? '拒绝交接' : '撤销交接'}
        </Button>
      </FormActions>
    </section>
  );
}
function Acceptance({
  label,
  description,
  submit,
}: {
  label: string;
  description: string;
  submit: (requestId: string) => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false),
    task = useSubmission<boolean>();
  return (
    <form
      className="governance-section"
      onSubmit={(e) => {
        e.preventDefault();
        if (accepted) void task.submit(true, async (_, key) => submit(key));
      }}
    >
      <p>{description}</p>
      <label className="governance-check">
        <input
          type="checkbox"
          checked={accepted}
          disabled={task.busy || task.uncertain}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        我已了解并愿意承担上述职责
      </label>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <Button variant="primary" type="submit" disabled={!accepted || task.busy}>
        {task.uncertain ? '重试本次接受' : label}
      </Button>
    </form>
  );
}
function OwnerControls({
  tenant,
  snapshot,
  changed,
  selection,
  select,
}: {
  tenant: string;
  snapshot: GovernanceSnapshot;
  changed: () => void;
  selection: MemberSelection;
  select: (value: MemberSelection) => void;
}) {
  const { query, page, target } = selection;
  const locked = useContext(RequestPending);
  const members = useRemote(
    (signal) => tenantClient.members(tenant, query, '', page * 20, signal),
    [tenant, query, page, snapshot.revision],
  );
  const inPage = members.value?.find((m) => m.accountId === target);
  const targetDetail = useRemote(
    (signal) =>
      target && members.value && !inPage
        ? tenantClient.member(tenant, target, signal)
        : Promise.resolve(null),
    [tenant, target, members.value, inPage, snapshot.revision],
  );
  const selected =
    inPage || (targetDetail.value?.member.accountId === target ? targetDetail.value.member : undefined);
  return (
    <section className="governance-section">
      <h3>管理员与负责人</h3>
      <Field label="查找职责成员">
        <input
          aria-label="查找职责成员"
          disabled={locked}
          value={query}
          maxLength={100}
          placeholder="姓名或邮箱"
          onChange={(e) => {
            select({ query: e.target.value, page: 0, target: '' });
          }}
        />
      </Field>
      {members.error ? (
        <Failure error={members.error} retry={changed} />
      ) : !members.value ? (
        <Loading />
      ) : (
        <>
          <Field label="职责成员">
            <select
              aria-label="职责成员"
              disabled={locked}
              value={selected?.accountId || ''}
              onChange={(e) => select({ ...selection, target: e.target.value })}
            >
              <option value="">选择成员</option>
              {selected && !inPage && (
                <option value={selected.accountId}>
                  {selected.displayName} · {selected.phone || selected.email}
                </option>
              )}
              {members.value.slice(0, 20).map((m) => (
                <option value={m.accountId} key={m.accountId}>
                  {m.displayName} · {m.phone || m.email}
                  {m.status !== 'ACTIVE' ? '（已停用）' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Pager
            page={page}
            next={members.value.length > 20}
            onPage={(p) => {
              if (!locked) select({ ...selection, page: p, target: '' });
            }}
          />
          {targetDetail.error && <Failure error={targetDetail.error} retry={changed} />}
          {selected && (
            <MemberDuties
              key={`${selected.accountId}:${snapshot.revision}:${selected.version}`}
              tenant={tenant}
              member={selected}
              snapshot={snapshot}
              changed={changed}
            />
          )}
        </>
      )}
    </section>
  );
}
function MemberDuties({
  tenant,
  member,
  snapshot,
  changed,
}: {
  tenant: string;
  member: TenantMember;
  snapshot: GovernanceSnapshot;
  changed: () => void;
}) {
  const [role, setRole] = useState(member.role),
    [offer, setOffer] = useState(false),
    [previousOwnerRole, setPreviousOwnerRole] = useState<'TENANT_ADMIN' | 'MEMBER'>('TENANT_ADMIN'),
    [spaceQuery, setSpaceQuery] = useState(''),
    [spacePage, setSpacePage] = useState(0),
    [workspace, setWorkspace] = useState(''),
    [capability, setCapability] = useState<CapabilityChange['capability']>('PROFILE_MAINTAIN');
  const roleTask = useSubmission<string>(),
    offerTask = useSubmission<'TENANT_ADMIN' | 'MEMBER'>(),
    capTask = useSubmission<{
      workspaceId: string | null;
      capability: CapabilityChange['capability'];
      enabled: boolean;
    }>();
  useRequestLock(
    roleTask.busy ||
      roleTask.uncertain ||
      offerTask.busy ||
      offerTask.uncertain ||
      capTask.busy ||
      capTask.uncertain,
  );
  const assignments = useRemote(
    (signal) => api.assigned(tenant, member.accountId, signal),
    [tenant, member.accountId, snapshot.revision],
  );
  const spaces = useRemote(
    (signal) => tenantClient.spaces(tenant, spaceQuery, spacePage * 20, signal),
    [tenant, spaceQuery, spacePage],
  );
  const eligible = member.status === 'ACTIVE' && member.accountStatus === 'ACTIVE';
  const grant = (workspaceId: string | null, capability: CapabilityChange['capability'], enabled: boolean) =>
    void capTask.submit({ workspaceId, capability, enabled }, async (body, requestId) => {
      await api.capability(tenant, {
        ...body,
        requestId,
        accountId: member.accountId,
        expectedVersion: snapshot.revision,
      });
      changed();
    });
  const extras = Object.entries(capabilityLabels).filter(
    ([c]) => !['OWNER', 'TENANT_CONFIG', 'CONTENT_MAINTAIN'].includes(c),
  ) as [CapabilityChange['capability'], string][];
  return (
    <div className="governance-section">
      <div className="governance-grid">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void roleTask.submit(role, async (role, requestId) => {
              await api.appoint(tenant, member.accountId, {
                requestId,
                expectedVersion: member.version,
                role: role as TenantMember['role'],
              });
              changed();
            });
          }}
        >
          <h3>企业管理员</h3>
          <Field label="企业管理身份">
            <select
              aria-label="企业管理身份"
              value={role}
              disabled={roleTask.busy || roleTask.uncertain || member.accountId === snapshot.ownerId}
              onChange={(e) => setRole(e.target.value as TenantMember['role'])}
            >
              <option value="MEMBER">普通成员</option>
              <option value="TENANT_ADMIN">企业管理员</option>
            </select>
          </Field>
          <p className="muted">
            不随任命授予共享正文或他人私人内容访问权。负责人须先交接才能撤销企业管理身份。
          </p>
          <SubmitError error={roleTask.error} uncertain={roleTask.uncertain} />
          <Button
            type="submit"
            disabled={
              member.accountId === snapshot.ownerId ||
              roleTask.busy ||
              role === member.role ||
              (!eligible && role === 'TENANT_ADMIN')
            }
          >
            保存管理职责
          </Button>
        </form>
        {!supportRoute() && member.accountId !== snapshot.ownerId && !snapshot.pendingHandover && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (offer)
                void offerTask.submit(previousOwnerRole, async (previousOwnerRole, requestId) => {
                  await api.offer(tenant, {
                    requestId,
                    expectedVersion: snapshot.revision,
                    accountId: member.accountId,
                    previousOwnerRole,
                  });
                  changed();
                });
            }}
          >
            <h3>负责人交接</h3>
            <p>由 {member.displayName} 接受后才生效；接受前可撤销，对方也可拒绝。</p>
            <Field label="交接后我的身份">
              <select
                aria-label="交接后我的身份"
                value={previousOwnerRole}
                disabled={offerTask.busy || offerTask.uncertain}
                onChange={(e) => setPreviousOwnerRole(e.target.value as 'TENANT_ADMIN' | 'MEMBER')}
              >
                <option value="TENANT_ADMIN">保留企业管理员（默认）</option>
                <option value="MEMBER">变为普通成员</option>
              </select>
            </Field>
            <p className="muted">原有空间职责、资料和内容权限不变。</p>
            <label className="governance-check">
              <input
                type="checkbox"
                checked={offer}
                disabled={offerTask.busy || offerTask.uncertain}
                onChange={(e) => setOffer(e.target.checked)}
              />
              确认向此成员发起交接
            </label>
            <SubmitError error={offerTask.error} uncertain={offerTask.uncertain} />
            <Button type="submit" disabled={!offer || !eligible || offerTask.busy}>
              发起负责人交接
            </Button>
          </form>
        )}
      </div>
      <details className="governance-section">
        <summary>其他范围授权</summary>
        <p className="muted">
          资料查看与维护通过“共享空间”分别设置。其他能力也不会自动授予正文访问权；空间能力要求已获得该空间访问授权。
        </p>
        {assignments.error ? (
          <Failure error={assignments.error} retry={changed} />
        ) : !assignments.value ? (
          <Loading />
        ) : (
          <ul>
            {assignments.value.map((c) => (
              <li key={`${c.workspaceId}:${c.capability}`} className="governance-toolbar">
                <span>
                  {c.workspaceId
                    ? spaces.value?.find((w) => w.id === c.workspaceId)?.name || c.workspaceId
                    : '企业范围'}{' '}
                  · {capabilityLabels[c.capability]}
                </span>
                <Button
                  variant="danger"
                  disabled={capTask.busy}
                  onClick={() => grant(c.workspaceId, c.capability as CapabilityChange['capability'], false)}
                >
                  撤销此能力
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            grant(workspace || null, capability, true);
          }}
        >
          <fieldset disabled={capTask.busy || capTask.uncertain || !eligible}>
            <Field label="授予能力">
              <select
                aria-label="授予能力"
                value={capability}
                onChange={(e) => {
                  const c = e.target.value as CapabilityChange['capability'];
                  setCapability(c);
                  if (['TENANT_EXIT', 'MEMBER_OFFBOARD'].includes(c)) setWorkspace('');
                }}
              >
                {extras.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="查找授权空间">
              <input
                aria-label="查找授权空间"
                value={spaceQuery}
                maxLength={100}
                onChange={(e) => {
                  setSpaceQuery(e.target.value);
                  setSpacePage(0);
                  setWorkspace('');
                }}
              />
            </Field>
            {spaces.error ? (
              <Failure error={spaces.error} retry={() => setSpaceQuery('')} />
            ) : (
              <Field label="能力范围">
                <select
                  aria-label="能力范围"
                  value={workspace}
                  disabled={['TENANT_EXIT', 'MEMBER_OFFBOARD'].includes(capability)}
                  onChange={(e) => setWorkspace(e.target.value)}
                >
                  <option value="">企业范围</option>
                  {spaces.value?.slice(0, 20).map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Pager
              page={spacePage}
              next={(spaces.value?.length || 0) > 20}
              onPage={(p) => {
                setSpacePage(p);
                setWorkspace('');
              }}
            />
          </fieldset>
          <SubmitError error={capTask.error} uncertain={capTask.uncertain} />
          <FormActions>
            <Button type="submit" disabled={!eligible || capTask.busy}>
              授予此能力
            </Button>
          </FormActions>
        </form>
      </details>
    </div>
  );
}
