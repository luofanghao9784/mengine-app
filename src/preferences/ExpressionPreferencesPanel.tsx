import { useContext, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { RequestPending } from '../shared/request-guard';
import { Badge, Button } from '../shared/ui';
import { preferenceClient, type PreferenceScope } from './client';
import './preferences.css';
const states: Record<string, string> = {
  EFFECTIVE: '当前采用',
  SUPERSEDED: '已被更新',
  WITHDRAWN: '已撤回',
  EXPIRED: '已到期',
  UNAVAILABLE: '内容不可用',
  RECORDED: '已记录',
};
const when = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });
export function ExpressionPreferencesPanel({ scope, tenant }: { scope: PreferenceScope; tenant?: string }) {
  const client = useMemo(() => preferenceClient(scope, tenant), [scope, tenant]);
  const [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0);
  const pending = useContext(RequestPending);
  const data = useRemote((signal) => client.records(page * 20, signal), [client, page, refresh]);
  return (
    <section className="admin-section expression-preferences" aria-label="AI内容偏好规则">
      <header className="expression-rules-heading">
        <div>
          <h2>AI内容偏好</h2>
          <p className="muted">
            {scope === 'GLOBAL'
              ? '总部录入的全局表达规则'
              : scope === 'TENANT'
                ? '本企业录入与收录的表达规则'
                : '本人在当前企业录入与收录的表达规则'}
            ，按时间查看每次记录。
          </p>
        </div>
        <Button variant="ghost" icon={RefreshCw} disabled={pending} onClick={() => setRefresh((n) => n + 1)}>
          刷新
        </Button>
      </header>
      {data.error ? (
        <Failure error={data.error} retry={() => setRefresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {!data.value.items.length ? (
            <div className="expression-rules-empty">
              <strong>暂无偏好规则记录</strong>
              <p className="muted">后续录入或明确收录的偏好将在这里显示，历史更新与撤回记录一并保留。</p>
            </div>
          ) : (
            <ol className="expression-rule-list">
              {data.value.items.map((item) => (
                <li key={item.id}>
                  <div className="expression-rule-meta">
                    <span>
                      {item.origin === 'CONVERSATION' ? '会话收录' : '手动录入'} · 版本 {item.revision}
                    </span>
                    <time dateTime={item.recordedAt}>{when(item.recordedAt)}</time>
                    <Badge>{states[item.state]}</Badge>
                  </div>
                  <p className="expression-rule-body">
                    {item.rule ?? '该版本内容已不可用，仅保留记录信息。'}
                  </p>
                  {item.provenance && <p className="expression-rule-source">来源：{item.provenance}</p>}
                </li>
              ))}
            </ol>
          )}
          {(page > 0 || data.value.hasMore) && (
            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          )}
          <p className="expression-rule-note muted">
            “当前采用”表示已接入生成默认表达；“已记录”仅表示保存了规则。个人、企业与总部按各自范围生效，当前明确要求优先。
          </p>
        </>
      )}
    </section>
  );
}
