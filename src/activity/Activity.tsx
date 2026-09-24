import { useEffect, useRef, useState } from 'react';
import { Activity, Download, FileText, RefreshCw } from 'lucide-react';
import type { ActivityItem, ActivityKind } from '../../contracts/public-api/activity';
import type { TenantContext } from '../../contracts/public-api/identity';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Button, Badge, Empty } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { materialClient } from '../material/client';
import { libraryHref } from '../material/Library';
import { activityClient } from './client';
import './activity.css';

const verbs: Record<ActivityKind, string> = {
  MATERIAL_UPLOADED: '上传了资料',
  MATERIAL_UPDATED: '上传了新版本',
  DOCUMENT_PUBLISHED: '发布了文稿',
  DOCUMENT_UPDATED: '更新了已发布文稿',
};
export function SharedActivity({ tenant, context }: { tenant: string; context: TenantContext }) {
  const { session, expire } = useSession();
  const [space, setSpace] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const download = useRef<AbortController | null>(null);
  const data = useRemote(
    (signal) => activityClient.list(tenant, space, cursors[page], signal),
    [tenant, space, cursors[page], attempt, session.identity],
  );
  const cancelDownload = () => {
    download.current?.abort();
    setDownloading(null);
    setDownloadError('');
  };
  useEffect(() => {
    download.current?.abort();
    setDownloading(null);
    return () => download.current?.abort();
  }, [tenant, space, page, attempt, session.identity]);
  const refresh = () => {
    cancelDownload();
    setCursors([null]);
    setPage(0);
    setAttempt((x) => x + 1);
  };
  async function save(item: ActivityItem) {
    cancelDownload();
    const controller = new AbortController();
    download.current = controller;
    setDownloading(item.id);
    try {
      const blob = await materialClient.download(
        tenant,
        item.workspaceId,
        item.materialId,
        item.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = item.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof IdentityError && error.status === 401) expire();
      else if (error instanceof IdentityError && [403, 404].includes(error.status)) {
        refresh();
        setDownloadError('此资料已不可访问，动态已重新核对。');
      } else setDownloadError('下载未完成，请重试。');
    } finally {
      if (download.current === controller) setDownloading(null);
    }
  }
  return (
    <section className="access-panel shared-activity" aria-label="企业动态">
      <header className="access-section-heading">
        <div>
          <h2>企业动态</h2>
          <p className="muted">查看共享资料的维护与发布记录</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新动态
        </Button>
      </header>
      <div className="activity-filter">
        <label>
          空间范围{' '}
          <select
            aria-label="动态空间范围"
            value={space || ''}
            onChange={(event) => {
              cancelDownload();
              setSpace(event.target.value || null);
              setCursors([null]);
              setPage(0);
            }}
          >
            <option value="">全部可见共享空间</option>
            {context.workspaces
              .filter((s) => s.kind === 'SHARED')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <span className="muted">按资料权限展示</span>
      </div>
      {downloadError && (
        <p role="alert" className="access-alert">
          {downloadError}
        </p>
      )}
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {data.value.items.length ? (
            <ol className="activity-list">
              {data.value.items.map((item) => (
                <li key={item.id}>
                  <span className="activity-symbol">
                    <FileText size={19} />
                  </span>
                  <div className="activity-body">
                    <p>
                      <strong>{item.actorName}</strong> {verbs[item.kind]}
                    </p>
                    <div className="activity-file">
                      <span>{item.filename}</span>
                      <Badge>v{item.version}</Badge>
                    </div>
                    <div className="activity-meta">
                      <span>{item.workspaceName}</span>
                      <time dateTime={item.occurredAt}>
                        {new Date(item.occurredAt).toLocaleString('zh-CN', { hour12: false })}
                      </time>
                    </div>
                    <div className="activity-actions">
                      <Button
                        variant="ghost"
                        icon={Download}
                        disabled={downloading === item.id}
                        onClick={() => void save(item)}
                      >
                        {downloading === item.id ? '正在下载…' : `下载 v${item.version}`}
                      </Button>
                      <a href={libraryHref(tenant, item.workspaceId, item.folderId || undefined)}>
                        进入资料位置
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty
              icon={Activity}
              title="暂无可见动态"
              text="共享空间上传资料、更新版本或发布文稿后，会在这里留下记录。"
            />
          )}
          {(page > 0 || data.value.nextCursor) && (
            <Pager
              page={page}
              next={!!data.value.nextCursor}
              onPage={(next) => {
                cancelDownload();
                if (next > page)
                  setCursors((previous) => [...previous.slice(0, page + 1), data.value!.nextCursor]);
                setPage(next);
              }}
            />
          )}
        </>
      )}
      <p className="access-footnote">
        仅记录已保存的共享资料变更；私人会话、个人草稿和未发布成果不在此展示。
      </p>
    </section>
  );
}
