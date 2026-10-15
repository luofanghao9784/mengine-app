import { useEffect, useState, useRef } from 'react';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { Button, Field, Modal } from '../shared/ui';
import { Loading } from '../shared/admin';

interface Grant {
  principalKind: 'ACCOUNT' | 'DEPARTMENT';
  principalId: string;
  content: 'NONE' | 'READ' | 'EDIT';
  download: 'INHERIT' | 'ALLOW' | 'DENY';
  manageFiles: boolean;
  roleDepartmentId: string | null;
}
interface Policy {
  kind: string;
  id: string;
  workspaceId: string;
  revision: number;
  inherit: boolean;
  effective: {
    canRead: boolean;
    canEdit: boolean;
    canDownload: boolean;
    canManageFiles: boolean;
    canManagePermissions: boolean;
  };
  grants: Grant[];
}
interface Impact {
  fingerprint: string;
  objects: number;
  changes: {
    accountId: string;
    name: string;
    kind: string;
    objectId: string | null;
    objectName: string;
    beforeMask: number;
    afterMask: number;
  }[];
}
interface Explanation {
  reasons: {
    scope: string;
    principal: string;
    content: string;
    download: string;
    inherit: boolean;
    allowsEffective: boolean;
  }[];
  people: { id: string; name: string; mask: number }[];
}
interface Directory {
  people: { id: string; name: string }[];
  departments: Department[];
}
interface Department {
  id: string;
  name: string;
  revision: number;
  members: string[];
}
interface Event {
  id: number;
  actorId: string | null;
  actorName?: string | null;
  action: string;
  outcome: string;
  occurredAt: string;
  beforeValue: string | null;
  afterValue: string | null;
  requestId?: string | null;
  executionSource?: string;
  httpStatus?: number | null;
}
const request = createIdentityRequest();
const root = (tenant: string) => `/api/v1/tenants/${tenant}/library-access`;
const isPolicy = (v: unknown): v is Policy =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  Number.isInteger(v.revision) &&
  typeof v.inherit === 'boolean' &&
  record(v.effective) &&
  Array.isArray(v.grants);
const isDirectory = (v: unknown): v is Directory =>
  record(v) && Array.isArray(v.people) && Array.isArray(v.departments);
const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请稍后重试');
const actionNames: Record<string, string> = {
  PERMISSION_CHANGE: '修改权限',
  PERMISSION_IMPACT: '权限变更影响',
  ROLE_GRANT_REVOKED: '调岗撤销个人授权',
  MATERIAL_UPLOAD: '上传文件',
  MATERIAL_VERSION: '上传新版本',
  MATERIAL_DOWNLOAD: '下载文件',
  MATERIAL_PREVIEW: '预览文件',
  PERMISSION_MODEL_MIGRATION: '权限规则迁移',
  MATERIAL_TRASH: '删除文件',
  MATERIAL_RESTORE: '恢复文件',
  MATERIAL_CITATION_READ: '查看引用片段',
  TASK_ORIGINAL_READ: 'AI 读取原件',
  MATERIAL_FOLDER_CREATE: '创建文件夹',
  MATERIAL_MOVE: '移动资料',
  MOVE_PERMISSION_CHANGE: '移动引起的权限变化',
  REQUEST_DOWNLOAD: '下载请求',
  REQUEST_READ: '阅读请求',
  REQUEST_PERMISSIONS: '权限请求',
  REQUEST_PREVIEW: '预览请求',
  REQUEST_MOVE: '移动请求',
  REQUEST_AUDIT_READ: '查看操作记录',
};

export function useLibraryPermissionsEnabled(tenant: string) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(false);
    const abort = new AbortController();
    void request(
      root(tenant) + '/status',
      'GET',
      (v): v is { enabled: boolean } => record(v) && typeof v.enabled === 'boolean',
      undefined,
      abort.signal,
    )
      .then((v) => setEnabled(v.enabled))
      .catch(() => {});
    return () => abort.abort();
  }, [tenant]);
  return enabled;
}

export function LibraryPermissions({
  tenant,
  kind,
  id,
  name,
  close,
  changed,
}: {
  tenant: string;
  kind: string;
  id: string;
  name: string;
  close: () => void;
  changed: () => void;
}) {
  const [policy, setPolicy] = useState<Policy>();
  const [directory, setDirectory] = useState<Directory>();
  const [inherit, setInherit] = useState(true);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Impact>();
  const [explanation, setExplanation] = useState<Explanation>();
  const pending = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    void request(root(tenant) + `/${kind}/${id}`, 'GET', isPolicy, undefined, abort.signal)
      .then((p) => {
        setPolicy(p);
        void request(
          root(tenant) + `/${kind}/${id}/explanation`,
          'GET',
          (v): v is Explanation => record(v) && Array.isArray(v.reasons) && Array.isArray(v.people),
          undefined,
          abort.signal,
        )
          .then(setExplanation)
          .catch((e) => {
            if (!abort.signal.aborted) setError(errorText(e));
          });
        setInherit(p.inherit);
        setGrants(p.grants);
        if (p.effective.canManagePermissions)
          return request(
            root(tenant) + `/directory?space=${p.workspaceId}`,
            'GET',
            isDirectory,
            undefined,
            abort.signal,
          ).then(setDirectory);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [tenant, kind, id]);
  const update = (index: number, patch: Partial<Grant>) => {
    setConfirmation(undefined);
    setGrants((old) => old.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  };
  const body = () => {
    if (!policy) throw new Error('权限尚未加载');
    const fingerprint = JSON.stringify({ tenant, kind, id, revision: policy.revision, inherit, grants });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    return { requestId: pending.current!.id, revision: policy.revision, inherit, grants };
  };
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      setConfirmation(
        await request(
          root(tenant) + `/${kind}/${id}/preview`,
          'POST',
          (v): v is Impact => record(v) && typeof v.fingerprint === 'string' && Array.isArray(v.changes),
          body(),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!policy || !confirmation) return;
    setBusy(true);
    setError('');
    try {
      await request(root(tenant) + `/${kind}/${id}`, 'PUT', isPolicy, {
        change: body(),
        fingerprint: confirmation.fingerprint,
      });
      changed();
      close();
    } catch (e) {
      setError(errorText(e));
      setConfirmation(undefined);
    } finally {
      setBusy(false);
    }
  };
  const principal = (g: Grant) =>
    (g.principalKind === 'ACCOUNT' ? directory?.people : directory?.departments)?.find(
      (p) => p.id === g.principalId,
    )?.name || '已停用成员';
  const readers = explanation?.people.filter((p) => p.mask & 1) || [];
  const blocked = explanation?.people.filter((p) => !(p.mask & 1)) || [];
  const editable = !!policy?.effective.canManagePermissions && !!directory;
  return (
    <Modal title={`权限设置 · ${name}`} className="perm-modal" onClose={busy ? () => {} : close}>
      {error && (
        <p role="alert" className="access-alert">
          {error}
        </p>
      )}
      {!policy ? (
        <Loading />
      ) : (
        <div className="perm">
          <p className="perm-me">
            <span>本人：</span>
            <AccessChips
              mask={
                (policy.effective.canRead ? 1 : 0) |
                (policy.effective.canEdit ? 2 : 0) |
                (policy.effective.canDownload ? 4 : 0)
              }
            />
            {policy.effective.canManagePermissions && <i className="perm-chip manage">可管理授权</i>}
          </p>
          {explanation && (
            <section className="perm-section">
              <h3>
                谁可以访问
                <small>
                  {readers.length} 人可查看{blocked.length ? ` · ${blocked.length} 人不可查看` : ''}
                </small>
              </h3>
              {readers.length > 0 ? (
                <ul className="perm-people">
                  {readers.map((p) => (
                    <li key={p.id}>
                      <i className="perm-avatar">{p.name.slice(0, 1)}</i>
                      <b>{p.name}</b>
                      <AccessChips mask={p.mask} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="perm-note">目前没有成员可以查看。</p>
              )}
              <details className="perm-details">
                <summary>查看生效权限与授权来源</summary>
                {blocked.length > 0 && (
                  <p className="perm-blocked">不可查看：{blocked.map((p) => p.name).join('、')}</p>
                )}
                <ul className="perm-reasons">
                  {explanation.reasons.map((r, i) => (
                    <li key={i}>
                      <b>
                        {r.scope} · {r.principal}
                      </b>
                      <span>
                        {{ NONE: '不可查看', READ: '仅查看', EDIT: '可编辑' }[r.content] || r.content} /{' '}
                        {{ ALLOW: '允许下载', DENY: '禁止下载', INHERIT: '未单独授予下载' }[r.download] ||
                          r.download}
                        {!r.allowsEffective ? '（上层允许不继承，明确禁止仍生效）' : ''}
                        {!r.inherit ? ' · 此范围停止继承允许授权' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="perm-note">
                  管理权限不代表能阅读文件。多个允许授权合并，明确禁止优先；独立范围也不能绕过上级的禁止。派生成果还需拥有来源权限。
                </p>
              </details>
            </section>
          )}
          {editable && directory ? (
            <section className="perm-section">
              <h3>调整授权</h3>
              <Field label="默认权限">
                <select
                  disabled={busy}
                  value={String(inherit)}
                  onChange={(e) => {
                    setInherit(e.target.value === 'true');
                    setConfirmation(undefined);
                  }}
                >
                  <option value="true">继承上级权限，并应用下方授权</option>
                  <option value="false">独立范围，保留上级明确禁止</option>
                </select>
              </Field>
              {kind === 'WORKSPACE' && (
                <p className="perm-note">空间继承现有空间成员授权；独立范围会停止使用这些默认内容权限。</p>
              )}
              {grants.map((g, i) => (
                <fieldset key={g.principalKind + g.principalId} disabled={busy} className="perm-grant">
                  <legend>
                    <i className={`perm-avatar ${g.principalKind === 'DEPARTMENT' ? 'team' : ''}`}>
                      {principal(g).slice(0, 1)}
                    </i>
                    {principal(g)} · {g.principalKind === 'ACCOUNT' ? '成员' : '部门'}
                  </legend>
                  <Button
                    variant="ghost"
                    className="perm-remove"
                    onClick={() => {
                      setGrants((old) => old.filter((_, j) => j !== i));
                      setConfirmation(undefined);
                    }}
                  >
                    移除此项授权
                  </Button>
                  <Field label="内容权限">
                    <select
                      value={g.content}
                      onChange={(e) =>
                        update(i, {
                          content: e.target.value as Grant['content'],
                          ...(e.target.value === 'NONE' ? { manageFiles: false } : {}),
                        })
                      }
                    >
                      <option value="NONE">不可查看（明确禁止）</option>
                      <option value="READ">仅查看</option>
                      <option value="EDIT">可编辑</option>
                    </select>
                  </Field>
                  <Field label="下载权限">
                    <select
                      value={g.download}
                      onChange={(e) => update(i, { download: e.target.value as Grant['download'] })}
                    >
                      <option value="INHERIT">不增加下载授权</option>
                      <option value="ALLOW">允许下载</option>
                      <option value="DENY">禁止下载（优先）</option>
                    </select>
                  </Field>
                  {g.principalKind === 'ACCOUNT' && (
                    <Field label="调岗关联">
                      <select
                        value={g.roleDepartmentId || ''}
                        onChange={(e) => update(i, { roleDepartmentId: e.target.value || null })}
                      >
                        <option value="">独立授权，调岗时保留</option>
                        {directory.departments
                          .filter((d) => d.members.includes(g.principalId))
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              调离{d.name}时撤销
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  <label className="perm-check">
                    <input
                      type="checkbox"
                      checked={g.manageFiles}
                      disabled={g.content === 'NONE'}
                      onChange={(e) => update(i, { manageFiles: e.target.checked })}
                    />
                    明确委派移动、删除资格
                  </label>
                </fieldset>
              ))}
              <Field label="添加部门或成员">
                <select
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [principalKind, principalId] = e.target.value.split(':');
                    setGrants((old) => [
                      ...old,
                      {
                        principalKind: principalKind as Grant['principalKind'],
                        principalId,
                        content: 'READ',
                        download: 'INHERIT',
                        manageFiles: false,
                        roleDepartmentId: null,
                      },
                    ]);
                    setConfirmation(undefined);
                  }}
                >
                  <option value="">选择授权对象</option>
                  {(['DEPARTMENT', 'ACCOUNT'] as const).map((k) => (
                    <optgroup key={k} label={k === 'DEPARTMENT' ? '部门（随成员关系生效）' : '成员'}>
                      {(k === 'DEPARTMENT' ? directory.departments : directory.people)
                        .filter((p) => !grants.some((g) => g.principalKind === k && g.principalId === p.id))
                        .map((p) => (
                          <option key={p.id} value={`${k}:${p.id}`}>
                            {p.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {confirmation && (
                <div
                  role="alert"
                  className="perm-confirm"
                  ref={(el) => el?.scrollIntoView({ block: 'center' })}
                >
                  <h3>请核对本次变更</h3>
                  <p>
                    将{inherit ? '保留继承' : '停止继承'}，保存以上 {grants.length}{' '}
                    项明确授权。影响该对象及继承它的子目录和文件；不可查看或禁止下载优先。确认后立即生效并留痕。
                  </p>
                  <p>本次影响 {confirmation.changes.length} 项人员与对象权限：</p>
                  {!confirmation.changes.length && <p>现有成员的生效权限不变。</p>}
                  <ul>
                    {confirmation.changes.map((c, i) => (
                      <li key={i}>
                        <b>
                          {c.name} · {c.objectName}
                        </b>
                        <span>
                          {describeAccess(c.beforeMask)} → {describeAccess(c.afterMask)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="modal-actions perm-actions">
                {confirmation ? (
                  <>
                    <Button disabled={busy} onClick={() => setConfirmation(undefined)}>
                      返回核对
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => void save()}>
                      确认保存
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" disabled={busy} onClick={() => void preview()}>
                    {busy ? '正在计算影响…' : '核对并保存'}
                  </Button>
                )}
              </div>
            </section>
          ) : !policy.effective.canManagePermissions ? (
            <p className="perm-note">你没有此范围的授权管理资格。</p>
          ) : (
            <Loading />
          )}
        </div>
      )}
    </Modal>
  );
}

function AccessChips({ mask }: { mask: number }) {
  return !(mask & 1) ? (
    <i className="perm-chip none">不可查看</i>
  ) : (
    <>
      <i className={`perm-chip ${mask & 2 ? 'edit' : ''}`}>{mask & 2 ? '可编辑' : '仅查看'}</i>
      <i className={`perm-chip ${mask & 4 ? '' : 'none'}`}>{mask & 4 ? '可下载' : '不可下载'}</i>
    </>
  );
}

const describeAccess = (mask: number) =>
  !(mask & 1) ? '不可查看' : `${mask & 2 ? '可编辑' : '仅查看'} / ${mask & 4 ? '可下载' : '不可下载'}`;

function PermissionEventSummary({ before, after }: { before: string | null; after: string | null }) {
  const summary = (value: string | null) => {
    if (!value) return '无旧记录';
    try {
      const parsed: unknown = JSON.parse(value);
      const grants = Array.isArray(parsed)
        ? parsed
        : record(parsed) && Array.isArray(parsed.grants)
          ? parsed.grants
          : null;
      if (record(parsed) && typeof parsed.destinationFolder === 'string')
        return '位置已变更，文件身份和版本保留';
      if (Array.isArray(parsed) && parsed.some((g) => record(g) && typeof g.beforeMask === 'number')) {
        return parsed
          .map(
            (g: Record<string, unknown>) =>
              `${g.name || '历史成员'} · ${g.objectName || '资料'}：${describeAccess(Number(g.beforeMask))} → ${describeAccess(Number(g.afterMask))}`,
          )
          .join('；');
      }
      if (!grants) return '已保存操作结果';
      const counts = grants.reduce((n: Record<string, number>, g: unknown) => {
        if (record(g) && typeof g.content === 'string') n[g.content] = (n[g.content] || 0) + 1;
        return n;
      }, {});
      const inheritance =
        record(parsed) && typeof parsed.inherit === 'boolean'
          ? parsed.inherit
            ? '继承上级'
            : '独立范围'
          : '明确授权';
      return `${inheritance}；不可查看 ${counts.NONE || 0} 项，仅查看 ${counts.READ || 0} 项，可编辑 ${counts.EDIT || 0} 项`;
    } catch {
      return '历史记录';
    }
  };
  return (
    <>
      <p>变更前：{summary(before)}</p>
      <p>变更后：{summary(after)}</p>
    </>
  );
}

export function LibraryEvents({
  tenant,
  kind,
  id,
  canAudit = false,
}: {
  tenant: string;
  kind: string;
  id: string;
  canAudit?: boolean;
}) {
  const [audit, setAudit] = useState(false);
  const [events, setEvents] = useState<Event[]>();
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setEvents(undefined);
    setError('');
    void request(
      root(tenant) + `/${kind}/${id}/events?offset=${offset}&view=${audit ? 'AUDIT' : 'OPERATIONS'}`,
      'GET',
      (v): v is Event[] => Array.isArray(v),
      undefined,
      abort.signal,
    )
      .then(setEvents)
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [tenant, kind, id, offset, audit]);
  const outcomes: Record<string, string> = {
    SUCCESS: '成功',
    DENIED: '已拒绝',
    CONFLICT: '状态冲突',
    FAILED: '失败',
    CANCELLED: '已取消',
  };
  return (
    <section className="mat-events">
      <h3>文件操作记录</h3>
      {canAudit && (
        <label className="perm-check">
          <input
            type="checkbox"
            checked={audit}
            onChange={(e) => {
              setAudit(e.target.checked);
              setOffset(0);
            }}
          />
          包含访问明细与权限变更（仅管理员）
        </label>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : !events ? (
        <Loading />
      ) : (
        <>
          <ul>
            {events.map((e) => (
              <li key={e.id}>
                <b>
                  {actionNames[e.action] || e.action}
                  <i className={`perm-chip ${e.outcome === 'SUCCESS' ? '' : 'edit'}`}>
                    {outcomes[e.outcome] || e.outcome}
                  </i>
                </b>
                <small>
                  {e.actorName || (e.actorId ? '历史成员' : '系统')} ·{' '}
                  {new Date(e.occurredAt).toLocaleString('zh-CN')}
                  {e.executionSource === 'AI'
                    ? ' · AI 执行'
                    : e.executionSource === 'SYSTEM'
                      ? ' · 系统执行'
                      : ''}
                </small>
                {audit && e.requestId && (
                  <details>
                    <summary>请求核对信息</summary>
                    <p>
                      请求编号：{e.requestId}
                      {e.httpStatus ? `；HTTP 状态：${e.httpStatus}` : ''}
                    </p>
                  </details>
                )}
                {e.afterValue && (
                  <details>
                    <summary>变更详情</summary>
                    <PermissionEventSummary before={e.beforeValue} after={e.afterValue} />
                    {audit && (
                      <details>
                        <summary>完整变更快照</summary>
                        <p>变更前</p>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {e.beforeValue || '无'}
                        </pre>
                        <p>变更后</p>
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.afterValue}</pre>
                      </details>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
          {events.length === 0 && <p className="perm-note">暂无操作记录。</p>}
          {(offset > 0 || events.length >= 50) && (
            <div className="access-pager">
              <Button disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 50))}>
                上一页
              </Button>
              <Button disabled={events.length < 50} onClick={() => setOffset((n) => n + 50)}>
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function LibraryDepartments({ tenant }: { tenant: string }) {
  const enabled = useLibraryPermissionsEnabled(tenant);
  return enabled ? <DepartmentEditor tenant={tenant} /> : null;
}
function DepartmentEditor({ tenant }: { tenant: string }) {
  const [data, setData] = useState<Directory>();
  const [selected, setSelected] = useState<Department>();
  const [exceptions, setExceptions] = useState<
    {
      accountId: string;
      kind: string;
      id: string;
      name: string;
      roleDepartmentId: string | null;
      content: string;
      download: string;
    }[]
  >();
  const [exceptionError, setExceptionError] = useState('');
  useEffect(() => {
    setExceptions(undefined);
    setExceptionError('');
    if (!selected) return;
    const abort = new AbortController();
    void request(
      root(tenant) + `/departments/${selected.id}/exceptions`,
      'GET',
      (v): v is NonNullable<typeof exceptions> => Array.isArray(v),
      undefined,
      abort.signal,
    )
      .then(setExceptions)
      .catch((e) => {
        if (!abort.signal.aborted) setExceptionError(errorText(e));
      });
    return () => abort.abort();
  }, [tenant, selected?.id]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    void request(root(tenant) + '/directory', 'GET', isDirectory, undefined, abort.signal)
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [tenant, attempt]);
  return (
    <section>
      <h3>部门与资料授权</h3>
      <p>部门成员加入后获得部门授权；调离时失去部门授权，并撤销标记为随该部门调岗撤销的个人授权。</p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <Button
            onClick={() => setSelected({ id: crypto.randomUUID(), name: '', revision: 0, members: [] })}
          >
            新建部门
          </Button>
          {data.departments.map((d) => (
            <p key={d.id}>
              <Button onClick={() => setSelected({ ...d })}>
                {d.name} · {d.members.length} 人
              </Button>
            </p>
          ))}
          {selected && (
            <Modal title="部门成员设置" onClose={busy ? () => {} : () => setSelected(undefined)}>
              <Field label="部门名称">
                <input
                  value={selected.name}
                  disabled={busy}
                  onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                />
              </Field>
              {data.people.map((p) => (
                <label key={p.id} style={{ display: 'block' }}>
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={selected.members.includes(p.id)}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        members: e.target.checked
                          ? [...selected.members, p.id]
                          : selected.members.filter((m) => m !== p.id),
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
              <p>保存立即更新部门授权；移除成员时，岗位关联的个人授权会一并撤销并记录。</p>
              {exceptionError && <p role="alert">{exceptionError}</p>}
              {error && <p role="alert">{error}</p>}
              {exceptions && (
                <section>
                  <h4>调离成员的个人授权例外</h4>
                  <ul>
                    {exceptions
                      .filter((g) => !selected.members.includes(g.accountId))
                      .map((g) => (
                        <li key={g.accountId + g.kind + g.id}>
                          {data.people.find((p) => p.id === g.accountId)?.name || '成员'} · {g.name}：
                          {g.roleDepartmentId === selected.id
                            ? '随此次调离撤销'
                            : '个人独立或其他部门关联，继续保留'}
                        </li>
                      ))}
                  </ul>
                  <p className="muted">
                    如需保留本部门关联授权，请先在相应资料的权限设置中解除调岗关联，再重新打开本部门。
                  </p>
                </section>
              )}
              <Button
                disabled={busy || !selected.name.trim() || !exceptions || !!exceptionError}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  const fingerprint = JSON.stringify(selected);
                  if (pending.current?.fingerprint !== fingerprint)
                    pending.current = { fingerprint, id: crypto.randomUUID() };
                  void request(
                    root(tenant) + `/departments/${selected.id}`,
                    'PUT',
                    (v): v is Department => record(v) && uuid(v.id),
                    {
                      requestId: pending.current!.id,
                      revision: selected.revision,
                      name: selected.name,
                      members: selected.members,
                    },
                  )
                    .then(() => {
                      setSelected(undefined);
                      setAttempt((n) => n + 1);
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                确认保存成员变更
              </Button>
            </Modal>
          )}
        </>
      )}
    </section>
  );
}
