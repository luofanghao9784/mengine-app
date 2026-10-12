import { useState } from 'react';
import { History, RefreshCw, Search } from 'lucide-react';
import { Button, Empty } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { tenantClient } from './client';
import { auditActions } from './audit-labels';
import './audit.css';

export function TenantAudit({ tenant }: { tenant: string }) {
  const [draft, setDraft] = useState({ q: '', category: '', from: '', to: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => tenantClient.records(tenant, page * 20, signal, filters),
    [tenant, page, filters, attempt],
  );
  return (
    <section className="admin-section tenant-audit">
      <div className="admin-section-heading">
        <div>
          <h2>企业操作记录</h2>
          <p className="admin-note">成员、空间、数据接入与企业设置的成功管理操作。按企业独立记录。</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新记录
        </Button>
      </div>
      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const from = draft.from ? new Date(draft.from).toISOString() : '';
          const to = draft.to ? new Date(draft.to).toISOString() : '';
          if (from && to && from >= to) {
            setError('结束时间须晚于开始时间。');
            return;
          }
          setError('');
          setPage(0);
          setFilters({ ...draft, q: draft.q.trim(), from, to });
        }}
      >
        <label>
          搜索记录
          <input
            aria-label="搜索审计记录"
            placeholder="操作人、对象或事件代码"
            maxLength={160}
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          />
        </label>
        <label>
          事件类别
          <select
            aria-label="事件类别"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            {[
              ['', '全部类别'],
              ['IDENTITY', '成员与职责'],
              ['SPACE', '共享空间'],
              ['DATA', '数据接入与清理'],
              ['COMPANY', '企业信息'],
              ['EXPERIENCE', '经验使用'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始时间
          <input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          结束时间（不含）
          <input
            type="datetime-local"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <Button type="submit" icon={Search}>
          筛选
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const empty = { q: '', category: '', from: '', to: '' };
            setDraft(empty);
            setFilters(empty);
            setPage(0);
            setError('');
          }}
        >
          重置
        </Button>
      </form>
      <p className="admin-note">
        时间按当前设备时区选择。资料内容与详细权限变更请在对应对象的审计记录中查看。
      </p>
      {error && <p role="alert">{error}</p>}
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.length ? (
        <Empty icon={History} title="暂无匹配的操作记录" text="可调整筛选条件，或等待新的管理操作。" />
      ) : (
        <>
          <div className="audit-table-scroll" tabIndex={0} aria-label="企业审计记录表格">
            <table>
              <thead>
                <tr>
                  <th>操作人</th>
                  <th>事件</th>
                  <th>操作对象</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.value.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>{r.actorName}</td>
                    <td>
                      <strong>{auditActions[r.action] || r.action}</strong>
                      <small>{r.action}</small>
                    </td>
                    <td>
                      {r.targetName || '对象标识：' + r.targetId}
                      {r.relatedAccountName && <small>关联成员：{r.relatedAccountName}</small>}
                    </td>
                    <td>
                      <time dateTime={r.createdAt}>
                        {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      )}
    </section>
  );
}
