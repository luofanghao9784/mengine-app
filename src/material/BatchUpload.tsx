import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, FolderOpen, Files, Upload, Square, RefreshCw, XCircle } from 'lucide-react';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { materialClient as api } from './client';
import {
  BatchUploadRun,
  checkBatchFolder,
  uploadError,
  normalizedName,
  scanFiles,
  selectedConflicts,
  validName,
  type BatchFile,
} from './batch-upload';

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
const statusLabel = (row: BatchFile) =>
  ({
    ready: '尚未上传',
    uploading: '正在保存',
    succeeded: '已保存',
    failed: '未完成',
    uncertain: '结果待确认',
  })[row.state];
export function BatchUploadDialog({
  tenant,
  workspace,
  parent,
  children,
  close,
  changed,
}: {
  tenant: string;
  workspace: string;
  parent: string | null;
  children?: ReactNode;
  close: () => void;
  changed: () => void;
}) {
  const [rows, setRows] = useState<BatchFile[]>([]);
  const [name, setName] = useState(
    () =>
      `批量导入 ${new Date().toLocaleDateString('sv-SE')} ${new Date().toTimeString().slice(0, 8).replaceAll(':', '')}`,
  );
  const [run, setRun] = useState<BatchUploadRun>();
  const [startError, setStartError] = useState('');
  const [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [, render] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    directory = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController()),
    mounted = useRef(true),
    working = useRef(false),
    stopRequested = useRef(false);
  const target = useRemote(
    (signal) => (workspace ? api.list(tenant, workspace, parent, '', 0, signal) : Promise.resolve(null)),
    [tenant, workspace, parent, attempt],
  );
  const [directorySupported] = useState(() => 'webkitdirectory' in document.createElement('input'));
  useEffect(
    () => () => {
      mounted.current = false;
      controller.current.abort();
    },
    [],
  );
  useEffect(() => {
    setRows([]);
    setStartError('');
  }, [workspace, parent]);
  useEffect(() => {
    if (!run) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [run]);
  const all = run?.files || rows;
  const conflicts = selectedConflicts(all);
  const selected = all.filter((r) => r.selected && !r.problem);
  const saved = all.filter((r) => r.state === 'succeeded').length;
  const retryable = all.filter((r) => ['failed', 'uncertain'].includes(r.state)).length;
  const pending = all.filter((r) => r.state === 'ready').length;
  const rootConflict = target.value?.items.some((item) => normalizedName(item.name) === normalizedName(name));
  const filtered = all.filter(
    (row) =>
      (!query || row.localPath.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
      (filter === 'all' ||
        (filter === 'selected' && row.selected) ||
        (filter === 'unsupported' && !row.parseSupported) ||
        (filter === 'blocked' && (row.problem || conflicts.has(row.id))) ||
        (filter === 'unfinished' && row.state !== 'succeeded')),
  );
  const maxPage = Math.max(0, Math.ceil(filtered.length / 50) - 1),
    currentPage = Math.min(page, maxPage);
  const visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const choose = (files: FileList | null) => {
    if (!files || !target.value || run) return;
    setRows(scanFiles(Array.from(files), target.value.maxUploadBytes, target.value.trail.length));
    setPage(0);
    setQuery('');
    setFilter('all');
  };
  const changeSelection = (id: string, checked: boolean) =>
    setRows((values) => values.map((row) => (row.id === id ? { ...row, selected: checked } : row)));
  const update = () => {
    if (mounted.current) render((n) => n + 1);
  };
  const execute = async (mode: 'ready' | 'retry') => {
    if (working.current || !workspace || !target.value?.canMaintain || !selected.length || conflicts.size)
      return;
    working.current = true;
    stopRequested.current = false;
    setBusy(true);
    setStopping(false);
    setStartError('');
    try {
      if (!run) {
        await checkBatchFolder(api, { tenant, workspace, parentId: parent, name }, controller.current.signal);
        if (stopRequested.current || controller.current.signal.aborted) return;
      }
      const batch = run || new BatchUploadRun({ tenant, workspace, parentId: parent, name }, rows);
      setRun(batch);
      await batch.execute(api, mode, update, controller.current.signal);
    } catch (error) {
      if (mounted.current) setStartError(uploadError(error));
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        setStopping(false);
        changed();
        update();
      }
    }
  };
  const requestClose = () => {
    if (working.current) return;
    if (run && all.some((row) => row.state !== 'succeeded')) setConfirmClose(true);
    else close();
  };
  return (
    <Modal title="批量上传资料" wide onClose={requestClose}>
      <div className="batch-upload">
        <p className="batch-intro">
          选择你允许上传的文件夹或文件，核对清单后保存。仅扫描本次选择，不监听本地目录。
        </p>
        <fieldset disabled={!!run || busy} className="batch-configuration">
          {children}
          <Field
            label="新批次文件夹"
            hint="在当前目标下新建独立文件夹，保留所选相对目录；不合并或覆盖已有资料。"
          >
            <input
              aria-label="新批次文件夹"
              value={name}
              maxLength={180}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        </fieldset>
        {target.error ? (
          <Failure error={target.error} retry={() => setAttempt((n) => n + 1)} />
        ) : workspace && target.value === undefined ? (
          <Loading />
        ) : !workspace ? (
          <p className="muted">请先选择保存空间。</p>
        ) : target.value && !target.value.canMaintain ? (
          <p className="access-alert" role="alert">
            目标空间为只读。请切换到已获维护权限的空间。
          </p>
        ) : (
          target.value && (
            <>
              <div className="batch-destination">
                <FolderOpen size={18} aria-hidden="true" />
                <span>
                  保存路径：{target.value.trail.map((part) => part.name).join(' / ') || '空间根目录'} /{' '}
                  <strong>{name || '新批次文件夹'}</strong>
                </span>
              </div>
              {!run && (
                <>
                  <div className="batch-pickers">
                    <Button
                      icon={FolderOpen}
                      disabled={!directorySupported}
                      onClick={() => directory.current?.click()}
                    >
                      选择文件夹
                    </Button>
                    <Button icon={Files} onClick={() => input.current?.click()}>
                      选择多个文件
                    </Button>
                    <input
                      ref={(element) => {
                        directory.current = element;
                        element?.setAttribute('webkitdirectory', '');
                      }}
                      className="sr-only"
                      type="file"
                      multiple
                      tabIndex={-1}
                      aria-label="选择授权目录"
                      onChange={(e) => {
                        choose(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <input
                      ref={input}
                      className="sr-only"
                      type="file"
                      multiple
                      tabIndex={-1}
                      aria-label="选择批量文件"
                      onChange={(e) => {
                        choose(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <p className="batch-note">
                    {directorySupported
                      ? '选择文件夹将保留其名称及子目录；空文件夹不会上传。'
                      : '当前浏览器不支持目录选择，请使用“选择多个文件”；文件将平铺保存。'}{' '}
                    单文件上限 {size(target.value.maxUploadBytes)}。重新选择将替换当前预览。
                  </p>
                </>
              )}
            </>
          )
        )}
        {startError && (
          <p role="alert" className="access-alert">
            {startError}
          </p>
        )}
        {!validName(name) && (
          <p role="alert" className="access-alert">
            请输入有效的新文件夹名称，不含路径分隔符或控制字符。
          </p>
        )}
        {!run && rootConflict && (
          <p role="alert" className="access-alert">
            当前目标已有同名项目，请换一个批次文件夹名称。完整冲突检查还会在上传前执行。
          </p>
        )}
        {!!all.length && (
          <>
            <div className="batch-summary" role="status" aria-live="polite">
              <span>
                <strong>{all.length}</strong> 个文件
              </span>
              <span>
                已选择 <strong>{selected.length}</strong> 个 ·{' '}
                {size(selected.reduce((n, row) => n + row.file.size, 0))}
              </span>
              {run && (
                <span className="batch-success">
                  <CheckCircle2 size={15} /> 已保存 {saved} 个
                </span>
              )}
              {!!retryable && <span>待处理 {retryable} 个</span>}
            </div>
            {run && (
              <progress
                className="batch-progress"
                max={all.length}
                value={saved}
                aria-label="已确认保存的文件数量"
              />
            )}
            <div className="batch-filters">
              <input
                aria-label="搜索批量文件"
                placeholder="按相对路径筛选"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
              <select
                aria-label="批量文件筛选"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">全部文件</option>
                <option value="selected">已选择</option>
                <option value="unsupported">暂不支持自动解析</option>
                <option value="blocked">不可上传或路径冲突</option>
                {run && <option value="unfinished">尚未完成</option>}
              </select>
              {!run && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const ids = new Set(filtered.filter((r) => !r.problem).map((r) => r.id));
                    const select = filtered.some((r) => !r.problem && !r.selected);
                    setRows((values) => values.map((r) => (ids.has(r.id) ? { ...r, selected: select } : r)));
                  }}
                >
                  {filtered.some((r) => !r.problem && !r.selected) ? '选择筛选结果' : '取消选择筛选结果'}
                </Button>
              )}
            </div>
            {!!conflicts.size && (
              <p className="access-alert" role="alert">
                所选文件有相同路径或文件与目录重名。请取消冲突项的选择，或在本地调整后重新选择。
              </p>
            )}
            <ul className="batch-file-list" aria-label="批量上传清单">
              {visible.map((row) => (
                <li key={row.id} className={`batch-file ${row.state}`}>
                  <input
                    type="checkbox"
                    aria-label={`上传 ${row.localPath}`}
                    checked={row.selected}
                    disabled={!!run || !!row.problem}
                    onChange={(e) => changeSelection(row.id, e.target.checked)}
                  />
                  <div className="batch-file-content">
                    <strong title={row.localPath}>{row.localPath}</strong>
                    {row.parts.join('/') !== row.localPath && <small>保存为：{row.parts.join('/')}</small>}
                    <div className="batch-file-meta">
                      <span>{size(row.file.size)}</span>
                      <span>
                        {row.parseSupported ? '可尝试解析 · 以实际结果为准' : '仅保留原件 · 暂不支持自动解析'}
                      </span>
                    </div>
                    {(row.problem || conflicts.has(row.id)) && (
                      <p className="batch-file-error">{row.problem || '所选路径冲突'}</p>
                    )}
                    {row.message && (
                      <p className={row.state === 'succeeded' ? 'batch-file-receipt' : 'batch-file-error'}>
                        {row.message}
                      </p>
                    )}
                    {row.receipt?.acceptedVersion && (
                      <details className="batch-receipt">
                        <summary>查看保存回执</summary>
                        <dl>
                          <dt>资料编号</dt>
                          <dd>{row.receipt.id}</dd>
                          <dt>接受版本</dt>
                          <dd>
                            v{row.receipt.acceptedVersion.number} · {row.receipt.acceptedVersion.id}
                          </dd>
                          <dt>当前版本</dt>
                          <dd>v{row.receipt.currentVersion}</dd>
                          <dt>SHA-256</dt>
                          <dd>{row.receipt.acceptedVersion.sha256}</dd>
                        </dl>
                      </details>
                    )}
                  </div>
                  <Badge blue={row.state === 'succeeded'}>
                    {row.problem ? '不可上传' : run ? statusLabel(row) : row.selected ? '待上传' : '已排除'}
                  </Badge>
                </li>
              ))}
              {!visible.length && <li className="batch-empty">没有符合筛选条件的文件。</li>}
            </ul>
            {filtered.length > 50 && (
              <Pager page={currentPage} next={currentPage < maxPage} onPage={setPage} />
            )}
          </>
        )}
        {run && (
          <p className="batch-note">
            已保存的原件不会因停止或关闭而删除。仅当前页面保留重试清单；离开后请先核对资料库，避免重新建立重复批次。上传不代表解析已完成。
          </p>
        )}
        {confirmClose ? (
          <div className="batch-close-confirm" role="alert">
            <p>还有未完成或结果未确认的文件。关闭后无法在本页沿原请求重试；已保存资料继续保留。</p>
            <Button onClick={() => setConfirmClose(false)}>继续核对</Button>
            <Button icon={XCircle} onClick={close}>
              关闭并保留已上传资料
            </Button>
          </div>
        ) : (
          <div className="batch-actions">
            {busy ? (
              <Button
                icon={Square}
                disabled={stopping}
                onClick={() => {
                  stopRequested.current = true;
                  run?.stop();
                  setStopping(true);
                }}
              >
                {stopping ? '正在等待当前操作结束…' : '停止剩余上传'}
              </Button>
            ) : (
              <>
                {!run ? (
                  <Button
                    variant="primary"
                    icon={Upload}
                    disabled={
                      !target.value?.canMaintain ||
                      !selected.length ||
                      !validName(name) ||
                      !!rootConflict ||
                      !!conflicts.size
                    }
                    onClick={() => void execute('ready')}
                  >
                    确认上传 {selected.length} 个文件
                  </Button>
                ) : (
                  <>
                    {!!pending && (
                      <Button
                        variant="primary"
                        icon={Upload}
                        onClick={() => void execute('ready')}
                        disabled={!target.value?.canMaintain}
                      >
                        继续 {pending} 个未上传文件
                      </Button>
                    )}
                    {!!retryable && (
                      <Button
                        icon={RefreshCw}
                        onClick={() => void execute('retry')}
                        disabled={!target.value?.canMaintain}
                      >
                        仅重试 {retryable} 个未完成文件
                      </Button>
                    )}
                  </>
                )}
                <Button variant="ghost" onClick={requestClose}>
                  {run && !pending && !retryable ? '完成并关闭' : '关闭'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
