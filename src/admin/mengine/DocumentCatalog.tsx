import { useState } from 'react';
import { governanceApi } from '../../material/governance-client';
import { Failure, Loading, Pager, useRemote } from '../../shared/admin';
import { OpenDocument } from '../KnowledgeWorkbench';
import type { WorkbenchItem } from '../../../contracts/public-api/knowledge-workbench';
import { adminHref } from '../navigation';
import './mengine.css';
export function DocumentCatalog({ tenant, hash }: { tenant: string; hash: string }) {
  const [query, search] = useState(''),
    [draft, edit] = useState(''),
    [queue, filter] = useState('all'),
    [page, paginate] = useState(0),
    [revision, refresh] = useState(0),
    [opened, open] = useState<Pick<WorkbenchItem, 'id' | 'workspaceId'> | null>(null);
  const data = useRemote(
    (signal) => governanceApi.list(tenant, query, queue, 'all', 'updated', page * 20, signal),
    [tenant, query, queue, page, revision],
  );
  return (
    <div className="mengine-dashboard">
      <header className="mengine-heading">
        <div>
          <small>KNOWLEDGE ASSETS</small>
          <h2>企业资料列表</h2>
          <p>在同一张表中查看资料、标签、质量与复核日期。</p>
        </div>
        <a
          className="button primary"
          href={adminHref('tenant', 'materials', hash, { section: 'files', scope: 'enterprise' })}
        >
          导入资料 / 文件目录
        </a>
      </header>
      <section className="mengine-panel">
        <form
          className="mengine-filters"
          onSubmit={(e) => {
            e.preventDefault();
            search(draft.trim());
            paginate(0);
          }}
        >
          <input
            aria-label="搜索企业资料"
            placeholder="搜索资料名称"
            maxLength={180}
            value={draft}
            onChange={(e) => edit(e.target.value)}
          />
          <button>搜索</button>
          <select
            aria-label="资料治理状态"
            value={queue}
            onChange={(e) => {
              filter(e.target.value);
              paginate(0);
            }}
          >
            <option value="all">全部资料</option>
            <option value="attention">需要关注</option>
            <option value="sensitive">敏感信息</option>
            <option value="unchecked">尚未检查</option>
            <option value="healthy">规则无异常</option>
          </select>
          <button type="button" onClick={() => refresh((n) => n + 1)}>
            刷新资料列表
          </button>
          <a href={adminHref('tenant', 'governance', hash)}>进入数据治理</a>
        </form>
        {data.error ? (
          <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <p>当前获权范围 · {data.value.filteredTotal} 份资料</p>
            <div className="mengine-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>资料</th>
                    <th>所属空间</th>
                    <th>上传人</th>
                    <th>业务标签</th>
                    <th>质量</th>
                    <th>复核日期</th>
                    <th>版本</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.value.items.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <strong>{x.name}</strong>
                        <small>{x.canEdit ? '可维护' : '只读'}</small>
                      </td>
                      <td>{x.workspaceName}</td>
                      <td>{x.uploadedByName || '未记录'}</td>
                      <td>{x.tags.join(' · ') || '未填写'}</td>
                      <td>
                        {x.quality === null ? '尚未检查' : `${x.quality} / 100`}
                        <small>{x.issues.length ? `${x.issues.length} 项需关注` : ''}</small>
                      </td>
                      <td>{x.reviewAt || '未设置'}</td>
                      <td>v{x.version}</td>
                      <td>
                        <button onClick={() => open({ id: x.id, workspaceId: x.workspaceId })}>
                          阅读资料
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.value.items.length && <p>暂无匹配资料</p>}
            <Pager page={page} next={data.value.hasMore} onPage={paginate} />
          </>
        )}
      </section>
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
