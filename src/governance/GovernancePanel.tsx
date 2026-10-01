import { useState } from 'react';
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
  const { session, refresh } = useSession(),
    [busy, setBusy] = useState(false);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, snapshot.revision]);
  const name = (workspace: string | null) =>
    workspace ? context.value?.workspaces.find((w) => w.id === workspace)?.name || workspace : '企业范围';
  return (
    <MutationGate.Provider value={setBusy}>
      <section className="access-panel governance-panel">
        <h2>职责与授权</h2>
        <p className="muted">
          配置管理、范围维护和企业授权负责人是分别授予的职责。管理资格不会自动开放个人资料或私人会话。
        </p>
        <div className="governance-toolbar">
          <Badge>
            {snapshot.owner ? '企业授权负责人' : snapshot.canConfigure ? '配置管理员' : '范围职责'}
          </Badge>
          <Button onClick={changed} disabled={busy}>
            刷新职责
          </Button>
        </div>
        <p>
          当前负责人：
          {snapshot.ownerId ? (
            <code>{snapshot.ownerId === session.identity?.account.id ? '本人' : snapshot.ownerId}</code>
          ) : (
            '尚未明确接受职责'
          )}
        </p>
        {snapshot.canAcceptInitialResponsibility && (
          <Acceptance
            label="接受企业授权负责人职责"
            description="你是开通时明确指定的初始负责人。接受后可以任命管理员、明确授予范围职责和发起负责人交接；内容访问仍需独立授权。"
            submit={async (requestId) => {
              await api.acceptInitial(tenant, { requestId, expectedVersion: snapshot.revision });
              changed();
            }}
          />
        )}
        {snapshot.pendingHandover && (
          <section className="governance-section">
            <h3>负责人交接待接受</h3>
            <p>
              接收人：<code>{snapshot.pendingHandover.toAccount}</code>。接受前负责人保持不变。
            </p>
            {snapshot.pendingHandover.toAccount === session.identity?.account.id ? (
              <Acceptance
                label="接受负责人交接"
                description="接受后承担企业授权负责人职责，并获得企业配置管理职责。此交接不转移私人内容或自动授予共享内容访问权。"
                submit={async (requestId) => {
                  await api.acceptHandover(tenant, snapshot.pendingHandover!.id, {
                    requestId,
                    expectedVersion: snapshot.revision,
                  });
                  changed();
                  await refresh(true);
                }}
              />
            ) : (
              <p className="muted">等待接收人明确接受；另行发起交接会替换当前待接受请求。</p>
            )}
          </section>
        )}
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
        {snapshot.owner && (
          <OwnerControls
            tenant={tenant}
            snapshot={snapshot}
            changed={changed}
            selection={selection}
            select={select}
          />
        )}
        <RecoveryForm tenant={tenant} />
      </section>
    </MutationGate.Provider>
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
  const members = useRemote(
    (signal) => tenantClient.members(tenant, query, '', page * 20, signal),
    [tenant, query, page, snapshot.revision],
  );
  const selected = members.value?.find((m) => m.accountId === target);
  return (
    <section className="governance-section">
      <h3>任命、交接与范围授权</h3>
      <Field label="查找职责成员">
        <input
          aria-label="查找职责成员"
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
              value={selected?.accountId || ''}
              onChange={(e) => select({ ...selection, target: e.target.value })}
            >
              <option value="">选择成员</option>
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
              select({ ...selection, page: p, target: '' });
            }}
          />
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
    [spaceQuery, setSpaceQuery] = useState(''),
    [spacePage, setSpacePage] = useState(0),
    [workspace, setWorkspace] = useState(''),
    [capability, setCapability] = useState<CapabilityChange['capability']>('PROFILE_MAINTAIN');
  const roleTask = useSubmission<string>(),
    offerTask = useSubmission<boolean>(),
    capTask = useSubmission<{
      workspaceId: string | null;
      capability: CapabilityChange['capability'];
      enabled: boolean;
    }>();
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
          <h3>配置管理员</h3>
          <Field label="配置管理职责">
            <select
              aria-label="配置管理职责"
              value={role}
              disabled={roleTask.busy || roleTask.uncertain}
              onChange={(e) => setRole(e.target.value as TenantMember['role'])}
            >
              <option value="MEMBER">普通成员</option>
              <option value="TENANT_ADMIN">配置管理员</option>
            </select>
          </Field>
          <p className="muted">
            不随任命授予共享正文或他人私人内容访问权。负责人须先交接才能撤销配置管理职责。
          </p>
          <SubmitError error={roleTask.error} uncertain={roleTask.uncertain} />
          <Button
            type="submit"
            disabled={roleTask.busy || role === member.role || (!eligible && role === 'TENANT_ADMIN')}
          >
            保存管理职责
          </Button>
        </form>
        {member.accountId !== snapshot.ownerId && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (offer)
                void offerTask.submit(true, async (_, requestId) => {
                  await api.offer(tenant, {
                    requestId,
                    expectedVersion: snapshot.revision,
                    accountId: member.accountId,
                  });
                  changed();
                });
            }}
          >
            <h3>负责人交接</h3>
            <p>由 {member.displayName} 明确接受后才生效；你的原配置管理职责保留，可另行调整。</p>
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
      <h3>显式范围能力</h3>
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
    </div>
  );
}
