import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  LoaderCircle,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react';
import { Button, IconButton } from '../shared/ui';
import { materialClient } from './client';
import { UploadQueue } from './upload-queue';
import type { BatchTransport } from './batch-upload';
import './upload.css';

const UploadContext = createContext<UploadQueue | null>(null);
export function useUploads() {
  const queue = useContext(UploadContext);
  if (!queue) throw new Error('UploadProvider required');
  const revision = useSyncExternalStore(queue.subscribe, queue.snapshot);
  return { queue, revision };
}
export function UploadProvider({
  children,
  transport = materialClient,
}: {
  children: ReactNode;
  transport?: BatchTransport;
}) {
  const [queue] = useState(() => new UploadQueue(transport));
  useEffect(() => () => queue.dispose(), [queue]);
  return (
    <UploadContext.Provider value={queue}>
      {children}
      <UploadStatus />
    </UploadContext.Provider>
  );
}
function UploadStatus() {
  const { queue, revision } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [confirmDiscard, setConfirmDiscard] = useState<string>();
  const active = queue.jobs.some((job) => job.state !== 'done');
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
  // Newly added jobs open the panel; ordinary progress never steals focus or expands it.
  const count = queue.jobs.length;
  useEffect(() => {
    setCollapsed(false);
    setProblemsOnly(false);
  }, [count]);
  if (!count) return null;
  const files = queue.jobs.flatMap((job) => job.run.files);
  const saved = files.filter((file) => file.state === 'succeeded').length;
  const problems = files.filter((file) => file.state === 'failed' || file.state === 'uncertain').length;
  const busy = queue.jobs.some((job) => job.state === 'running' || job.state === 'queued');
  const percent = Math.floor((saved / files.length) * 100);
  const title = saved === files.length ? '上传完成' : busy ? '正在上传' : '上传已暂停';
  return (
    <section
      className={`upload-status ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="上传状态"
      data-revision={revision}
    >
      <header className="upload-status-header">
        <div className={`upload-status-symbol ${saved === files.length ? 'complete' : ''}`}>
          {saved === files.length ? <CheckCircle2 size={20} /> : <Upload size={20} />}
        </div>
        <button
          className="upload-status-heading"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls="upload-status-body"
        >
          <strong>{title}</strong>
          <span>
            {saved} / {files.length} 个已保存{problems ? ` · ${problems} 个待处理` : ''}
          </span>
        </button>
        <IconButton
          icon={collapsed ? ChevronUp : ChevronDown}
          label={collapsed ? '展开上传状态' : '收起上传状态'}
          onClick={() => setCollapsed(!collapsed)}
        />
        {!active && (
          <IconButton
            icon={X}
            label="关闭上传状态"
            onClick={() => [...queue.jobs].forEach((job) => queue.dismiss(job))}
          />
        )}
      </header>
      <progress
        className="upload-total-progress"
        max={files.length}
        value={saved}
        aria-label="已保存文件进度"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {title}，已保存 {saved} 个，共 {files.length} 个。{problems ? `${problems} 个需要处理。` : ''}
      </span>
      {!collapsed && (
        <div id="upload-status-body" className="upload-status-body">
          <div className="upload-status-summary">
            <span>整体进度 {percent}%</span>
            {problems > 0 && (
              <button onClick={() => setProblemsOnly(!problemsOnly)}>
                {problemsOnly ? '显示全部' : '只看未完成'}
              </button>
            )}
          </div>
          <div className="upload-status-jobs">
            {queue.jobs.map((job) => {
              const pending = job.run.files.filter((row) => row.state === 'ready').length;
              const retryable = job.run.files.filter(
                (row) => row.state === 'failed' || row.state === 'uncertain',
              ).length;
              return (
                <div className="upload-status-job" key={job.id}>
                  <div className="upload-job-destination">
                    <span title={job.label}>{job.label}</span>
                    <a href={job.href}>查看位置</a>
                  </div>
                  <ul className="upload-status-files">
                    {job.run.files
                      .filter((row) => !problemsOnly || row.state !== 'succeeded')
                      .slice(0, visibleLimit)
                      .map((row) => (
                        <li key={row.id} className={`upload-status-file ${row.state}`}>
                          {row.state === 'succeeded' ? (
                            <CheckCircle2 size={16} />
                          ) : row.state === 'uploading' ? (
                            <LoaderCircle className="upload-spinner" size={16} />
                          ) : ['failed', 'uncertain'].includes(row.state) ? (
                            <AlertCircle size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          <div>
                            <strong title={row.parts.join('/')}>{row.parts.join('/')}</strong>
                            {row.parts.join('/') !== row.localPath && (
                              <small title={row.localPath}>已自动改名 · 原名称 {row.localPath}</small>
                            )}
                            {row.message && <small className="upload-file-error">{row.message}</small>}
                          </div>
                          <span>
                            {
                              {
                                ready: '等待',
                                uploading: '保存中',
                                succeeded: '已保存',
                                failed: '失败',
                                uncertain: '待确认',
                              }[row.state]
                            }
                          </span>
                        </li>
                      ))}
                  </ul>
                  {job.run.files.filter((row) => !problemsOnly || row.state !== 'succeeded').length >
                    visibleLimit && (
                    <Button variant="ghost" onClick={() => setVisibleLimit((n) => n + 50)}>
                      显示更多文件
                    </Button>
                  )}
                  {job.error && (
                    <p className="upload-file-error" role="alert">
                      {job.error}
                    </p>
                  )}
                  <div className="upload-job-actions">
                    {job.state === 'running' || job.state === 'queued' ? (
                      <Button variant="ghost" disabled={job.stopping} onClick={() => queue.pause(job)}>
                        {job.stopping ? '正在暂停…' : '暂停后续上传'}
                      </Button>
                    ) : (
                      <>
                        {!!pending && (
                          <Button variant="ghost" onClick={() => queue.resume(job, 'ready')}>
                            继续上传 {pending} 个
                          </Button>
                        )}
                        {!!retryable && (
                          <Button variant="ghost" onClick={() => queue.resume(job, 'retry')}>
                            重试 {retryable} 个
                          </Button>
                        )}
                        {job.state === 'done' && (
                          <Button variant="ghost" onClick={() => queue.dismiss(job)}>
                            完成
                          </Button>
                        )}
                        {job.state === 'paused' && (
                          <Button variant="ghost" onClick={() => setConfirmDiscard(job.id)}>
                            结束本次上传
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {confirmDiscard === job.id && (
                    <div className="upload-end-confirm" role="alert">
                      <p>已保存的文件会保留。结束后将清除未完成文件的重试清单。</p>
                      <Button onClick={() => setConfirmDiscard(undefined)}>继续保留</Button>
                      <Button
                        onClick={() => {
                          queue.dismiss(job);
                          setConfirmDiscard(undefined);
                        }}
                      >
                        结束上传
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="upload-status-note">
            可收起并继续浏览。刷新、关闭网页或切换企业会中断未完成上传；文件解析在保存后继续处理。
          </p>
        </div>
      )}
    </section>
  );
}
