import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Archive, ArrowRightLeft, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  DepartureView,
  DepartureMember,
  SharedResponsibility,
  ExitInventory,
  ExitPart,
} from '../../contracts/public-api/departure';
import { IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { Button, Field } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, MutationGate } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { departureClient as api } from './client';
import './departure.css';
const states: Record<string, string> = {
  ISOLATING: '正在隔离',
  ISOLATED: '隔离期内',
  EXPORT_WINDOW: '受限迁出期',
  RESTORING: '正在撤销离职',
  CLEANING: '正在清理',
  COMPLETE: '在线清理完成',
  FAILED: '待重试',
  CANCELLED: '离职已撤销',
  QUEUED: '已排队',
  GENERATING: '生成中',
  READY: '可下载',
  PARTIAL: '含缺项',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
  REMOVED: '已移除',
  NONE: '尚未清理',
  PENDING: '清理排队中',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '尚未完成');
type Action = (requestId: string) => Promise<void>;
const Actions = createContext<{ blocked: boolean; run: (action: Action) => void; reload: () => void }>({
  blocked: false,
  run: () => {},
  reload: () => {},
});
function useActionRunner(reload: () => void) {
  const { expire } = useSession(),
    outer = useContext(MutationGate),
    pending = useRef<{ key: string; action: Action } | null>(null),
    mounted = useRef(true);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<unknown>();
  const blocked = busy || uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    outer(blocked);
    return () => outer(false);
  }, [blocked, outer]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function execute() {
    if (!pending.current || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await pending.current.action(pending.current.key);
      pending.current = null;
      if (mounted.current) {
        setUncertain(false);
        reload();
        window.dispatchEvent(new Event('departure-state-changed'));
      }
    } catch (e) {
      if (e instanceof IdentityError && e.status === 401) expire();
      if (mounted.current) {
        const unknown =
          e instanceof IdentityError &&
          (e.code === 'UNCERTAIN_RESULT' || e.code === 'CONTRACT_MISMATCH' || e.status >= 500);
        setError(e);
        setUncertain(unknown);
        if (!unknown) {
          pending.current = null;
          reload();
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return {
    blocked,
    busy,
    uncertain,
    error,
    retry: () => void execute(),
    run: (action: Action) => {
      if (blocked) return;
      pending.current = { key: crypto.randomUUID(), action };
      void execute();
    },
  };
}
/** The client only exposes designated export records; administrative actions stay on the management surface. */
export function DeparturePanel({
  tenant,
  verification = 0,
  recordsOnly = false,
  memberId,
  executionId,
  only,
}: {
  tenant: string;
  verification?: number;
  recordsOnly?: boolean;
  memberId?: string;
  executionId?: string;
  only?: 'member' | 'exit';
}) {
  return (
    <DepartureSession
      key={`${tenant}:${recordsOnly}:${only || ''}:${memberId || ''}:${executionId || ''}`}
      tenant={tenant}
      verification={verification}
      recordsOnly={recordsOnly}
      memberId={memberId}
      executionId={executionId}
      only={only}
    />
  );
}
function DepartureSession({
  tenant,
  verification,
  recordsOnly,
  memberId,
  executionId,
  only,
}: {
  tenant: string;
  verification: number;
  recordsOnly: boolean;
  memberId?: string;
  executionId?: string;
  only?: 'member' | 'exit';
}) {
  const [nonce, setNonce] = useState(0),
    [page, setPage] = useState(0),
    [mode, setMode] = useState<'list' | 'offboard' | 'exit'>(memberId ? 'offboard' : 'list'),
    [selected, setSelected] = useState<string | undefined>(executionId);
  const reload = () => {
      setNonce((x) => x + 1);
    },
    action = useActionRunner(reload);
  const list = useRemote(
    (signal) =>
      memberId
        ? Promise.resolve({ items: [], hasMore: false })
        : api.list(
            tenant,
            page * 20,
            signal,
            only === 'exit' ? 'TENANT_EXIT' : only === 'member' ? 'MEMBER_OFFBOARD' : undefined,
          ),
    [tenant, page, nonce, verification, only],
  );
  const options = useRemote(
    (signal) =>
      recordsOnly || memberId ? Promise.resolve(null) : api.options(tenant, undefined, 0, 0, signal),
    [tenant, nonce, verification, recordsOnly],
  );
  return (
    <Actions.Provider value={{ blocked: action.blocked, run: action.run, reload }}>
      <section
        className="departure-panel"
        aria-label={
          memberId || only === 'member'
            ? '成员离职办理'
            : only === 'exit'
              ? '企业退出'
              : recordsOnly
                ? '迁出与清理记录'
                : '离职与企业退出'
        }
      >
        <header className="departure-header">
          <div>
            <p className="departure-kicker">
              <ShieldCheck size={16} /> 生效执行与回执
            </p>
            <h2>
              {memberId || only === 'member'
                ? '成员离职办理'
                : only === 'exit'
                  ? '企业退出'
                  : recordsOnly
                    ? '迁出与清理记录'
                    : '离职与企业退出'}
            </h2>
            <p>
              {recordsOnly
                ? '查看当前获权的执行记录，按指定范围迁出资料。'
                : '先移交共享责任，再明确执行。准备清单不会自动停用身份。'}
            </p>
          </div>
          <Button icon={RefreshCw} disabled={action.blocked} onClick={reload}>
            刷新状态
          </Button>
        </header>
        <SubmitError error={action.error} uncertain={action.uncertain} />
        {action.uncertain && (
          <Button variant="primary" disabled={action.busy} onClick={action.retry}>
            重试未确认请求
          </Button>
        )}
        {!memberId && (
          <nav className="departure-tabs">
            <Button
              disabled={action.blocked}
              onClick={() => {
                setMode('list');
                setSelected(undefined);
              }}
            >
              执行记录
            </Button>
            {!recordsOnly && only !== 'exit' && options.value?.canOffboard && (
              <Button
                disabled={action.blocked}
                icon={ArrowRightLeft}
                onClick={() => {
                  setMode('offboard');
                  setSelected(undefined);
                }}
              >
                办理员工离职
              </Button>
            )}
            {!recordsOnly && only !== 'member' && options.value?.canExit && (
              <Button
                disabled={action.blocked}
                icon={LogOut}
                onClick={() => {
                  setMode('exit');
                  setSelected(undefined);
                }}
              >
                办理企业退出
              </Button>
            )}
          </nav>
        )}
        {selected ? (
          <Execution
            key={selected}
            recordsOnly={recordsOnly}
            tenant={tenant}
            id={selected}
            nonce={nonce + verification}
            close={() => setSelected(undefined)}
            focused={!!memberId}
          />
        ) : !recordsOnly && mode === 'offboard' ? (
          <Offboard
            tenant={tenant}
            memberId={memberId}
            nonce={nonce + verification}
            opened={(id) => {
              setSelected(id);
              if (!memberId) setMode('list');
            }}
          />
        ) : !recordsOnly && mode === 'exit' ? (
          <ExitForm
            tenant={tenant}
            nonce={nonce + verification}
            opened={(id) => {
              setSelected(id);
              setMode('list');
            }}
          />
        ) : list.error ? (
          <Failure error={list.error} retry={reload} />
        ) : !list.value ? (
          <Loading />
        ) : (
          <>
            <div className="departure-records">
              {list.value.items.length === 0 ? (
                <p className="departure-note">
                  {recordsOnly
                    ? '当前没有可查看的迁出或清理记录。'
                    : '尚无正式执行记录。可先在保存与退出政策中准备清单。'}
                </p>
              ) : (
                list.value.items.map((e) => (
                  <button
                    className="departure-record"
                    key={e.id}
                    disabled={action.blocked}
                    onClick={() => setSelected(e.id)}
                  >
                    <div>
                      <strong>{e.kind === 'MEMBER_OFFBOARD' ? '员工离职' : '企业退出'}</strong>
                      <span>{states[e.state]}</span>
                    </div>
                    <p>
                      生效 {when(e.effectiveAt)} · 截止 {when(e.deadline)}
                    </p>
                    <small>执行 {e.id}</small>
                  </button>
                ))
              )}
            </div>
            <Pager
              page={page}
              next={!action.blocked && list.value.hasMore}
              onPage={(p) => {
                if (!action.blocked) setPage(p);
              }}
            />
          </>
        )}
      </section>
    </Actions.Provider>
  );
}
function Offboard({
  memberId,
  tenant,
  nonce,
  opened,
}: {
  tenant: string;
  nonce: number;
  opened: (id: string) => void;
  memberId?: string;
}) {
  const { blocked, run, reload } = useContext(Actions),
    { session } = useSession();
  const [memberPage, setMemberPage] = useState(0),
    [responsibilityPage, setResponsibilityPage] = useState(0),
    [selection, setMember] = useState<DepartureMember | undefined>(
      memberId ? { id: memberId, name: '正在读取…', status: 'ACTIVE', revision: 0 } : undefined,
    ),
    [reason, setReason] = useState(''),
    [accepted, setAccepted] = useState(false),
    [handover, setHandover] = useState<SharedResponsibility>();
  const remote = useRemote(
    (signal) => api.options(tenant, selection?.id, memberPage * 20, responsibilityPage * 20, signal),
    [tenant, selection?.id, memberPage, responsibilityPage, nonce],
  );
  const member = remote.value?.selectedMember || selection;
  return (
    <div className="departure-form">
      <h3>员工离职</h3>
      <p className="departure-note">
        执行后立即停用该员工在本企业的身份，停止任务，并隔离其私人内容。共享资产仍属于企业，私人所有权不会转给维护者。
      </p>
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <fieldset disabled={blocked}>
            {memberId ? (
              <p>
                离职成员：<strong>{member?.name}</strong>
              </p>
            ) : (
              <>
                <Field label="离职员工">
                  <select
                    aria-label="离职员工"
                    value={member?.id ?? ''}
                    onChange={(e) => {
                      setMember(remote.value!.members.find((m) => m.id === e.target.value));
                      setResponsibilityPage(0);
                      setHandover(undefined);
                    }}
                  >
                    <option value="">选择员工</option>
                    {member && !remote.value.members.some((m) => m.id === member.id) && (
                      <option value={member.id}>{member.name}</option>
                    )}
                    {remote.value.members
                      .filter((m) => m.id !== session.identity?.account.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {m.status === 'ACTIVE' ? '在职' : '已停用'}
                        </option>
                      ))}
                  </select>
                </Field>
                <Pager
                  page={memberPage}
                  next={remote.value.membersHaveMore}
                  onPage={(p) => {
                    setMemberPage(p);
                    setMember(undefined);
                    setHandover(undefined);
                  }}
                />
              </>
            )}
            {remote.value.selectedOwner && <p role="alert">该成员是企业负责人，请先完成企业负责人交接。</p>}
            {remote.value.currentExecutionId && (
              <p>
                该成员已有离职记录。
                <Button onClick={() => opened(remote.value!.currentExecutionId!)}>查看执行结果</Button>
              </p>
            )}
            {remote.value.isolationDays !== undefined && (
              <p>
                当前私人内容隔离期为 {remote.value.isolationDays}{' '}
                天，办理时固定清理截止时间；在允许的撤销期内可恢复尚未清理的内容。不会恢复原共享授权。
              </p>
            )}
            {member && (
              <section className="departure-responsibilities">
                <h4>当前可维护的共享责任</h4>
                <p>仅显示你有权维护的范围；其他空间责任需由对应负责人核对。</p>
                {remote.value.responsibilities.length === 0 ? (
                  <p>本页没有共享责任。</p>
                ) : (
                  remote.value.responsibilities.map((r) => (
                    <div className="departure-responsibility" key={r.kind + r.objectId}>
                      <div>
                        <strong>{r.name}</strong>
                        <small>
                          {r.workspaceName} · {r.kind === 'WORKSPACE_OWNER' ? '空间负责人' : '持续来源联系人'}
                        </small>
                      </div>
                      <Button onClick={() => setHandover(r)}>移交</Button>
                    </div>
                  ))
                )}
                {(responsibilityPage > 0 || remote.value.responsibilitiesHaveMore) && (
                  <Pager
                    page={responsibilityPage}
                    next={remote.value.responsibilitiesHaveMore}
                    onPage={setResponsibilityPage}
                  />
                )}
              </section>
            )}
            <Field label="执行原因">
              <textarea
                aria-label="执行原因"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <label className="departure-check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              我已核对共享责任与正在发生的业务，并确认停用身份及按固定隔离期限清理私人内容。
            </label>
            <Button
              variant="danger"
              disabled={
                !member ||
                !remote.value.selectedMember ||
                !!remote.value.selectedOwner ||
                !!remote.value.currentExecutionId ||
                !reason.trim() ||
                !accepted
              }
              onClick={() => {
                if (member)
                  run(async (requestId) => {
                    const v = await api.offboard(tenant, {
                      requestId,
                      targetAccountId: member.id,
                      expectedMemberRevision: remote.value!.selectedMember!.revision,
                      reason,
                      acceptScheduledCleanup: accepted,
                    });
                    opened(v.execution.id);
                  });
              }}
            >
              确认办理离职
            </Button>
          </fieldset>
          {handover && (
            <Handover tenant={tenant} value={handover} nonce={nonce} close={() => setHandover(undefined)} />
          )}
        </>
      )}
    </div>
  );
}
function Handover({
  tenant,
  value,
  nonce,
  close,
}: {
  tenant: string;
  value: SharedResponsibility;
  nonce: number;
  close: () => void;
}) {
  const { blocked, run, reload } = useContext(Actions),
    [page, setPage] = useState(0),
    [to, setTo] = useState('');
  const remote = useRemote(
    (signal) =>
      value.kind === 'WORKSPACE_OWNER'
        ? Promise.resolve([])
        : api.successors(tenant, value.workspaceId, page * 20, signal),
    [tenant, value.workspaceId, page, nonce],
  );
  if (value.kind === 'WORKSPACE_OWNER')
    return (
      <section className="departure-inset">
        <h4>移交：{value.name}</h4>
        <p>
          先在空间管理中选择接任负责人，并明确原负责人保留只读、保留维护或移出空间。完成后返回这里重新核对交接。
        </p>
        <a
          className="button"
          target="_blank"
          rel="noopener noreferrer"
          href={
            '/tenant-admin/#' +
            new URLSearchParams({ tenant, admin: 'members', tab: 'spaces', space: value.workspaceId })
          }
        >
          新标签页办理空间交接
        </a>
        <Button onClick={close}>返回</Button>
      </section>
    );
  return (
    <section className="departure-inset">
      <h4>移交：{value.name}</h4>
      <p>仅可选择该空间当前已有的维护者，不新增阅读权限。</p>
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <fieldset disabled={blocked}>
          <Field label="接任维护者">
            <select aria-label="接任维护者" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">选择接任者</option>
              {remote.value
                .filter((p) => p.id !== value.responsibleId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Pager
            page={page}
            next={remote.value.length === 20}
            onPage={(p) => {
              setPage(p);
              setTo('');
            }}
          />
          <div className="departure-actions">
            <Button
              disabled={!to}
              onClick={() =>
                run(async (requestId) => {
                  await api.handover(tenant, {
                    requestId,
                    kind: value.kind,
                    workspaceId: value.workspaceId,
                    objectId: value.objectId,
                    fromAccountId: value.responsibleId,
                    toAccountId: to,
                    expectedRevision: value.revision,
                  });
                  close();
                })
              }
            >
              确认移交
            </Button>
            <Button onClick={close}>返回</Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
function ExitForm({
  tenant,
  nonce,
  opened,
}: {
  tenant: string;
  nonce: number;
  opened: (id: string) => void;
}) {
  const { blocked, run, reload } = useContext(Actions),
    { session } = useSession(),
    [page, setPage] = useState(0),
    [exporter, setExporter] = useState(session.identity!.account.id),
    [memberPage, setMemberPage] = useState(0),
    [selected, setSelected] = useState<
      { accountId: string; memberName: string; workspaceId: string; name: string }[]
    >([]),
    [reason, setReason] = useState(''),
    [accepted, setAccepted] = useState(false);
  const options = useRemote(
    (signal) => api.options(tenant, undefined, memberPage * 20, 0, signal),
    [tenant, nonce, memberPage],
  );
  const scopes = useRemote(
    (signal) => api.exportScopes(tenant, page * 20, signal, exporter),
    [tenant, page, nonce, exporter],
  );
  return (
    <div className="departure-form">
      <h3>企业退出</h3>
      <p className="departure-note">
        确认后停止本企业普通业务及新任务，进入固定迁出期。明确指定导出负责人及共享范围；可选范围限于你当前可读、该负责人已有阅读和批量导出资格的空间，指定不会增加原有权限。
      </p>
      {options.error || scopes.error ? (
        <Failure error={options.error ?? scopes.error} retry={reload} />
      ) : !options.value || !scopes.value ? (
        <Loading />
      ) : (
        <fieldset disabled={blocked}>
          <Field label="迁出负责人">
            <select
              aria-label="迁出负责人"
              value={exporter}
              onChange={(e) => {
                setExporter(e.target.value);
                setPage(0);
              }}
            >
              <option value={session.identity!.account.id}>本人</option>
              {options.value.members
                .filter((m) => m.status === 'ACTIVE' && m.id !== session.identity!.account.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Pager
            page={memberPage}
            next={options.value.membersHaveMore}
            onPage={(p) => {
              setMemberPage(p);
              setExporter(session.identity!.account.id);
              setPage(0);
            }}
          />
          <h4>该负责人可以迁出的共享空间</h4>
          {scopes.value.length === 0 ? (
            <p>本页没有同时具备阅读与批量导出资格的共享空间。</p>
          ) : (
            scopes.value.map((s) => (
              <label className="departure-check" key={s.workspaceId}>
                <input
                  type="checkbox"
                  checked={selected.some((x) => x.accountId === exporter && x.workspaceId === s.workspaceId)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [
                            ...old,
                            {
                              ...s,
                              accountId: exporter,
                              memberName:
                                exporter === session.identity!.account.id
                                  ? '本人'
                                  : options.value!.members.find((m) => m.id === exporter)?.name || exporter,
                            },
                          ]
                        : old.filter((x) => x.workspaceId !== s.workspaceId || x.accountId !== exporter),
                    )
                  }
                />
                {s.name}
              </label>
            ))
          )}
          <Pager page={page} next={scopes.value.length === 20} onPage={setPage} />
          <p>
            已选择 {selected.length} 项人员与范围：
            {selected.map((s) => `${s.memberName} · ${s.name}`).join('、') || '无导出范围'}
          </p>
          {selected.length > 0 && (
            <ul className="departure-checklist">
              {selected.map((item) => (
                <li key={`${item.accountId}:${item.workspaceId}`}>
                  {item.memberName} · {item.name}{' '}
                  <Button
                    aria-label={`移除迁出范围 ${item.memberName} · ${item.name}`}
                    onClick={() =>
                      setSelected((all) =>
                        all.filter(
                          (x) => x.accountId !== item.accountId || x.workspaceId !== item.workspaceId,
                        ),
                      )
                    }
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="departure-note">
            迁出包含原资料、已采集数据快照和显式发布的独立经验。私人会话、私人文稿、反馈、权限与系统配置不进入该包，所选包不代表全量企业迁移。
          </p>
          <Field label="退出原因">
            <textarea
              aria-label="退出原因"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <label className="departure-check">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            确认停止业务、按所选范围迁出，并在固定截止时间后执行在线清理。
            {selected.length === 0 ? '我确认本次不开放导出范围。' : ''}
          </label>
          <Button
            variant="danger"
            disabled={!accepted || !reason.trim() || selected.length > 200}
            onClick={() =>
              run(async (requestId) => {
                const v = await api.exit(tenant, {
                  requestId,
                  expectedTenantRevision: options.value!.tenantRevision,
                  reason,
                  exportGrants: selected.map((s) => ({
                    accountId: s.accountId,
                    workspaceId: s.workspaceId,
                  })),
                  acceptScheduledCleanup: accepted,
                });
                opened(v.execution.id);
              })
            }
          >
            确认企业退出
          </Button>
        </fieldset>
      )}
    </div>
  );
}
function Execution({
  focused = false,
  recordsOnly,
  tenant,
  id,
  nonce,
  close,
}: {
  tenant: string;
  id: string;
  nonce: number;
  recordsOnly: boolean;
  close: () => void;
  focused?: boolean;
}) {
  const { blocked, run, reload } = useContext(Actions);
  const [inventoryId, setInventoryId] = useState<string>(),
    [partId, setPartId] = useState<string>();
  const remote = useRemote((signal) => api.get(tenant, id, signal), [tenant, id, nonce]);
  return (
    <section className="departure-detail">
      {!focused && (
        <Button disabled={blocked} icon={ArrowLeft} onClick={close}>
          返回执行记录
        </Button>
      )}
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <h3>
            {remote.value.execution.kind === 'MEMBER_OFFBOARD'
              ? `员工离职 · ${remote.value.targetName ?? ''}`
              : '企业退出'}{' '}
            <span>{states[remote.value.execution.state]}</span>
          </h3>
          <div className="departure-metrics">
            <div>
              <small>生效时间</small>
              <strong>{when(remote.value.execution.effectiveAt)}</strong>
            </div>
            <div>
              <small>固定清理截止</small>
              <strong>{when(remote.value.execution.deadline)}</strong>
            </div>
            <div>
              <small>保存政策</small>
              <strong>
                {remote.value.policyKey === 'TENANT_EXIT_WINDOW' ? '企业退出迁出期' : '离职私人内容隔离期'} /
                第 {remote.value.policyRevision} 版
              </strong>
            </div>
          </div>
          <p>{remote.value.reason}</p>
          <ul className="departure-checklist">
            <li>任务停止：{remote.value.stopComplete ? '已处理当前队列' : '正在处理'}</li>
            <li>资料清理：{remote.value.materialsComplete ? '已获得实际完成回执' : '尚未全部完成'}</li>
            <li>其他对象清理：{remote.value.objectsComplete ? '已获得实际完成回执' : '尚未全部完成'}</li>
            <li>备份副本：待独立核验，不能由在线状态推断</li>
          </ul>
          {remote.value.materialProgress && (
            <p>
              资料发现 {remote.value.materialProgress.discovered} 项 · 排队{' '}
              {remote.value.materialProgress.queued} 项 · 已清理 {remote.value.materialProgress.purged} 项 ·
              失败 {remote.value.materialProgress.failed} 项
            </p>
          )}
          {remote.value.execution.errorCode && (
            <p role="alert">执行需重试：{remote.value.execution.errorCode}</p>
          )}
          <div className="departure-actions">
            {!recordsOnly && remote.value.canCancel && (
              <Button
                disabled={blocked}
                onClick={() =>
                  run(async (requestId) => {
                    await api.command(tenant, id, {
                      requestId,
                      expectedRevision: remote.value!.execution.revision,
                      action: 'CANCEL_OFFBOARD',
                    });
                  })
                }
              >
                撤销离职并恢复未清理私人内容
              </Button>
            )}
            {!recordsOnly && remote.value.canRetry && (
              <Button
                disabled={blocked}
                onClick={() =>
                  run(async (requestId) => {
                    await api.command(tenant, id, {
                      requestId,
                      expectedRevision: remote.value!.execution.revision,
                      action: 'RETRY',
                    });
                  })
                }
              >
                重试执行检查
              </Button>
            )}
          </div>
          <details>
            <summary>覆盖范围与限制</summary>
            <ul>
              {remote.value.coverage.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
          {remote.value.execution.kind === 'TENANT_EXIT' && (
            <ExitExports
              tenant={tenant}
              execution={remote.value}
              nonce={nonce}
              inventoryId={inventoryId}
              onInventory={(id) => {
                setInventoryId(id);
                setPartId(undefined);
              }}
              partId={partId}
              onPart={setPartId}
            />
          )}
        </>
      )}
    </section>
  );
}
function ExitExports({
  tenant,
  execution,
  nonce,
  inventoryId,
  onInventory,
  partId,
  onPart,
}: {
  tenant: string;
  execution: DepartureView;
  nonce: number;
  inventoryId: string | undefined;
  onInventory: (id: string) => void;
  partId: string | undefined;
  onPart: (id: string) => void;
}) {
  const { blocked, run, reload } = useContext(Actions),
    [workspace, setWorkspace] = useState(execution.exportGrants[0]?.workspaceId ?? ''),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(0);
  const remote = useRemote(
    (signal) => api.inventories(tenant, execution.execution.id, page * 20, signal),
    [tenant, execution.execution.id, page, nonce],
  );
  const usable =
    execution.execution.state === 'EXPORT_WINDOW' && Date.parse(execution.execution.deadline) > Date.now();
  return (
    <section className="departure-exports">
      <h3>
        <Archive size={20} /> 退出迁出分包
      </h3>
      <p>每次固定一份所选空间的版本清单，按需生成下一分包。每包有有限期限，下载前再次核对全部已包含来源。</p>
      {usable && execution.exportGrants.length > 0 && (
        <fieldset disabled={blocked}>
          <div className="departure-inline">
            <Field label="已指定给我的共享空间">
              <select
                aria-label="已指定给我的共享空间"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
              >
                {execution.exportGrants.map((g) => (
                  <option key={g.workspaceId} value={g.workspaceId}>
                    {g.workspaceName ?? '已关闭的指定共享空间'}
                  </option>
                ))}
              </select>
            </Field>
            <label className="departure-check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
              明确包含历史版本
            </label>
          </div>
          <Button
            disabled={!workspace}
            onClick={() =>
              run(async (requestId) => {
                onInventory(
                  (
                    await api.createInventory(tenant, {
                      requestId,
                      executionId: execution.execution.id,
                      workspaceId: workspace,
                      includeHistory: history,
                    })
                  ).id,
                );
              })
            }
          >
            固定版本并创建迁出清单
          </Button>
        </fieldset>
      )}
      {!usable && (
        <p className="departure-note">
          迁出期已关闭。可以在已有分包详情中查看清理回执，不能继续读取原文件名或下载。
        </p>
      )}
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <div className="departure-records">
            {remote.value.items.map((i) => (
              <button
                className="departure-record"
                disabled={blocked}
                key={i.id}
                onClick={() => onInventory(i.id)}
              >
                <strong>
                  {i.itemCount} 个确切版本 · {i.includeHistory ? '含历史' : '当前版本'}
                </strong>
                <p>
                  已包含 {i.included} · 待处理 {i.pending} · 缺项 {i.failed}
                </p>
                <small>
                  {when(i.createdAt)} · {i.id}
                </small>
              </button>
            ))}
          </div>
          <Pager
            page={page}
            next={!blocked && remote.value.hasMore}
            onPage={(p) => {
              if (!blocked) setPage(p);
            }}
          />
        </>
      )}
      <CleanupList tenant={tenant} execution={execution.execution.id} nonce={nonce} />
      {inventoryId && (
        <Inventory
          key={inventoryId}
          tenant={tenant}
          id={inventoryId}
          nonce={nonce}
          part={partId}
          setPart={onPart}
        />
      )}
    </section>
  );
}
function Inventory({
  tenant,
  id,
  nonce,
  part,
  setPart,
}: {
  tenant: string;
  id: string;
  nonce: number;
  part: string | undefined;
  setPart: (id: string) => void;
}) {
  const { blocked, run, reload } = useContext(Actions),
    [page, setPage] = useState(0);
  const remote = useRemote(
    (signal) => Promise.all([api.inventory(tenant, id, signal), api.parts(tenant, id, page * 20, signal)]),
    [tenant, id, page, nonce],
  );
  return (
    <div className="departure-inset">
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <h4>清单 {remote.value[0].itemCount} 项</h4>
          <p>
            {remote.value[0].selectedScopeComplete
              ? '所选版本已全部生成；仍需逐包下载并验收。'
              : '仍有待处理或失败条目，尚未形成完整的所选范围。'}{' '}
            不代表全企业迁出。
          </p>
          <details>
            <summary>本次包的包含与不包含范围</summary>
            <ul>
              {remote.value[0].coverage.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
          <Button
            disabled={blocked || remote.value[0].pending === 0}
            onClick={() =>
              run(async (requestId) => {
                const p = await api.next(tenant, id, requestId);
                setPart(p.id);
              })
            }
          >
            生成下一分包
          </Button>
          <div className="departure-records">
            {remote.value[1].items.map((p) => (
              <button
                className="departure-record"
                disabled={blocked}
                key={p.id}
                onClick={() => setPart(p.id)}
              >
                <strong>
                  分包 {p.number} · {states[p.state]}
                </strong>
                <p>
                  {p.requestedCount} 项 · 截止 {when(p.expiresAt)}
                </p>
              </button>
            ))}
          </div>
          <Pager
            page={page}
            next={!blocked && remote.value[1].hasMore}
            onPage={(p) => {
              if (!blocked) setPage(p);
            }}
          />
        </>
      )}
      {part && <Part tenant={tenant} id={part} nonce={nonce} />}
    </div>
  );
}
function Part({ tenant, id, nonce }: { tenant: string; id: string; nonce: number }) {
  const { blocked, run, reload } = useContext(Actions);
  const remote = useRemote((signal) => api.part(tenant, id, signal), [tenant, id, nonce]);
  const cleanup = useRemote((signal) => api.receipt(tenant, id, signal), [tenant, id, nonce]);
  return (
    <section className="departure-part">
      <h4>分包详情</h4>
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {states[remote.value.state]} · {remote.value.bytes.toLocaleString()} 字节 · 截止{' '}
            {when(remote.value.expiresAt)}
          </p>
          {remote.value.errorCode && <p role="alert">{remote.value.errorCode}</p>}
          <div className="departure-items">
            {remote.value.items.map((i) => (
              <div key={i.ordinal}>
                <strong>{i.filename ?? `第 ${i.ordinal} 项`}</strong>
                <span>
                  v{i.version} ·{' '}
                  {i.state === 'INCLUDED' ? '已包含' : i.state === 'FAILED' ? '缺项' : '待处理'}
                </span>
                {i.errorCode && (
                  <small>
                    {i.errorCode === 'DEPARTURE_EXPORT_ITEM_UNAVAILABLE'
                      ? '当前来源不可用或已无权限'
                      : i.errorCode === 'DEPARTURE_EXPORT_FILE_TOO_LARGE'
                        ? '原件超过分包单项上限'
                        : i.errorCode}
                  </small>
                )}
              </div>
            ))}
          </div>
          <div className="departure-actions">
            {remote.value.canDownload && !blocked && (
              <a className="button primary" href={api.downloadUrl(tenant, id)}>
                下载 ZIP（服务端再次核验）
              </a>
            )}
            {['FAILED', 'PARTIAL'].includes(remote.value.state) && (
              <Button
                disabled={blocked}
                onClick={() =>
                  run(async (requestId) => {
                    await api.partCommand(tenant, id, {
                      requestId,
                      expectedRevision: remote.value!.revision,
                      action: 'RETRY',
                    });
                  })
                }
              >
                重试该分包
              </Button>
            )}
            {!['EXPIRED', 'REVOKED', 'REMOVED'].includes(remote.value.state) && (
              <Button
                disabled={blocked}
                onClick={() =>
                  run(async (requestId) => {
                    await api.partCommand(tenant, id, {
                      requestId,
                      expectedRevision: remote.value!.revision,
                      action: 'REMOVE',
                    });
                  })
                }
              >
                移除临时包
              </Button>
            )}
          </div>
        </>
      )}
      {cleanup.value && (
        <p className="departure-note">
          清理回执：{states[cleanup.value.cleanupState] ?? cleanup.value.cleanupState} · 已实际删除{' '}
          {cleanup.value.removedBytes.toLocaleString()} 字节 · {when(cleanup.value.completedAt)}
          。备份副本另行核验。
        </p>
      )}
    </section>
  );
}

function CleanupList({ tenant, execution, nonce }: { tenant: string; execution: string; nonce: number }) {
  const { blocked, reload } = useContext(Actions),
    [page, setPage] = useState(0);
  const remote = useRemote(
    (signal) => api.receipts(tenant, execution, page * 20, signal),
    [tenant, execution, page, nonce],
  );
  return (
    <details>
      <summary>临时包清理回执（迁出期结束后仍可查看）</summary>
      {remote.error ? (
        <Failure error={remote.error} retry={reload} />
      ) : !remote.value ? (
        <Loading />
      ) : (
        <>
          <div className="departure-records">
            {remote.value.items.length === 0 ? (
              <p>尚无临时分包清理记录。</p>
            ) : (
              remote.value.items.map((r) => (
                <article className="departure-record" key={r.partId}>
                  <strong>
                    {states[r.state]} · {states[r.cleanupState] ?? r.cleanupState}
                  </strong>
                  <p>
                    已实际删除 {r.removedBytes.toLocaleString()} 字节 · {when(r.completedAt)}
                  </p>
                  <small>分包 {r.partId} · 备份副本另行核验</small>
                </article>
              ))
            )}
          </div>
          <Pager
            page={page}
            next={!blocked && remote.value.hasMore}
            onPage={(p) => {
              if (!blocked) setPage(p);
            }}
          />
        </>
      )}
    </details>
  );
}
