import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FolderOpen, Files, Upload, X, FileText } from 'lucide-react';
import { Button, IconButton, Modal } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { materialClient as api } from './client';
import { destinationNames, planUpload, scanFiles, type BatchFile } from './batch-upload';
import { useUploads } from './UploadManager';

export const uploadSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
export function MaterialUploadDialog({
  tenant,
  workspace,
  parent,
  workspaceName,
  scope,
  children,
  close,
}: {
  tenant: string;
  workspace: string;
  parent: string | null;
  workspaceName: string;
  scope: string;
  children?: ReactNode;
  close: () => void;
}) {
  const { queue } = useUploads();
  const [rows, setRows] = useState<BatchFile[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(50);
  const [confirmClose, setConfirmClose] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    directory = useRef<HTMLInputElement>(null);
  const [directorySupported] = useState(() => 'webkitdirectory' in document.createElement('input'));
  const target = useRemote(
    async (signal) => {
      if (!workspace) return null;
      const page = await api.list(tenant, workspace, parent, '', 0, signal);
      const names = page.canMaintain
        ? await destinationNames(api, { tenant, workspace, parentId: parent }, signal)
        : new Set<string>();
      return { ...page, names };
    },
    [tenant, workspace, parent, attempt],
  );
  useEffect(() => {
    setRows([]);
    setLimit(50);
  }, [workspace, parent]);
  const planned = useMemo(() => planUpload(rows, target.value?.names || new Set()), [rows, target.value]);
  const previews = new Map(planned.map((row) => [row.id, row.parts.join('/')]));
  const destination = [
    workspaceName || '所选空间',
    ...(target.value?.trail.map((part) => part.name) || []),
  ].join(' / ');
  const choose = (files: FileList | null) => {
    if (!files || !target.value?.canMaintain) return;
    const selectionId = crypto.randomUUID();
    const selected = scanFiles(Array.from(files), target.value.maxUploadBytes, target.value.trail.length).map(
      (row) => ({ ...row, selectionId }),
    );
    setRows((previous) => [...previous, ...selected]);
    setConfirmClose(false);
  };
  const ready = !!target.value?.canMaintain && !target.error;
  return (
    <Modal
      title="上传资料"
      wide
      className="material-upload-dialog"
      onClose={() => (rows.length ? setConfirmClose(true) : close())}
    >
      <div className="upload-prepare">
        {children}
        {target.error ? (
          <Failure error={target.error} retry={() => setAttempt((n) => n + 1)} />
        ) : workspace && target.value === undefined ? (
          <Loading />
        ) : !workspace ? (
          <p className="muted">请先选择保存空间。</p>
        ) : target.value && !target.value.canMaintain ? (
          <p role="alert" className="access-alert">
            此位置为只读，请选择有维护权限的空间。
          </p>
        ) : null}
        {ready && (
          <>
            <div className="upload-destination">
              <FolderOpen size={18} />
              <div>
                <small>保存到</small>
                <strong>{destination}</strong>
              </div>
            </div>
            <div className="upload-pickers">
              <Button icon={Files} onClick={() => input.current?.click()}>
                选择文件<span>支持多选</span>
              </Button>
              <Button
                icon={FolderOpen}
                disabled={!directorySupported}
                onClick={() => directory.current?.click()}
              >
                选择文件夹<span>保留目录结构</span>
              </Button>
            </div>
            <input
              ref={input}
              className="sr-only"
              type="file"
              multiple
              tabIndex={-1}
              aria-label="选择上传文件"
              onChange={(e) => {
                choose(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={(el) => {
                directory.current = el;
                el?.setAttribute('webkitdirectory', '');
              }}
              className="sr-only"
              type="file"
              multiple
              tabIndex={-1}
              aria-label="选择上传文件夹"
              onChange={(e) => {
                choose(e.target.files);
                e.target.value = '';
              }}
            />
            <p className="upload-prepare-hint">
              同名自动改名并保留两份。单文件上限 {uploadSize(target.value!.maxUploadBytes)}。
              {directorySupported ? '空文件夹不会上传。' : '当前浏览器不支持选择文件夹，可多选文件上传。'}
            </p>
          </>
        )}
        {!!rows.length && (
          <>
            <div className="upload-preview-heading">
              <strong>
                待上传 {planned.length} 个文件{' '}
                <span>· {uploadSize(planned.reduce((n, row) => n + row.file.size, 0))}</span>
              </strong>
              <button onClick={() => setRows([])}>清空</button>
            </div>
            <ul className="upload-preview-list" aria-label="待上传文件清单">
              {rows.slice(0, limit).map((row) => (
                <li key={row.id}>
                  <FileText size={18} />
                  <div>
                    <strong title={row.localPath}>{row.localPath}</strong>
                    {previews.get(row.id) !== row.localPath && previews.has(row.id) && (
                      <small className="upload-renamed">将保存为：{previews.get(row.id)}</small>
                    )}
                    <small>
                      {uploadSize(row.file.size)}
                      {!row.parseSupported ? ' · 仅保留原件，暂不支持自动解析' : ''}
                    </small>
                    {row.problem && <small className="upload-file-error">{row.problem}</small>}
                  </div>
                  <IconButton
                    icon={X}
                    label={`移除 ${row.localPath}`}
                    onClick={() => setRows((values) => values.filter((value) => value.id !== row.id))}
                  />
                </li>
              ))}
            </ul>
            {rows.length > limit && (
              <Button variant="ghost" onClick={() => setLimit((n) => n + 50)}>
                显示更多文件（剩余 {rows.length - limit} 个）
              </Button>
            )}
            {rows.some((row) => row.problem) && (
              <p className="upload-file-error">不符合要求的文件不会上传，其余文件可继续。</p>
            )}
          </>
        )}
        {confirmClose ? (
          <div className="upload-end-confirm" role="alert">
            <p>尚未开始上传，关闭后将清空本次选择。</p>
            <Button onClick={() => setConfirmClose(false)}>继续选择</Button>
            <Button onClick={close}>放弃本次选择</Button>
          </div>
        ) : (
          <div className="upload-prepare-footer">
            <span>确认后可在右下角查看上传状态</span>
            <Button
              variant="primary"
              icon={Upload}
              disabled={!ready || !planned.length}
              onClick={() => {
                queue.add(
                  { tenant, workspace, parentId: parent },
                  rows,
                  destination,
                  '#' +
                    new URLSearchParams({
                      tenant,
                      view: 'library',
                      scope,
                      ...(parent ? { folder: parent } : {}),
                    }),
                );
                close();
              }}
            >
              开始上传{planned.length ? ` ${planned.length} 个文件` : ''}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
