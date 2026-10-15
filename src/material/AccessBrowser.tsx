import { useEffect, useState } from 'react';
import { Boxes, FileText, Folder } from 'lucide-react';
import { createIdentityRequest, record } from '../identity/client';
import { Button, Field, Modal } from '../shared/ui';
import { LibraryPermissions } from './Permissions';
interface Item {
  kind: string;
  id: string;
  workspaceId: string;
  name: string;
  canRead: boolean;
  canManagePermissions: boolean;
}
const request = createIdentityRequest();
export function LibraryAccessBrowser({
  tenant,
  mode,
  close,
  open,
}: {
  tenant: string;
  mode: 'MANAGE' | 'SHARED';
  close: () => void;
  open: (item: Item) => void;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<{ items: Item[]; hasMore: boolean }>(),
    [error, setError] = useState(''),
    [target, setTarget] = useState<Item>();
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError('');
    void request(
      `/api/v1/tenants/${tenant}/library-access/locate?mode=${mode}&query=${encodeURIComponent(query)}&offset=${page * 30}`,
      'GET',
      (v): v is { items: Item[]; hasMore: boolean } =>
        record(v) && Array.isArray(v.items) && typeof v.hasMore === 'boolean',
      undefined,
      abort.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [tenant, mode, query, page, revision]);
  return (
    <>
      <Modal title={mode === 'MANAGE' ? '资料权限管理' : '共享给我'} className="perm-modal" onClose={close}>
        <div className="perm access-browser">
          <p className="perm-note">
            {mode === 'MANAGE'
              ? '可定位自己负责范围内的空间、文件夹和文件。管理资格只提供基本名称和权限设置，阅读仍需单独授权。'
              : '这里显示已单独共享给你、但你不能进入所属空间的文件。文件的上级目录内容不会公开。'}
          </p>
          <Field label="按名称查找">
            <input
              type="search"
              value={query}
              maxLength={160}
              placeholder="输入空间、文件夹或文件名称"
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          {!data && !error ? (
            <p className="perm-note">正在加载…</p>
          ) : (
            <ul className="access-list">
              {data?.items.map((item) => {
                const Icon = item.kind === 'WORKSPACE' ? Boxes : item.kind === 'FOLDER' ? Folder : FileText;
                return (
                  <li key={item.kind + item.id}>
                    <span className={`lib-type ${item.kind === 'MATERIAL' ? 'text' : 'folder'}`}>
                      <Icon size={17} strokeWidth={1.7} />
                    </span>
                    <span className="access-name">
                      <strong>{item.name}</strong>
                      <small>
                        {{ WORKSPACE: '空间', FOLDER: '文件夹', MATERIAL: '文件' }[item.kind]}
                        {!item.canRead && <span> · 无内容阅读权限</span>}
                      </small>
                    </span>
                    {item.kind === 'MATERIAL' && item.canRead && (
                      <Button variant="ghost" onClick={() => open(item)}>
                        查看文件
                      </Button>
                    )}
                    {item.canManagePermissions && <Button onClick={() => setTarget(item)}>权限设置</Button>}
                  </li>
                );
              })}
            </ul>
          )}
          {data?.items.length === 0 && <p className="perm-note access-empty">没有符合条件的资料。</p>}
          {(page > 0 || data?.hasMore) && (
            <div className="access-pager">
              <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button disabled={!data?.hasMore} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          )}
        </div>
      </Modal>
      {target && (
        <LibraryPermissions
          tenant={tenant}
          kind={target.kind}
          id={target.id}
          name={target.name}
          close={() => setTarget(undefined)}
          changed={() => setRevision((n) => n + 1)}
        />
      )}
    </>
  );
}
export function LibraryJournal({ tenant, close }: { tenant: string; close: () => void }) {
  const [page, setPage] = useState(0),
    [data, setData] = useState<Record<string, unknown>[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    void request(
      `/api/v1/tenants/${tenant}/library-access/journal?offset=${page * 50}`,
      'GET',
      (v): v is Record<string, unknown>[] => Array.isArray(v),
      undefined,
      abort.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [tenant, page]);
  return (
    <Modal title="访问请求留痕" wide className="journal-modal" onClose={close}>
      <div className="perm">
        <p className="perm-note">
          请求开始先持久记录。未收到结束回执的请求标记为待核对；请求结束不代表业务变更成功，变更结果以文件操作记录为准。
        </p>
        {error && <p role="alert">{error}</p>}
        {data && data.length > 0 && (
          <div className="journal-table">
            <div className="journal-head">
              <span>时间</span>
              <span>请求</span>
              <span>结果</span>
              <span>请求编号</span>
            </div>
            {data.map((row) => {
              const phase =
                row.phase === 'PENDING'
                  ? '待核对'
                  : row.phase === 'RESPONSE_FINISHED'
                    ? '响应结束'
                    : row.phase === 'FAILED'
                      ? '失败'
                      : '超时';
              return (
                <div key={String(row.request_id)} className="journal-row">
                  <time>{new Date(String(row.recorded_at)).toLocaleString('zh-CN')}</time>
                  <span className="journal-route">
                    <b>{String(row.method)}</b> {String(row.route)}
                  </span>
                  <span>
                    <i className={`perm-chip ${row.phase === 'RESPONSE_FINISHED' ? '' : 'edit'}`}>{phase}</i>{' '}
                    HTTP {String(row.status || '—')}
                  </span>
                  <code>{String(row.request_id)}</code>
                </div>
              );
            })}
          </div>
        )}
        {data?.length === 0 && <p className="perm-note access-empty">暂无请求记录。</p>}
        {!data && !error && <p className="perm-note">正在加载…</p>}
        {(page > 0 || data?.length === 50) && (
          <div className="access-pager">
            <Button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              上一页
            </Button>
            <Button disabled={data?.length !== 50} onClick={() => setPage((n) => n + 1)}>
              下一页
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
