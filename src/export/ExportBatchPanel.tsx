import { useRequestLock } from '../shared/request-guard';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Archive, Download, RefreshCw, Trash2 } from 'lucide-react';
import type {
  ExportBatch,
  ExportChoice,
  ExportScope,
  ExportSelection,
  ExportState,
} from '../../contracts/public-api/export';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Button, Field } from '../shared/ui';
import {
  Failure,
  Loading,
  MutationGate,
  Pager,
  SubmitError,
  useRemote,
  useSubmission,
} from '../shared/admin';
import { exportClient as api } from './client';
import './export.css';
const Busy = createContext(false),
  Locks = createContext<(key: symbol, value: boolean) => void>(() => {});
function useLock(locked: boolean) {
  const key = useRef(Symbol()),
    register = useContext(Locks);
  useEffect(() => {
    if (locked) {
      register(key.current, true);
      return () => register(key.current, false);
    }
  }, [locked, register]);
}
const states: Record<ExportState, string> = {
  QUEUED: '已排队',
  GENERATING: '正在生成',
  READY: '所选项全部生成',
  PARTIAL: '部分生成',
  FAILED: '生成失败',
  EXPIRED: '已过期',
  REVOKED: '来源已失效',
  REMOVED: '已移除',
};
const failures: Record<string, string> = {
  EXPORT_ITEM_UNAVAILABLE: '成果、来源或当前授权不可用',
  EXPORT_ITEM_GENERATION_FAILED: '此项生成失败',
  EXPORT_BATCH_LIMIT: '超过本批次总大小上限',
  EXPORT_ITEM_TOO_LARGE: '超过单份成果大小上限',
  EXPORT_NO_CONTENT: '没有成功生成的成果，未保留空包',
  EXPORT_GENERATION_FAILED: '生成中断，可按原选择重试',
  EXPORT_SOURCE_REMOVED: '来源已清理，临时包已失效',
  EXPORT_CLEANUP_FAILED: '在线清理失败，系统将重试',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—');
const bytes = (n: number) =>
  n < 0 ? '生成后确定' : n < 1024 ? `${n} B` : `${(n / 1024 / 1024).toFixed(2)} MB`;
const key = (s: ExportSelection) => `${s.objectId}:${s.version}:${s.format}`;
export interface ExportBatchPanelProps {
  tenant: string;
  workspace: string;
  workspaceName: string;
  scope: ExportScope;
  verification?: unknown;
}
/** Same component may be placed in an authorized personal document view or shared material workspace. */
export function ExportBatchPanel(props: ExportBatchPanelProps) {
  const { session } = useSession();
  return session.identity ? (
    <Panel
      key={`${session.identity.account.id}:${props.tenant}:${props.workspace}:${props.scope}`}
      {...props}
    />
  ) : null;
}
function Panel({ tenant, workspace, workspaceName, scope, verification }: ExportBatchPanelProps) {
  const { session } = useSession(),
    outer = useContext(MutationGate);
  const [transient, setTransient] = useState(false),
    [locks, setLocks] = useState<Set<symbol>>(() => new Set()),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string>(),
    [picking, setPicking] = useState(false),
    [denied, setDenied] = useState<unknown>();
  const register = useCallback(
      (key: symbol, value: boolean) =>
        setLocks((previous) => {
          const next = new Set(previous);
          if (value) next.add(key);
          else next.delete(key);
          return next;
        }),
      [],
    ),
    blocked = transient || locks.size > 0;
  useRequestLock(blocked);
  useEffect(() => {
    outer(blocked);
    return () => outer(false);
  }, [blocked, outer]);
  const batches = useRemote(
    (signal) => api.list(tenant, workspace, page * 20, signal),
    [tenant, workspace, page, attempt, verification, session.identity],
  );
  const fail = useCallback((error: unknown) => {
    if (error instanceof IdentityError && [401, 403, 404].includes(error.status)) {
      setDenied(error);
      setSelected(undefined);
      setPicking(false);
    }
  }, []);
  const refresh = () => {
    setDenied(undefined);
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    const focus = () => {
      if (!blocked) refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [blocked]);
  useEffect(() => {
    setDenied(undefined);
  }, [verification, session.identity]);
  if (denied)
    return (
      <section className="export-panel">
        <Failure error={denied} retry={refresh} />
      </section>
    );
  return (
    <MutationGate.Provider value={setTransient}>
      <Locks.Provider value={register}>
        <Busy.Provider value={blocked}>
          <section className="export-panel" data-export-scope={scope} data-workspace-id={workspace}>
            <header className="export-heading">
              <div>
                <h2>
                  <Archive size={20} /> 批量导出
                </h2>
                <p>
                  {workspaceName} · {scope === 'PRIVATE' ? '本人私人文稿' : '独立发布的企业成果'}
                </p>
              </div>
              <div className="export-toolbar">
                <Button
                  variant="primary"
                  disabled={blocked}
                  onClick={() => {
                    setPicking(!picking);
                    setSelected(undefined);
                  }}
                >
                  {picking ? '收起选择' : '选择成果并导出'}
                </Button>
                <Button icon={RefreshCw} aria-label="刷新导出批次" disabled={blocked} onClick={refresh} />
              </div>
            </header>
            <p className="export-note">
              每次明确选择具体版本。临时 ZIP
              包包含生成清单和缺项原因，下载时重新核对权限；它不代表完整迁移或系统备份。截止时间使用当前设备时区。
            </p>
            {picking && (
              <Picker
                tenant={tenant}
                workspace={workspace}
                scope={scope}
                onDenied={fail}
                done={(id) => {
                  setPicking(false);
                  setSelected(id);
                  refresh();
                }}
              />
            )}
            {batches.error ? (
              <Failure error={batches.error} retry={refresh} />
            ) : !batches.value ? (
              <Loading />
            ) : (
              <>
                <div className="export-history" aria-label="我的导出批次">
                  {!batches.value.items.length ? (
                    <p className="export-muted">当前范围还没有导出批次。</p>
                  ) : (
                    batches.value.items.map((batch) => (
                      <button
                        className={'export-batch-card ' + (selected === batch.id ? 'selected' : '')}
                        key={batch.id}
                        disabled={blocked}
                        onClick={() => {
                          setSelected(batch.id);
                          setPicking(false);
                        }}
                      >
                        <strong>
                          {states[batch.state]} · {batch.requestedCount} 项
                        </strong>
                        <span>创建于 {when(batch.createdAt)}</span>
                        <small>
                          {batch.expiresAt ? '截止 ' + when(batch.expiresAt) : '完成生成后确定截止时间'}
                        </small>
                      </button>
                    ))
                  )}
                </div>
                <fieldset className="export-page" disabled={blocked}>
                  <Pager page={page} next={batches.value.hasMore} onPage={setPage} />
                </fieldset>
              </>
            )}
            {selected && (
              <BatchDetail
                key={selected}
                tenant={tenant}
                id={selected}
                verification={attempt}
                onDenied={fail}
                changed={refresh}
              />
            )}
            <p className="export-muted">
              导出记录仅本人可见。服务器到期清理临时包，不删除成果本体，也不能远程清除已下载的副本。
            </p>
          </section>
        </Busy.Provider>
      </Locks.Provider>
    </MutationGate.Provider>
  );
}
function Picker({
  tenant,
  workspace,
  scope,
  onDenied,
  done,
}: {
  tenant: string;
  workspace: string;
  scope: ExportScope;
  onDenied: (error: unknown) => void;
  done: (id: string) => void;
}) {
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx'),
    [page, setPage] = useState(0),
    [object, setObject] = useState<string>(),
    [basket, setBasket] = useState<ExportChoice[]>([]),
    [days, setDays] = useState(7),
    [attempt, setAttempt] = useState(0);
  const submit = useSubmission<{ items: ExportSelection[]; retentionDays: number }>(),
    locked = submit.busy || submit.uncertain,
    blocked = useContext(Busy);
  useLock(locked);
  const options = useRemote(
    (signal) => api.options(tenant, workspace, scope, format, page * 20, object, signal),
    [tenant, workspace, scope, format, page, object, attempt],
  );
  useEffect(() => {
    if (options.error) {
      setBasket([]);
      onDenied(options.error);
    }
  }, [options.error, onDenied]);
  useEffect(() => {
    if (options.value && !options.value.retentionDays.includes(days))
      setDays(options.value.retentionDays.at(-1)!);
  }, [options.value, days]);
  const toggle = (choice: ExportChoice) =>
    setBasket((previous) =>
      previous.some((c) => key(c.selection) === key(choice.selection))
        ? previous.filter((c) => key(c.selection) !== key(choice.selection))
        : [...previous, choice],
    );
  return (
    <div className="export-picker">
      <div className="export-toolbar">
        {scope === 'PRIVATE' && (
          <Field label="新选择项的导出格式">
            <select
              aria-label="新选择项的导出格式"
              disabled={blocked || locked}
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as 'docx' | 'pdf');
                setPage(0);
              }}
            >
              <option value="docx">Word（.docx）</option>
              <option value="pdf">PDF</option>
            </select>
          </Field>
        )}
        {object && (
          <Button
            disabled={blocked || locked}
            onClick={() => {
              setObject(undefined);
              setPage(0);
            }}
          >
            返回成果列表
          </Button>
        )}
      </div>
      {options.error ? (
        <Failure error={options.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !options.value ? (
        <Loading />
      ) : (
        <>
          <p className="export-note">
            每批最多 {options.value.maxItems} 项，总正文文件不超过 {bytes(options.value.maxBytes)}
            。选入后固定版本，不随以后编辑更新。
          </p>
          {!options.value.canExport && (
            <p className="access-alert">
              你可以阅读这些成果，但尚未获授此范围的批量导出资格。请通过已有职责管理办理；单份成果仍可使用原下载入口。
            </p>
          )}
          <ul className="export-choices">
            {options.value.items.map((choice) => (
              <li key={key(choice.selection)}>
                <label>
                  <input
                    type="checkbox"
                    checked={basket.some((c) => key(c.selection) === key(choice.selection))}
                    disabled={
                      blocked ||
                      locked ||
                      !options.value!.canExport ||
                      (basket.length >= options.value!.maxItems &&
                        !basket.some((c) => key(c.selection) === key(choice.selection)))
                    }
                    onChange={() => toggle(choice)}
                  />
                  <span>
                    <strong>{choice.title}</strong>
                    <small>
                      版本 {choice.selection.version} · {choice.selection.format.toUpperCase()} ·{' '}
                      {bytes(choice.sizeBytes)}
                    </small>
                  </span>
                </label>
                {!object && (
                  <Button
                    variant="ghost"
                    disabled={blocked || locked}
                    onClick={() => {
                      setObject(choice.selection.objectId);
                      setPage(0);
                    }}
                  >
                    选择历史版本
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!options.value.items.length && (
            <p className="export-muted">
              本页没有当前可导出的成果；有来源缺口的私人文稿不会出现在选择列表中。
            </p>
          )}
          <fieldset className="export-page" disabled={blocked || locked}>
            <Pager page={page} next={options.value.hasMore} onPage={setPage} />
          </fieldset>
          <div className="export-basket">
            <h3>已选择 {basket.length} 项</h3>
            {basket.map((choice) => (
              <div key={key(choice.selection)}>
                <span>
                  {choice.title} · v{choice.selection.version} · {choice.selection.format}
                </span>
                <Button
                  variant="ghost"
                  disabled={blocked || locked}
                  aria-label={`移除 ${choice.title} v${choice.selection.version} ${choice.selection.format}`}
                  onClick={() => toggle(choice)}
                >
                  移除
                </Button>
              </div>
            ))}
            <Field label="临时包有效期">
              <select
                aria-label="临时包有效期"
                disabled={blocked || locked}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {options.value.retentionDays.map((n) => (
                  <option key={n} value={n}>
                    生成后 {n} 天
                  </option>
                ))}
              </select>
            </Field>
            <SubmitError error={submit.error} uncertain={submit.uncertain} />
            <Button
              variant="primary"
              disabled={
                submit.busy || (blocked && !submit.uncertain) || !basket.length || !options.value.canExport
              }
              onClick={() =>
                void submit.submit(
                  { items: basket.map((c) => c.selection), retentionDays: days },
                  async (body, requestId) => {
                    try {
                      const result = await api.create(tenant, {
                        requestId,
                        workspaceId: workspace,
                        scope,
                        ...body,
                      });
                      done(result.id);
                    } catch (e) {
                      onDenied(e);
                      throw e;
                    }
                  },
                )
              }
            >
              {submit.uncertain ? '重试同次导出请求' : '生成所选版本的临时包'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
function BatchDetail({
  tenant,
  id,
  verification,
  onDenied,
  changed,
}: {
  tenant: string;
  id: string;
  verification: unknown;
  onDenied: (e: unknown) => void;
  changed: () => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [downloading, setDownloading] = useState(false),
    [error, setError] = useState<unknown>(),
    blocked = useContext(Busy);
  useLock(downloading);
  const data = useRemote((signal) => api.get(tenant, id, signal), [tenant, id, verification, attempt]);
  const observed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!data.value || blocked) return;
    const stamp = JSON.stringify([
      data.value.revision,
      data.value.state,
      data.value.cleanup.state,
      data.value.bytes,
    ]);
    if (observed.current === stamp) return;
    observed.current = stamp;
    changed();
  }, [data.value, blocked, changed]);

  useEffect(() => {
    if (data.error) onDenied(data.error);
  }, [data.error, onDenied]);
  useEffect(() => {
    if (
      !blocked &&
      data.value &&
      (data.value.state === 'QUEUED' ||
        data.value.state === 'GENERATING' ||
        data.value.cleanup.state === 'PENDING' ||
        data.value.cleanup.state === 'FAILED')
    ) {
      const timer = window.setTimeout(() => setAttempt((n) => n + 1), 1500);
      return () => clearTimeout(timer);
    }
  }, [data.value, blocked]);
  if (data.error) return <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const b = data.value;
  async function download() {
    setDownloading(true);
    setError(undefined);
    try {
      const blob = await api.download(tenant, id),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `dreamcore-export-${id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
      setAttempt((n) => n + 1);
      onDenied(e);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section className="export-detail" aria-label="导出批次详情">
      <div className="export-detail-heading">
        <h3>{states[b.state]}</h3>
        <small>批次 {b.id}</small>
      </div>
      <div className="export-stats">
        <span>所选 {b.requestedCount} 项</span>
        <span>已生成 {b.includedCount} 项</span>
        <span>失败/缺项 {b.failedCount} 项</span>
        <span>包大小 {bytes(b.bytes)}</span>
      </div>
      <p className="export-note">
        截止：{when(b.expiresAt)}。
        {b.state === 'PARTIAL'
          ? '这是部分导出，请核对每项失败原因。'
          : b.state === 'READY'
            ? '仅表示所选版本已完整打包，不代表企业数据已完整迁移。'
            : '生成状态以服务端记录为准。'}
      </p>
      {b.errorCode && (
        <p className="access-alert">{failures[b.errorCode] || '批次未完成，请检查状态或重试。'}</p>
      )}
      <ul className="export-items">
        {b.items.map((item) => (
          <li key={item.ordinal}>
            <span className="export-ordinal">{item.ordinal}</span>
            <div>
              <strong>{item.visible ? item.title : '内容或授权已不可读取'}</strong>
              <small>
                所选版本 {item.selection.version} · {item.selection.format.toUpperCase()} ·{' '}
                {item.state === 'INCLUDED'
                  ? '已纳入'
                  : item.state === 'FAILED'
                    ? '未纳入'
                    : item.state === 'WRITING'
                      ? '正在写入'
                      : '待处理'}
              </small>
              {item.errorCode && <p>{failures[item.errorCode] || '此项暂不可用'}</p>}
              {item.visible && item.archivePath && <code>{item.archivePath}</code>}
            </div>
          </li>
        ))}
      </ul>
      <div className="export-toolbar">
        <Button
          icon={Download}
          variant="primary"
          disabled={blocked || downloading || !b.canDownload}
          onClick={() => void download()}
        >
          {downloading ? '核对权限并下载…' : '下载 ZIP 与清单'}
        </Button>
        <Button icon={RefreshCw} disabled={blocked} onClick={() => setAttempt((n) => n + 1)}>
          核对最新状态
        </Button>
      </div>
      {!b.canDownload && ['READY', 'PARTIAL'].includes(b.state) && (
        <p className="export-muted">
          当前包不可下载，请核对截止时间、批量导出资格和所有已纳入成果的当前来源权限。
        </p>
      )}
      <SubmitError error={error} uncertain={false} />
      <Commands
        key={`${b.id}:${b.revision}`}
        tenant={tenant}
        batch={b}
        onDenied={onDenied}
        done={() => {
          setAttempt((n) => n + 1);
          changed();
        }}
      />
      {b.cleanup.state !== 'NONE' && (
        <div className="export-cleanup" role="status">
          <strong>
            {b.cleanup.state === 'COMPLETE'
              ? '在线临时包已清理'
              : b.cleanup.state === 'FAILED'
                ? '在线清理失败，等待重试'
                : '等待在线清理'}
          </strong>
          <p>
            {b.cleanup.state === 'COMPLETE'
              ? `实际完成于 ${when(b.cleanup.completedAt)}，本批次累计删除 ${bytes(b.cleanup.removedBytes)}。`
              : `已执行 ${b.cleanup.attempts} 次清理尝试。`}
          </p>
          <small>
            成果本体与临时包分别管理；旧数据库快照和备份按其保留政策处理，此回执不代表所有历史副本已抹除。
          </small>
        </div>
      )}
    </section>
  );
}
function Commands({
  tenant,
  batch,
  onDenied,
  done,
}: {
  tenant: string;
  batch: ExportBatch;
  onDenied: (e: unknown) => void;
  done: () => void;
}) {
  const submit = useSubmission<'RETRY' | 'REMOVE'>(),
    locked = submit.busy || submit.uncertain,
    blocked = useContext(Busy);
  useLock(locked);
  const act = (action: 'RETRY' | 'REMOVE') =>
    void submit.submit(action, async (frozen, requestId) => {
      try {
        await api.command(tenant, batch.id, { requestId, expectedRevision: batch.revision, action: frozen });
        done();
      } catch (e) {
        onDenied(e);
        throw e;
      }
    });
  return (
    <div className="export-commands">
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      {submit.uncertain ? (
        <Button disabled={submit.busy} onClick={() => act('REMOVE')}>
          重试同次批次操作
        </Button>
      ) : (
        <div className="export-toolbar">
          {batch.state === 'FAILED' && !batch.expiresAt && (
            <Button disabled={blocked || locked} onClick={() => act('RETRY')}>
              按原选择重试生成
            </Button>
          )}
          {!['EXPIRED', 'REVOKED', 'REMOVED'].includes(batch.state) && (
            <Button icon={Trash2} disabled={blocked || locked} onClick={() => act('REMOVE')}>
              提前移除临时包
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
