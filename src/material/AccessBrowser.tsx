import { useEffect, useState } from 'react';
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
      <Modal title={mode === 'MANAGE' ? '资料权限管理' : '共享给我'} onClose={close}>
        <p>
          {mode === 'MANAGE'
            ? '可定位自己负责范围内的空间、文件夹和文件。管理资格只提供基本名称和权限设置，阅读仍需单独授权。'
            : '这里显示已单独共享给你、但你不能进入所属空间的文件。文件的上级目录内容不会公开。'}
        </p>
        <Field label="按名称查找">
          <input
            value={query}
            maxLength={160}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        {!data && !error ? (
          <p>正在加载…</p>
        ) : (
          <ul>
            {data?.items.map((item) => (
              <li key={item.kind + item.id}>
                <strong>{item.name}</strong> ·{' '}
                {{ WORKSPACE: '空间', FOLDER: '文件夹', MATERIAL: '文件' }[item.kind]}
                {item.canManagePermissions && <Button onClick={() => setTarget(item)}>权限设置</Button>}
                {item.kind === 'MATERIAL' && item.canRead && (
                  <Button onClick={() => open(item)}>查看文件</Button>
                )}
                {!item.canRead && <span> · 无内容阅读权限</span>}
              </li>
            ))}
          </ul>
        )}
        {data?.items.length === 0 && <p>没有符合条件的资料。</p>}
        {page > 0 && <Button onClick={() => setPage((p) => p - 1)}>上一页</Button>}
        {data?.hasMore && <Button onClick={() => setPage((p) => p + 1)}>下一页</Button>}
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
    <Modal title="访问请求留痕" onClose={close}>
      <p>
        请求开始先持久记录。未收到结束回执的请求标记为待核对；请求结束不代表业务变更成功，变更结果以文件操作记录为准。
      </p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {data?.map((row) => (
          <li key={String(row.request_id)}>
            {String(row.method)} {String(row.route)} ·{' '}
            {row.phase === 'PENDING'
              ? '待核对'
              : row.phase === 'RESPONSE_FINISHED'
                ? '响应结束'
                : row.phase === 'FAILED'
                  ? '失败'
                  : '超时'}{' '}
            · HTTP {String(row.status || '—')} · {new Date(String(row.recorded_at)).toLocaleString('zh-CN')}
            <details>
              <summary>请求编号</summary>
              {String(row.request_id)}
            </details>
          </li>
        ))}
      </ul>
      {!data && !error && <p>正在加载…</p>}
      {page > 0 && <Button onClick={() => setPage((n) => n - 1)}>上一页</Button>}
      {data?.length === 50 && <Button onClick={() => setPage((n) => n + 1)}>下一页</Button>}
    </Modal>
  );
}
