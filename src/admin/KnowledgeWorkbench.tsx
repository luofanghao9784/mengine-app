import { versionLabel } from './display-labels';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  FolderOpen,
  CircleCheck,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { readWorkbench } from './knowledge-workbench-client';
import type { WorkbenchItem, WorkbenchState } from '../../contracts/public-api/knowledge-workbench';
import { useSession, identityClient } from '../identity/session';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { DocumentDialog } from '../material/Library';
import { processingStatusLabel } from '../material/Knowledge';
import { adminHref } from './navigation';
import { Button, PageActions } from '../shared/ui';
import './knowledge-workbench.css';

/** Adapted from Mengine Wiki overview layout; all data comes from the platform's file ACL. */
export function KnowledgeWorkbench({
  tenant,
  hash,
  responsibilityPending,
}: {
  tenant: string;
  hash: string;
  responsibilityPending: boolean;
}) {
  const { session } = useSession();
  return (
    <Workbench
      key={tenant + ':' + session.identity?.account.id}
      tenant={tenant}
      hash={hash}
      responsibilityPending={responsibilityPending}
    />
  );
}
function Workbench({
  tenant,
  hash,
  responsibilityPending,
}: {
  tenant: string;
  hash: string;
  responsibilityPending: boolean;
}) {
  const [state, setState] = useState<WorkbenchState>('ALL');
  const [space, setSpace] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [page, setPage] = useState(0);
  const [revision, refresh] = useState(0);
  const [selected, select] = useState<WorkbenchItem | null>(null);
  const data = useRemote(
    (signal) => readWorkbench(tenant, state, space, query, page * 20, signal),
    [tenant, state, space, query, page, revision],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !selected) refresh((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [selected]);
  const filter = (next: WorkbenchState) => {
    setState(next);
    setPage(0);
  };
  const s = data.value?.summary;
  const metrics = [
    {
      title: '可访问知识资产',
      value: s?.total,
      unit: '份',
      note: '当前获权的共享资料',
      icon: BookOpen,
      tone: 'blue',
      state: 'ALL' as const,
    },
    {
      title: '已解析资料',
      value: s?.ready,
      unit: '份',
      note: '解析完成，不代表事实核验',
      icon: CircleCheck,
      tone: 'green',
      state: 'READY' as const,
    },
    {
      title: '正在处理',
      value: s?.processing,
      unit: '份',
      note: '排队中与解析中的资料',
      icon: RefreshCw,
      tone: 'purple',
      state: 'PROCESSING' as const,
    },
    {
      title: '需关注资料',
      value: s?.attention,
      unit: '份',
      note: '部分解析、失败或已中止',
      icon: CircleAlert,
      tone: 'amber',
      state: 'ATTENTION' as const,
    },
  ];
  return (
    <div className="knowledge-workbench">
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={() => refresh((n) => n + 1)}>
          刷新
        </Button>
      </PageActions>
      <header className="kw-heading">
        <div>
          <h2>
            让知识，在正确的权限下流动<span>.</span>
          </h2>
          <p>连接企业资料与工作空间，让每一份知识可用、可追溯。</p>
        </div>
        <div className="kw-actions">
          <button onClick={() => refresh((n) => n + 1)} aria-label="刷新知识工作台">
            <RefreshCw size={17} />
          </button>
          <a href={adminHref('tenant', 'materials', hash, { section: 'files', scope: 'enterprise' })}>
            进入资料库 <ArrowUpRight size={16} />
          </a>
        </div>
      </header>
      {responsibilityPending && (
        <p className="kw-responsibility">
          有负责人职责等待接受。
          <a href={adminHref('tenant', 'members', hash, { detail: 'duties' })}>查看职责与交接</a>
        </p>
      )}
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="kw-scope">
            <ShieldCheck size={15} />
            仅统计本人当前可读取的共享资料
            <span>
              更新于 {new Date(data.value.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          </div>
          <div className="kw-metrics">
            {metrics.map((m) => (
              <button
                key={m.title}
                className={`kw-metric kw-${m.tone}`}
                aria-pressed={state === m.state}
                onClick={() => {
                  filter(m.state);
                  setSpace(null);
                  setQuery('');
                  setDraft('');
                }}
              >
                <span className="kw-metric-title">
                  {m.title}
                  <m.icon size={18} />
                </span>
                <span className="kw-value">
                  {m.value}
                  <small>{m.unit}</small>
                </span>
                <span className="kw-caption">{m.note}</span>
                <span className="kw-action">
                  查看资料 <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
          </div>
          <div className="kw-lower">
            <section className="kw-panel kw-materials">
              <div className="kw-panel-heading">
                <div>
                  <h3>最近更新的资料</h3>
                  <p>依据当前权限和最新版本展示</p>
                </div>
                <button
                  onClick={() => {
                    filter('ALL');
                    setSpace(null);
                    setQuery('');
                    setDraft('');
                  }}
                >
                  查看全部
                </button>
              </div>
              <form
                className="kw-filters"
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(draft.trim());
                  setPage(0);
                }}
              >
                <input
                  aria-label="搜索获权资料"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="搜索资料名称"
                  maxLength={180}
                />
                <button type="submit">搜索</button>
                <select
                  aria-label="资料处理状态"
                  value={state}
                  onChange={(e) => filter(e.target.value as WorkbenchState)}
                >
                  <option value="ALL">全部状态</option>
                  <option value="READY">已解析</option>
                  <option value="PROCESSING">正在处理</option>
                  <option value="ATTENTION">需关注</option>
                  <option value="NOT_STARTED">尚未解析</option>
                </select>
              </form>
              <p className="kw-result" role="status">
                {space ? data.value.spaces.find((x) => x.id === space)?.name || '所选空间' : '全部获权范围'} ·{' '}
                {data.value.filteredTotal} 份资料
              </p>
              {!data.value.items.length ? (
                <div className="kw-empty">
                  <BookOpen size={28} />
                  <h3>{s?.total ? '没有符合条件的资料' : '暂无可访问的共享资料'}</h3>
                  <p>
                    {s?.total ? '调整筛选条件后重试。' : '资料加入共享资料库并获得阅读权限后，会显示在这里。'}
                  </p>
                </div>
              ) : (
                <div className="kw-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>资料名称</th>
                        <th>所属空间</th>
                        <th>处理状态</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.value.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <button className="kw-document" onClick={() => select(item)}>
                              <BookOpen size={16} />
                              <span>
                                {item.name}
                                <small>{versionLabel(item.version)}</small>
                              </span>
                            </button>
                          </td>
                          <td>{item.workspaceName}</td>
                          <td>
                            <span className={`kw-status kw-status-${item.status}`}>
                              {processingStatusLabel[item.status] || item.status}
                            </span>
                          </td>
                          <td>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager page={page} next={data.value.hasMore} onPage={setPage} />
            </section>
            <aside className="kw-panel">
              <div className="kw-panel-heading">
                <div>
                  <h3>知识空间分布</h3>
                  <p>按资料归属，不等同部门权限</p>
                </div>
                <FolderOpen size={20} />
              </div>
              <div className="kw-distribution">
                {data.value.spaces.map((x) => (
                  <button
                    key={x.id || 'independent'}
                    disabled={!x.id}
                    aria-pressed={!!x.id && space === x.id}
                    onClick={() => {
                      setSpace(x.id);
                      setPage(0);
                    }}
                  >
                    <span>
                      <strong>{x.name}</strong>
                      <small>{x.count} 份</small>
                    </span>
                    <span className="kw-track">
                      <span style={{ width: `${s?.total ? (x.count / s.total) * 100 : 0}%` }} />
                    </span>
                    {!x.id && <small>已获文件授权，父空间名称不可见</small>}
                  </button>
                ))}
              </div>
              {!data.value.spaces.length && <p className="kw-caption">获得共享资料访问权限后显示分布。</p>}
              <div className="kw-footnote">
                {s?.notStarted || 0} 份尚未解析。
                <button onClick={() => filter('NOT_STARTED')}>查看资料</button>
                <p>知识质量评分与治理审批将在接入实际检查和处理结果后提供。</p>
              </div>
            </aside>
          </div>
          {selected && (
            <OpenDocument
              tenant={tenant}
              item={selected}
              close={() => select(null)}
              changed={() => {
                select(null);
                refresh((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
export function OpenDocument({
  tenant,
  item,
  close,
  changed,
}: {
  tenant: string;
  item: Pick<WorkbenchItem, 'id' | 'workspaceId'>;
  close: () => void;
  changed: () => void;
}) {
  const [revision, refresh] = useState(0);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, revision]);
  return context.error ? (
    <Failure error={context.error} retry={() => refresh((n) => n + 1)} />
  ) : context.value ? (
    <DocumentDialog
      tenant={tenant}
      entry={item}
      maxBytes={20971520}
      close={close}
      changed={changed}
      verification={context.value}
      administration
    />
  ) : (
    <Loading />
  );
}
