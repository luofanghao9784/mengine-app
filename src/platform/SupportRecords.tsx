import { useState } from 'react';
import { createIdentityRequest, record, text } from '../identity/client';
import { useRemote, Loading, Failure } from '../shared/admin';
import { Button, Modal } from '../shared/ui';
const request = createIdentityRequest();
type Records = {
  events: { id: number; action: string; outcome: string; created_at: string }[];
  changes: { table_name: string; object_id: string; operation: string; created_at: string }[];
};
const valid = (v: unknown): v is Records =>
  record(v) &&
  Array.isArray(v.events) &&
  Array.isArray(v.changes) &&
  v.events.every((e) => record(e) && text(e.action) && text(e.outcome) && text(e.created_at)) &&
  v.changes.every(
    (e) => record(e) && text(e.table_name) && text(e.object_id) && text(e.operation) && text(e.created_at),
  );
const actionLabel = (action: string) => {
  const special: Record<string, string> = {
    ENTER: '进入企业管理端',
    LEAVE: '返回总台',
    INVALIDATED: '访问失效',
  };
  if (special[action]) return special[action];
  const [method, path = ''] = action.split(' ');
  const families: Record<string, string> = {
    governance: '管理职责',
    folders: '资料目录',
    materials: '资料',
    context: '空间范围',
    library: '资料列表',
    database: '数据库',
    workspaces: '共享空间',
    members: '企业成员',
    overview: '企业概览',
    usage: '用量',
    records: '管理记录',
    'engine-telemetry': '运行状态',
    'company-information': '企业信息',
    'experience-library': '经验库',
  };
  const family = path
    .split('/')
    .filter((part) => part in families)
    .at(-1);
  return `${method === 'GET' ? '查看' : method === 'DELETE' ? '删除' : '调整'}${family ? families[family] : '企业配置'}`;
};
const objectLabel: Record<string, string> = {
  material_folders: '资料目录',
  materials: '资料',
  material_versions: '资料版本',
  knowledge_runs: '资料处理',
  knowledge_chunks: '解析内容',
  tenant_memberships: '成员职责',
  workspace_members: '空间授权',
  workspaces: '共享空间',
  company_information_tags: '企业信息',
  profile_versions: '档案版本',
  collection_runs: '取数执行',
  data_connections: '数据接入',
  experience_analysis_runs: '经验核验',
  experience_intake_sources: '经验来源',
};
export function SupportRecords({ id, test }: { id: string; test: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        本次操作记录
      </Button>
      {open && <RecordsModal id={id} test={test} close={() => setOpen(false)} />}
    </>
  );
}
function RecordsModal({ id, test, close }: { id: string; test: boolean; close: () => void }) {
  const [page, setPage] = useState(0),
    [attempt, retry] = useState(0);
  const data = useRemote(
    (signal) =>
      request(
        `/api/platform-admin/v1/support-access/${id}/records?offset=${page * 50}`,
        'GET',
        valid,
        undefined,
        signal,
      ),
    [id, page, attempt],
  );
  return (
    <Modal title={test ? '总部测试记录' : '总部调整记录'} onClose={close} wide>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            记录保留总部真实操作者、企业范围、结果及变更状态；测试对象可按以下编号追溯。
          </p>
          <table className="support-record-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>结果</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.value.events.map((e) => (
                <tr key={e.id}>
                  <td>{actionLabel(e.action)}</td>
                  <td>{{ SUCCESS: '成功', DENIED: '拒绝', FAILURE: '失败' }[e.outcome] || e.outcome}</td>
                  <td>{new Date(e.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{test ? '测试数据与执行' : '变更对象'}</h3>
          {data.value.changes.length ? (
            <table className="support-record-table">
              <thead>
                <tr>
                  <th>对象类型</th>
                  <th>编号</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                {data.value.changes.map((c, i) => (
                  <tr key={i}>
                    <td>{objectLabel[c.table_name] || '企业配置'}</td>
                    <td>
                      <code>{c.object_id}</code>
                    </td>
                    <td>
                      {{ INSERT: '创建', UPDATE: '更新', DELETE: '删除' }[c.operation] || c.operation}
                      {test && ' · 测试'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">暂无变更。</p>
          )}
          <div className="support-record-pagination">
            <Button variant="ghost" disabled={!page} onClick={() => setPage((n) => n - 1)}>
              上一页
            </Button>
            <span>第 {page + 1} 页</span>
            <Button
              variant="ghost"
              disabled={data.value.events.length < 50 && data.value.changes.length < 50}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
