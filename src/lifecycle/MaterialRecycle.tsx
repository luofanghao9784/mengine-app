import { useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  History,
  RefreshCw,
} from 'lucide-react';
import type { LifecycleItem } from '../../contracts/public-api/lifecycle';
import { LibraryToolbar, LibrarySearch } from '../material/LibraryToolbar';
import { Button, Empty, IconButton, PageActions } from '../shared/ui';
import { ActionPopover } from '../shared/ActionPopover';
import { Failure, Loading, Pager, SubmitError, useRemote } from '../shared/admin';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { MaterialActionDialog, useLifecycleAction } from './MaterialActions';
import { lifecycleClient as api } from './client';
import './recycle.css';
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export function MaterialRecycle({
  tenant,
  workspace,
  workspaceName,
  view,
  back,
  navigate,
  changed,
  verification,
}: {
  tenant: string;
  workspace: string;
  workspaceName: string;
  view: 'TRASH' | 'RECORDS';
  back: () => void;
  navigate: (view: 'TRASH' | 'RECORDS') => void;
  changed: () => void;
  verification: unknown;
}) {
  const key = 'library:recycle:' + workspace + ':' + view;
  const [input, setInput] = useViewState(tenant, key + ':input', '', textState);
  const [query, setQuery] = useViewState(tenant, key + ':query', '', textState);
  const [page, setPage] = useViewState(tenant, key + ':page', 0, pageState);
  const [layout, setLayout] = useViewState<'cards' | 'list'>(
    tenant,
    'library:recycle:layout',
    'list',
    (v): v is 'cards' | 'list' => v === 'cards' || v === 'list',
  );
  const [revision, setRevision] = useState(0);
  const pending = useContext(RequestPending);
  const data = useRemote(
    (signal) => api.list(tenant, workspace, page * 20, signal, { view, query }),
    [tenant, workspace, view, query, page, revision, verification],
  );
  const refresh = () => setRevision((x) => x + 1);
  useEffect(() => {
    if (data.value && !data.value.items.length && page > 0) setPage(page - 1);
  }, [data.value, page, setPage]);
  return (
    <div
      className="library-page material-recycle"
      aria-label={view === 'TRASH' ? '资料回收站' : '资料删除记录'}
    >
      <PageActions placement="meta">
        <LibrarySearch
          disabled={pending}
          query={input}
          onQuery={setInput}
          label={view === 'TRASH' ? '搜索回收站' : '搜索删除记录'}
          onSearch={() => {
            setQuery(input.trim());
            setPage(0);
          }}
          onClear={() => {
            setInput('');
            setQuery('');
            setPage(0);
          }}
        />
        <Button icon={ArrowLeft} disabled={pending} onClick={back}>
          返回资料库
        </Button>
      </PageActions>
      <LibraryToolbar
        disabled={pending}
        layout={layout}
        onLayout={setLayout}
        extraActions={
          <>
            <IconButton
              icon={RefreshCw}
              label={view === 'TRASH' ? '刷新回收站' : '刷新删除记录'}
              disabled={pending}
              onClick={refresh}
            />
            <Button
              variant="ghost"
              icon={view === 'TRASH' ? History : Trash2}
              disabled={pending}
              onClick={() => navigate(view === 'TRASH' ? 'RECORDS' : 'TRASH')}
            >
              {view === 'TRASH' ? '删除记录' : '回收站'}
            </Button>
          </>
        }
      >
        <nav className="material-crumbs" aria-label="文件夹路径">
          <button disabled={pending} onClick={back}>
            {workspaceName}
          </button>
          <ChevronRight size={14} />
          {view === 'RECORDS' ? (
            <>
              <button disabled={pending} onClick={() => navigate('TRASH')}>
                回收站
              </button>
              <ChevronRight size={14} />
              <span aria-current="page">删除记录</span>
            </>
          ) : (
            <span aria-current="page">回收站</span>
          )}
        </nav>
      </LibraryToolbar>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {!data.value.items.length ? (
            <Empty
              icon={view === 'TRASH' ? Trash2 : History}
              title={query ? '没有找到资料' : view === 'TRASH' ? '回收站为空' : '暂无删除记录'}
              text=""
            />
          ) : (
            <div className={`material-entries ${layout} recycle-entries`}>
              {layout === 'list' && (
                <div className="recycle-list-heading" aria-hidden="true">
                  <span>名称</span>
                  <span>原位置</span>
                  <span>删除时间</span>
                  <span>{view === 'TRASH' ? '保留截止' : '状态'}</span>
                  <span>操作</span>
                </div>
              )}
              {data.value.items.map((item) => (
                <RecycleItem
                  key={item.kind + item.id}
                  tenant={tenant}
                  workspace={workspace}
                  item={item}
                  records={view === 'RECORDS'}
                  changed={() => {
                    refresh();
                    changed();
                  }}
                />
              ))}
            </div>
          )}
          {(page > 0 || data.value.hasMore) && (
            <Pager
              page={page}
              next={data.value.hasMore}
              onPage={(next) => {
                if (!pending) setPage(next);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
function RecycleItem({
  tenant,
  workspace,
  item,
  records,
  changed,
}: {
  tenant: string;
  workspace: string;
  item: LifecycleItem;
  records: boolean;
  changed: () => void;
}) {
  const [menu, setMenu] = useState(false),
    [purge, setPurge] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const mutation = useLifecycleAction(tenant, workspace, item, changed);
  const expired = item.state === 'TRASHED' && !!item.purgeAfter && Date.parse(item.purgeAfter) <= Date.now();
  const name = item.kind === 'FOLDER' ? '文件夹' : '文件';
  const Icon = item.kind === 'FOLDER' ? Folder : FileText;
  return (
    <article className="material-entry recycle-entry" aria-label={`${name} ${item.name}`}>
      <div className="material-cover">
        <Icon size={32} />
        <span>{name}</span>
        <div className="material-cover-art" aria-hidden="true">
          <Icon strokeWidth={1.3} />
        </div>
      </div>
      <div className="recycle-item-name">
        <Icon size={18} aria-hidden="true" />
        <strong title={item.name}>{item.name}</strong>
      </div>
      <span className="recycle-path" title={item.path.join(' / ')}>
        <span className="recycle-mobile-label">原位置</span>
        {item.path.join(' / ')}
      </span>
      <time className="recycle-date" dateTime={item.trashedAt || undefined}>
        <span className="recycle-mobile-label">删除时间</span>
        {date(item.trashedAt)}
      </time>
      {records ? (
        <span className="recycle-state">
          {expired ? '已过保留期' : item.state === 'PURGING' ? '正在清理' : '在线内容已清理'}
        </span>
      ) : (
        <time className="recycle-deadline" dateTime={item.purgeAfter || undefined}>
          <span className="recycle-mobile-label">保留截止</span>
          {date(item.purgeAfter)}
        </time>
      )}
      <div className="recycle-item-actions">
        {!records && (
          <Button
            icon={RotateCcw}
            disabled={
              mutation.busy ||
              (!mutation.uncertain && (mutation.otherPending || !item.parentAvailable || expired))
            }
            onClick={() => void mutation.run(item.revision, 'RESTORE')}
          >
            {mutation.busy ? '正在恢复…' : mutation.uncertain ? '重试恢复' : '恢复'}
          </Button>
        )}
        {!records && item.canPurge && (
          <div ref={anchor} className="workspace-more-actions">
            <IconButton
              icon={MoreHorizontal}
              label={`更多操作 ${item.name}`}
              aria-expanded={menu}
              disabled={mutation.locked || mutation.otherPending}
              onClick={() => setMenu(!menu)}
            />
            {menu && (
              <ActionPopover anchor={anchor} label={`更多操作 ${item.name}`} onClose={() => setMenu(false)}>
                <Button
                  icon={Trash2}
                  onClick={() => {
                    setMenu(false);
                    setPurge(true);
                  }}
                >
                  彻底删除
                </Button>
              </ActionPopover>
            )}
          </div>
        )}
      </div>
      {!records && !item.parentAvailable && <p className="recycle-item-message">请先恢复原文件夹</p>}
      <div className="recycle-item-message">
        <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
      </div>
      {records && item.cleanupJobId && (
        <details className="recycle-cleanup">
          <summary>清理详情</summary>
          <CleanupDetails tenant={tenant} workspace={workspace} item={item} changed={changed} />
        </details>
      )}
      {purge && (
        <MaterialActionDialog
          tenant={tenant}
          workspace={workspace}
          selection={item}
          action="PURGE"
          close={() => setPurge(false)}
          changed={() => {
            setPurge(false);
            changed();
          }}
        />
      )}
    </article>
  );
}
function CleanupDetails({
  tenant,
  workspace,
  item,
  changed,
}: {
  tenant: string;
  workspace: string;
  item: LifecycleItem;
  changed: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const data = useRemote(
    (signal) => api.cleanup(tenant, workspace, item.cleanupJobId!, signal),
    [tenant, workspace, item.cleanupJobId, revision],
  );
  const mutation = useLifecycleAction(tenant, workspace, item, changed);
  useEffect(() => {
    if (!data.value || !['QUEUED', 'CLEANING'].includes(data.value.state)) return;
    const timer = setTimeout(() => {
      if (!requestNavigationLocked()) setRevision((x) => x + 1);
    }, 5000);
    return () => clearTimeout(timer);
  }, [data.value]);
  return data.error ? (
    <Failure error={data.error} retry={() => setRevision((x) => x + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <div>
      <p>
        {
          { QUEUED: '等待清理', CLEANING: '正在清理', FAILED: '清理失败', COMPLETE: '在线清理完成' }[
            data.value.state
          ]
        }{' '}
        · 已清理 {data.value.originalsRemoved}/{data.value.originals} 个原件
      </p>
      {data.value.errorCode && <p role="alert">在线清理未完成，可重试。错误：{data.value.errorCode}</p>}
      <p>备份清理状态需另行核对。</p>
      {data.value.state === 'FAILED' && item.canPurge && (
        <Button
          icon={RefreshCw}
          disabled={mutation.busy || mutation.otherPending}
          onClick={() => void mutation.run(item.revision, 'RETRY_CLEANUP')}
        >
          {mutation.uncertain ? '重试同一次操作' : '重试清理'}
        </Button>
      )}
      <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
    </div>
  );
}
