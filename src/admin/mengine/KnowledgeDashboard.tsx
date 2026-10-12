import { useState } from 'react';
import { OrbitCanvas } from './OrbitCanvas';
import { readWorkbench } from '../knowledge-workbench-client';
import { governanceApi } from '../../material/governance-client';
import { proposals } from '../../material/proposals-client';
import { activityClient } from '../../activity/client';
import { useRemote, Failure, Loading } from '../../shared/admin';
import { MaterialPipeline } from '../../material/MaterialPipeline';
import { OpenDocument } from '../KnowledgeWorkbench';
import { adminHref } from '../navigation';
import type { WorkbenchItem } from '../../../contracts/public-api/knowledge-workbench';
import './mengine.css';

/** Mengine's dashboard composition; current platform APIs own every count and permission. */
export function KnowledgeDashboard({ tenant, hash }: { tenant: string; hash: string }) {
  const [revision, refresh] = useState(0),
    [selected, setSelected] = useState(''),
    [opened, open] = useState<WorkbenchItem | null>(null),
    [paused, pause] = useState(false);
  const data = useRemote((signal) => readWorkbench(tenant, 'ALL', null, '', 0, signal), [tenant, revision]);
  const quality = useRemote(
    (signal) => governanceApi.list(tenant, '', 'all', 'all', 'priority', 0, signal),
    [tenant, revision],
  );
  const pending = useRemote((signal) => proposals.list(tenant, 'PENDING', 0, signal), [tenant, revision]);
  const activity = useRemote((signal) => activityClient.list(tenant, null, null, signal), [tenant, revision]);
  const item = data.value?.items.find((x) => x.id === selected) || data.value?.items[0];
  const phase = !data.value
    ? 'offline'
    : !item
      ? 'idle'
      : item.status === 'RUNNING'
        ? 'parsing'
        : item.status === 'QUEUED'
          ? 'received'
          : ['FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(item.status)
            ? 'failed'
            : 'idle';
  const link = (page: Parameters<typeof adminHref>[1], extra = {}) => adminHref('tenant', page, hash, extra);
  return (
    <div className="mengine-dashboard">
      <header className="mengine-heading">
        <div>
          <small>ENTERPRISE KNOWLEDGE WORKSPACE</small>
          <h2>
            让知识，在正确的权限下流动<span>.</span>
          </h2>
          <p>知识资产、处理流程与团队动态</p>
        </div>
        <div>
          <button onClick={() => refresh((n) => n + 1)}>刷新仪表盘</button>{' '}
          <a className="button primary" href={link('materials', { section: 'files', scope: 'enterprise' })}>
            导入与管理资料
          </a>
        </div>
      </header>
      <section className="mengine-flow">
        <div className="mengine-orbit">
          <OrbitCanvas phase={phase} paused={paused} pending={false} />
          <div className="mengine-orbit-caption">
            <strong>知识处理流程</strong>
            <span>{item ? `${item.name} · v${item.version}` : '等待接入资料'}</span>
            <button onClick={() => pause((x) => !x)}>{paused ? '播放视觉效果' : '暂停视觉效果'}</button>
          </div>
        </div>
        <div className="mengine-flow-detail">
          <h3>当前资料</h3>
          {data.error ? (
            <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
          ) : !data.value ? (
            <Loading />
          ) : item ? (
            <>
              <select aria-label="仪表盘资料" value={item.id} onChange={(e) => setSelected(e.target.value)}>
                {data.value.items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · v{x.version}
                  </option>
                ))}
              </select>
              <p>最近更新的 {data.value.items.length} 份获权资料；动画不代表执行进度。</p>
              <MaterialPipeline
                key={item.id + ':' + revision}
                tenant={tenant}
                workspace={item.workspaceId}
                material={item.id}
              />
              <button onClick={() => open(item)}>阅读当前资料</button>
            </>
          ) : (
            <p>导入资料后展示服务端实际处理状态。</p>
          )}
        </div>
      </section>
      <div className="mengine-metrics">
        <a href={link('catalog')}>
          <span>可访问知识资产</span>
          <strong>{data.value?.summary.total ?? '—'}</strong>
          <small>查看资产列表</small>
        </a>
        <a href={link('overview', { layout: 'workbench' })}>
          <span>知识覆盖空间</span>
          <strong>{data.value?.spaces.filter((s) => s.id !== null).length ?? '—'}</strong>
          <small>按空间归属统计，不等同部门权限</small>
        </a>
        <a href={link('governance')}>
          <span>知识质量评分</span>
          <strong>
            {quality.value?.summary.average == null ? '—' : Math.round(quality.value.summary.average)}
          </strong>
          <small>
            {quality.error
              ? '暂时无法读取'
              : `基于 ${quality.value?.summary.checked ?? 0} 份已检查资料 · 查看规则明细`}
          </small>
        </a>
        <a href={link('proposals')}>
          <span>待处理业务提案</span>
          <strong>
            {pending.value ? `${pending.value.items.length}${pending.value.hasMore ? '+' : ''}` : '—'}
          </strong>
          <small>{pending.error ? '暂时无法读取' : '本人可维护范围 · 查看待处理列表'}</small>
        </a>
      </div>
      <div className="mengine-lower">
        <section className="mengine-panel">
          <header>
            <h3>最近更新的资料</h3>
            <a href={link('catalog')}>查看全部</a>
          </header>
          {data.error ? (
            <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
          ) : (
            <div className="mengine-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>资料名称</th>
                    <th>所属空间</th>
                    <th>版本</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.value?.items.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <button onClick={() => open(x)}>{x.name}</button>
                      </td>
                      <td>{x.workspaceName}</td>
                      <td>v{x.version}</td>
                      <td>{new Date(x.updatedAt).toLocaleDateString('zh-CN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.value?.items.length === 0 && <p>暂无可访问资料</p>}
            </div>
          )}
        </section>
        <section className="mengine-panel">
          <header>
            <h3>空间动态</h3>
            <a href={link('materials', { section: 'files', scope: 'enterprise' })}>进入资料库</a>
          </header>
          {activity.error ? (
            <Failure error={activity.error} retry={() => refresh((n) => n + 1)} />
          ) : !activity.value ? (
            <Loading />
          ) : (
            <ol className="mengine-timeline">
              {activity.value.items.map((x) => (
                <li key={x.id}>
                  <strong>
                    {x.actorName} · {x.kind.includes('UPDATED') ? '更新了资料' : '发布了资料'}
                  </strong>
                  <p>
                    {x.filename} · v{x.version}
                  </p>
                  <small>
                    {x.workspaceName} · {new Date(x.occurredAt).toLocaleString('zh-CN')}
                  </small>
                </li>
              ))}
            </ol>
          )}
          {activity.value?.items.length === 0 && <p>暂无获权资料动态</p>}
          <small>仅显示当前可读资料的维护动态</small>
        </section>
      </div>
      {opened && (
        <OpenDocument
          tenant={tenant}
          item={opened}
          close={() => open(null)}
          changed={() => {
            open(null);
            refresh((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
