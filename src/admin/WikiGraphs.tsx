import { useRequestLock } from '../shared/request-guard';
import { useEffect, useState, useId } from 'react';
import { useSession } from '../identity/session';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Button, Modal } from '../shared/ui';
import { wikiArticles } from './wiki-articles-client';
import { wikiGraphs as api } from './wiki-graphs-client';
import type { WikiGraph, WikiGraphNode } from '../../contracts/public-api/wiki-graphs';
import { ArticleReader } from './WikiArticles';
const labels: Record<WikiGraph['status'], string> = {
  QUEUED: '等待分析',
  RUNNING: '正在分析',
  WAITING_CAPABILITY: '等待模型能力',
  WAITING_INPUT: '等待补充',
  PAUSED: '已暂停',
  SUCCEEDED: '关系分析完成',
  FAILED: '分析未完成',
  CANCELLED: '已取消',
  PARTIAL: '分析未完成',
  SOURCE_CHANGED: '知识或来源已变化，请重新分析',
  RESULT_UNKNOWN: '结果待核对，请查看原任务',
  INTERRUPTED: '分析已中断',
};
const kinds = {
  topic: '共同主题',
  complement: '互为补充',
  dependency: '前置依赖（推断）',
  sequence: '流程衔接（推断）',
};
export function WikiGraphs({ tenant, revision }: { tenant: string; revision: number }) {
  const { session } = useSession();
  const [attempt, retry] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, select] = useState<{ articleId: string; revision: number }[]>([]);
  const [opened, open] = useState<string>();
  const data = useRemote(
    async (signal) => ({
      articles: await wikiArticles.list(tenant, false, page * 20, signal),
      graphs: await api.list(tenant, 0, signal),
    }),
    [tenant, revision, attempt, page, session.identity],
  );
  const submit = useSubmission<typeof selected>();
  const automatic = useSubmission<null>();
  useRequestLock(submit.busy || submit.uncertain || automatic.busy || automatic.uncertain);
  if (data.error) return <Failure error={data.error} retry={() => retry((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const candidates = data.value.articles.items.filter((a) => !a.sourceChanged && a.article);
  const selection = selected.filter((s) =>
    candidates.some((a) => a.id === s.articleId && a.revision === s.revision),
  );
  return (
    <>
      <Button
        disabled={automatic.busy || submit.busy}
        onClick={() =>
          void automatic.submit(null, async (_, key) => {
            const result = await api.automatic(tenant, key);
            open(result.id);
            retry((n) => n + 1);
          })
        }
      >
        {automatic.uncertain ? '重试本次自动推荐' : '自动推荐知识星图'}
      </Button>
      <SubmitError error={automatic.error} uncertain={automatic.uncertain} />
      <p>
        自动模式按最近更新筛选最多 12 篇当前可读且有效的已发布知识，由模型推荐最多 6
        个节点；不代表已分析全库。
      </p>
      <p className="wiki-notice">
        选择 1—3
        篇已发布知识，推荐共同阅读的节点并分析关系。仅本人可见，调用企业模型并计入用量；不会修改来源或自动发布。分析仅覆盖所选知识正文，不代表全库。
      </p>
      {candidates.map((a) => (
        <label className="wiki-match wiki-ack" key={a.id}>
          <input
            type="checkbox"
            checked={selection.some((s) => s.articleId === a.id)}
            disabled={submit.busy || (!selection.some((s) => s.articleId === a.id) && selection.length >= 3)}
            onChange={(e) =>
              select(
                e.target.checked
                  ? [...selection, { articleId: a.id, revision: a.revision }]
                  : selection.filter((s) => s.articleId !== a.id),
              )
            }
          />
          <span>
            {a.article!.title}
            <small>
              修订 {a.revision} · {a.sourceName}
            </small>
          </span>
        </label>
      ))}
      {!candidates.length && <p>本页暂无可分析的有效共享知识，请先发布知识或翻页查看。</p>}
      <Pager
        page={page}
        next={data.value.articles.hasMore}
        onPage={(n) => {
          select([]);
          setPage(n);
        }}
      />
      <Button
        disabled={submit.busy || (!selection.length && !submit.uncertain)}
        onClick={() =>
          void submit.submit(selection, async (body, key) => {
            const result = await api.start(tenant, body, key);
            open(result.id);
            retry((n) => n + 1);
          })
        }
      >
        {submit.uncertain ? '重试本次分析请求' : '分析关系与推荐'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <h3>我的最近分析</h3>
      {data.value.graphs.items.map((g) => (
        <button className="wiki-match" key={g.id} onClick={() => open(g.id)}>
          {labels[g.status]}
          <small>{g.documents.map((d) => d.title).join(' · ')}</small>
        </button>
      ))}
      {!data.value.graphs.items.length && <p>暂无关系分析。</p>}
      {data.value.graphs.hasMore && <p>这里只显示最近 20 次分析；更早的任务可在个人会话查看。</p>}
      {opened && (
        <GraphReader
          key={opened}
          tenant={tenant}
          id={opened}
          close={() => {
            open(undefined);
            retry((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
function GraphReader({ tenant, id, close }: { tenant: string; id: string; close: () => void }) {
  const { session } = useSession();
  const [attempt, retry] = useState(0);
  const [article, openArticle] = useState<string>();
  const data = useRemote((signal) => api.detail(tenant, id, signal), [tenant, id, attempt, session.identity]);
  const busy = data.value && ['QUEUED', 'RUNNING'].includes(data.value.status);
  useEffect(() => {
    if (busy) {
      const timer = setTimeout(() => retry((n) => n + 1), 3000);
      return () => clearTimeout(timer);
    }
  }, [busy, attempt, data.value]);
  return (
    <Modal title="知识关系 · 仅本人可见" wide onClose={close}>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {labels[data.value.status]}
            {data.value.executionClass === 'verification' ? ' · 模拟验证执行' : ''}
          </p>
          <Button onClick={() => retry((n) => n + 1)}>刷新分析状态</Button>
          <a
            href={`/workspace/#tenant=${tenant}&view=conversations&conversation=${data.value.conversationId}&task=${data.value.taskId}`}
          >
            查看原任务
          </a>
          {data.value.graph && (
            <>
              <p className="wiki-notice">
                以下为模型基于知识正文的分析判断，关系不等同于已验证的业务依赖。引用是知识正文依据，可打开知识继续核对原件。
              </p>
              <GraphVisual
                nodes={data.value.documents.filter((d) => data.value!.graph!.selected.includes(d.id))}
                graph={data.value.graph}
              />
              <h3>推荐共同阅读</h3>
              {data.value.graph.selected.map((node) => (
                <Button key={node} onClick={() => openArticle(node)}>
                  {data.value!.documents.find((d) => d.id === node)!.title}
                </Button>
              ))}
              {!data.value.graph.relations.length && <p>未发现充分依据支持的关联，保留独立知识节点。</p>}
              {data.value.graph.relations.map((r, i) => (
                <section className="wiki-notice" key={i}>
                  <strong>
                    {data.value!.documents.find((d) => d.id === r.from)!.title}{' '}
                    {['dependency', 'sequence'].includes(r.kind) ? '→' : '↔'}{' '}
                    {data.value!.documents.find((d) => d.id === r.to)!.title} · {kinds[r.kind]}
                  </strong>
                  <p>{r.reason}</p>
                  {r.evidence.map((e, j) => (
                    <blockquote key={j}>
                      <p>{e.quote}</p>
                      <Button onClick={() => openArticle(e.articleId)}>打开依据知识</Button>
                    </blockquote>
                  ))}
                </section>
              ))}
              {article && <ArticleReader tenant={tenant} id={article} close={() => openArticle(undefined)} />}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
export function GraphVisual({
  nodes,
  graph,
}: {
  nodes: WikiGraphNode[];
  graph: NonNullable<WikiGraph['graph']>;
}) {
  const arrowId = useId();
  const point = (id: string) => {
    const i = nodes.findIndex((n) => n.id === id);
    if (nodes.length === 1) return { x: 300, y: 115 };
    if (nodes.length === 2) return { x: 150 + i * 300, y: 115 };
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
    return { x: 300 + 210 * Math.cos(angle), y: 120 + 80 * Math.sin(angle) };
  };
  return (
    <svg
      className="wiki-graph"
      viewBox="0 0 600 250"
      role="img"
      aria-label={`知识关系图，${nodes.length} 个节点，${graph.relations.length} 条关系；详情见下方文字`}
    >
      <defs>
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
        </marker>
      </defs>
      {graph.relations.map((r, i) => {
        const a = point(r.from),
          b = point(r.to);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x-(b.x-a.x)*28/Math.hypot(b.x-a.x,b.y-a.y)} y2={b.y-(b.y-a.y)*28/Math.hypot(b.x-a.x,b.y-a.y)} markerEnd={['dependency','sequence'].includes(r.kind)?`url(#${arrowId})`:undefined} stroke="currentColor" strokeWidth="2" />;
      })}
      {nodes.map((n, i) => {
        const p = point(n.id);
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r="25" fill="#eef2ff" stroke="#6366f1" />
            <text x={p.x} y={p.y + 5} textAnchor="middle" fill="#312e81">
              {i + 1}
            </text>
            <text x={p.x} y={p.y + 44} textAnchor="middle" fill="currentColor">
              {n.title.length > 14 ? n.title.slice(0, 14) + '…' : n.title}
            </text>
            <title>{n.title}</title>
          </g>
        );
      })}
    </svg>
  );
}
