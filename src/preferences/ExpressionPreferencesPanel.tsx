import { useContext, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Failure, Loading, Pager, useRemote, useSubmission, SubmitError, FormActions } from '../shared/admin';
import { useRequestLock, RequestPending } from '../shared/request-guard';
import { Badge, Button, Modal, Field } from '../shared/ui';
import { preferenceClient, ruleBookClient, type RuleBook, type PreferenceScope } from './client';
import './preferences.css';
const labels = { ALL: '通用表达', BRIEFING: '画报表达', TOPICS: '画报选题' };
const sources = { GLOBAL: '总台', TENANT: '企业', PERSONAL: '个人' };
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
  const [tab, setTab] = useState<'expression' | 'topics' | 'records'>('expression');
  const pending = useContext(RequestPending);
  const writer = useMemo(() => ruleBookClient(scope, tenant), [scope, tenant]);
  const books = useRemote((signal) => writer.read(signal), [writer, refresh]);
  const [editing, setEditing] = useState<RuleBook | null>(null);
  const changed = () => {
    setEditing(null);
    setPage(0);
    setRefresh((n) => n + 1);
  };
  const data = useRemote((signal) => client.records(page * 20, signal), [client, page, refresh]);
  return (
    <section className="admin-section expression-preferences" aria-label="AI内容偏好规则">
      <header className="expression-rules-heading">
        <div>
          <h2>AI内容偏好</h2>
          <p className="muted">
            {scope === 'GLOBAL'
              ? '总部维护的默认内容规则'
              : scope === 'TENANT'
                ? '本企业维护的内容规则'
                : '本人在当前企业的内容偏好'}
            {tab === 'records' ? '，按时间查看每次记录。' : '。'}
          </p>
        </div>
        <Button variant="ghost" icon={RefreshCw} disabled={pending} onClick={() => setRefresh((n) => n + 1)}>
          刷新
        </Button>
      </header>
      <div className="data-ops-tabs" role="tablist" aria-label="AI内容偏好板块">
        {(
          [
            ['expression', '内容表达'],
            ['topics', '画报选题'],
            ['records', '规则记录'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
            disabled={pending}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== 'records' &&
        (books.error ? (
          <Failure error={books.error} retry={() => setRefresh((n) => n + 1)} />
        ) : (
          books.value?.canMaintain && (
            <div className="expression-book-actions">
              {books.value.books
                .filter((book) => (tab === 'topics' ? book.target === 'TOPICS' : book.target !== 'TOPICS'))
                .map((book) => (
                  <Button key={book.target} disabled={pending} onClick={() => setEditing(book)}>
                    录入或修订{labels[book.target]}规则
                  </Button>
                ))}
            </div>
          )
        ))}
      {tab !== 'records' && books.value && (
        <div className="expression-effective-rules">
          <h3>当前采用的规则</h3>
          {books.value.effectiveRules
            .filter((r) => (tab === 'topics' ? r.target === 'TOPICS' : r.target !== 'TOPICS'))
            .map((r) => (
              <div key={r.source + r.target} className="expression-effective-rule">
                <span>
                  {sources[r.source]} · {labels[r.target]} · 版本 {r.revision}
                </span>
                <p className="expression-rule-body">{r.body}</p>
              </div>
            ))}
          {!books.value.effectiveRules.some((r) =>
            tab === 'topics' ? r.target === 'TOPICS' : r.target !== 'TOPICS',
          ) && <p className="muted">当前继承系统默认规则。</p>}
          {tab === 'topics' && (
            <p className="muted">
              可写关注主题、分析方向、成果倾向及减少出现的内容。有依据才生成，不按类型凑卡。
            </p>
          )}
        </div>
      )}
      {editing && (
        <RuleEditor book={editing} writer={writer} close={() => setEditing(null)} changed={changed} />
      )}
      {tab === 'records' &&
        (data.error ? (
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
              “当前采用”表示已接入生成默认表达；“已记录”仅表示保存了规则。文字规则只调整后续内容；同一表达问题按个人、企业、总部依次优先，当前明确要求最高。事实、权限和证据要求始终保留。
            </p>
          </>
        ))}
    </section>
  );
}

function RuleEditor({
  book,
  writer,
  close,
  changed,
}: {
  book: RuleBook;
  writer: ReturnType<typeof ruleBookClient>;
  close: () => void;
  changed: () => void;
}) {
  const [body, setBody] = useState(book.body);
  const submission = useSubmission<{ target: RuleBook['target']; body: string; expectedRevision: number }>();
  const locked = submission.busy || submission.uncertain;
  useRequestLock(locked);
  return (
    <Modal
      title={labels[book.target] + '规则'}
      onClose={() => {
        if (!locked) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submission.submit(
            { target: book.target, body, expectedRevision: book.revision },
            async (payload, id) => {
              await writer.save(payload, id);
              changed();
            },
          );
        }}
      >
        <p className="muted">
          直接写希望采用的表达规则，每行一条。修订会保留历史；清空并保存表示撤回本层规则，继续采用其他层的规则。已有画报不会重写。
        </p>
        <Field label="规则正文">
          <textarea
            aria-label="规则正文"
            rows={12}
            maxLength={4000}
            value={body}
            disabled={locked}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <p className="muted">
          {body.length} / 4000 字 · 当前版本 {book.revision}
        </p>
        <SubmitError error={submission.error} uncertain={submission.uncertain} />
        <FormActions>
          <Button type="button" disabled={locked} onClick={close}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submission.busy || (!submission.uncertain && body === book.body)}
          >
            {submission.busy ? '保存中…' : submission.uncertain ? '核对并重试' : '保存规则'}
          </Button>
        </FormActions>
      </form>
    </Modal>
  );
}
