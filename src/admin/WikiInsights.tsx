import { useEffect, useState } from 'react';
import { useSession } from '../identity/session';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { Button, Modal } from '../shared/ui';
import { knowledgeClient } from '../material/knowledge-client';
import { Citation } from '../material/Knowledge';
import { wikiInsights as api } from './wiki-insights-client';
import { GraphVisual } from './WikiGraphs';
import type { InsightMode, InsightPoint, WikiInsight } from '../../contracts/public-api/wiki-insights';
const modes = { ANALYZE: '要点与综合分析', GRAPH: '原资料关系图', RECOMMEND: '关联资料推荐' };
const states: Record<string, string> = {
  QUEUED: '等待分析',
  RUNNING: '正在分析',
  WAITING_CAPABILITY: '等待模型服务',
  WAITING_INPUT: '等待补充',
  PAUSED: '已暂停',
  SUCCEEDED: '分析完成',
  FAILED: '分析失败',
  CANCELLED: '已取消',
  PARTIAL: '分析未完成',
  SOURCE_CHANGED: '来源已变化，请重新分析',
  RESULT_UNKNOWN: '结果待核对',
  INTERRUPTED: '已中断',
};
export function WikiInsights({ tenant, revision }: { tenant: string; revision: number }) {
  const { session } = useSession();
  const [attempt, retry] = useState(0);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<InsightMode>('ANALYZE');
  const [selected, select] = useState<{ materialId: string; versionId: string; generation: number }[]>([]);
  const [opened, open] = useState<string>();
  const data = useRemote(
    async (signal) => ({
      sources: await knowledgeClient.processing(tenant, null, '', 'ALL', page * 20, signal),
      insights: await api.list(tenant, 0, signal),
    }),
    [tenant, page, revision, attempt, session.identity],
  );
  const submit = useSubmission<{ mode: InsightMode; sources: typeof selected }>();
  useRequestLock(submit.busy || submit.uncertain);
  if (data.error) return <Failure error={data.error} retry={() => retry((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const sources = data.value.sources.items.filter((s) => ['READY', 'PARTIAL'].includes(s.status));
  const selection = selected.filter((s) =>
    sources.some(
      (x) => x.materialId === s.materialId && x.versionId === s.versionId && x.generation === s.generation,
    ),
  );
  return (
    <>
      <p className="wiki-notice">
        选择最多 6 份已解析原资料，生成带逐字引用的本人分析。综合分析和关系图每份覆盖前 10 个片段、最多 3,000
        字符；推荐每份只读首个片段、最多 1,000 字符，从最多 12
        份获权候选中研判。调用企业模型并计入用量，不修改来源。
      </p>
      <label>
        原资料分析方式{' '}
        <select value={mode} disabled={submit.busy} onChange={(e) => setMode(e.target.value as InsightMode)}>
          {Object.entries(modes).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {sources.map((s) => (
        <label className="wiki-match wiki-ack" key={s.materialId}>
          <input
            type="checkbox"
            checked={selection.some((x) => x.materialId === s.materialId)}
            disabled={
              submit.busy || (!selection.some((x) => x.materialId === s.materialId) && selection.length >= 6)
            }
            onChange={(e) =>
              select(
                e.target.checked
                  ? [
                      ...selection,
                      { materialId: s.materialId, versionId: s.versionId, generation: s.generation },
                    ]
                  : selection.filter((x) => x.materialId !== s.materialId),
              )
            }
          />
          <span>
            {s.name}
            <small>
              v{s.version} · 解析批次 {s.generation}
            </small>
          </span>
        </label>
      ))}
      {!sources.length && <p>本页暂无可分析资料，请先完成解析或翻页查看。</p>}
      <Pager
        page={page}
        next={data.value.sources.hasMore}
        onPage={(n) => {
          select([]);
          setPage(n);
        }}
      />
      <Button
        disabled={submit.busy || (!selection.length && !submit.uncertain)}
        onClick={() =>
          void submit.submit({ mode, sources: selection }, async (body, key) => {
            const result = await api.start(tenant, body.mode, body.sources, key);
            open(result.id);
            retry((n) => n + 1);
          })
        }
      >
        {submit.uncertain ? '重试本次资料分析' : '开始资料分析'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <h3>我的最近资料分析</h3>
      {data.value.insights.items.map((i) => (
        <button className="wiki-match" key={i.id} onClick={() => open(i.id)}>
          {modes[i.mode]} · {states[i.status]}
          <small>
            {i.documents
              .filter((d) => d.anchor)
              .map((d) => d.title)
              .join(' · ')}
          </small>
        </button>
      ))}
      {!data.value.insights.items.length && <p>暂无资料分析。</p>}
      {data.value.insights.hasMore && <p>显示最近 20 次，更早记录可在个人会话查看。</p>}
      {opened && (
        <InsightReader
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
function InsightReader({ tenant, id, close }: { tenant: string; id: string; close: () => void }) {
  const { session } = useSession();
  const [attempt, retry] = useState(0);
  const [citation, select] = useState<string>();
  const data = useRemote((signal) => api.detail(tenant, id, signal), [tenant, id, attempt, session.identity]);
  const busy = data.value && ['QUEUED', 'RUNNING'].includes(data.value.status);
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => retry((n) => n + 1), 3000);
      return () => clearTimeout(t);
    }
  }, [busy, attempt, data.value]);
  return (
    <Modal title="原资料分析 · 仅本人可见" wide onClose={close}>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {modes[data.value.mode]} · {states[data.value.status]}
            {data.value.executionClass === 'verification' ? ' · 模拟验证执行' : ''}
          </p>
          <Button onClick={() => retry((n) => n + 1)}>刷新资料分析</Button>
          <a
            href={`/workspace/#tenant=${tenant}&view=conversations&conversation=${data.value.conversationId}&task=${data.value.taskId}`}
          >
            查看原任务
          </a>
          {data.value.report && (
            <>
              <Report item={data.value} select={select} />
              {citation && (
                <Modal title="原文依据" wide onClose={() => select(undefined)}>
                  <Citation
                    tenant={tenant}
                    id={citation}
                    back={() => select(undefined)}
                    verification={attempt}
                    embedded
                  />
                </Modal>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
function Report({ item, select }: { item: WikiInsight; select: (id: string) => void }) {
  const report = item.report!;
  const title = (id: string) => item.documents.find((d) => d.id === id)?.title || '来源资料';
  const point = (p: InsightPoint) => (
    <>
      <p style={{ whiteSpace: 'pre-wrap' }}>{p.text}</p>
      {p.evidence.map((e, i) => (
        <blockquote key={i}>
          <p>
            {title(e.materialId)}：{e.quote}
          </p>
          <Button onClick={() => select(e.chunkId)}>核对引用原文</Button>
        </blockquote>
      ))}
    </>
  );
  return (
    <>
      <p className="wiki-notice">
        结论基于本次片段，引用证明来源，不代表模型判断已获业务确认。
        {item.mode === 'RECOMMEND' && `已研判 ${item.documents.filter((d) => !d.anchor).length} 份候选。`}
      </p>
      {report.nodes.map((n) => (
        <section className="wiki-notice" key={n.materialId}>
          <h3>{title(n.materialId)}</h3>
          {point(n.summary)}
          <h4>提炼要点</h4>
          {n.takeaways.map((p, i) => (
            <div key={i}>{point(p)}</div>
          ))}
        </section>
      ))}
      {report.synthesis && (
        <section className="wiki-notice">
          <h3>综合结论</h3>
          {point(report.synthesis)}
        </section>
      )}
      {item.mode !== 'RECOMMEND' && (
        <>
          <GraphVisual
            nodes={item.documents.map((d) => ({
              id: d.id,
              revision: d.version,
              title: d.title,
              content: '',
            }))}
            graph={{
              selected: item.documents.map((d) => d.id),
              relations: report.relations.map((r) => ({
                ...r,
                evidence: r.evidence.map((e) => ({ articleId: e.materialId, quote: e.quote })),
              })),
            }}
          />
          {!report.relations.length && <p>未发现充分依据支持的关联，保留独立节点。</p>}
          {report.relations.map((r, i) => (
            <section className="wiki-notice" key={i}>
              <h4>
                {title(r.from)} {['dependency', 'sequence'].includes(r.kind) ? '→' : '↔'} {title(r.to)}
              </h4>
              {point({ text: r.reason, evidence: r.evidence })}
            </section>
          ))}
        </>
      )}
      {item.mode === 'RECOMMEND' && (
        <>
          <h3>关联资料推荐</h3>
          {!report.recommendations.length && <p>本次候选中没有充分依据支持的推荐。</p>}
          {report.recommendations.map((r) => (
            <section className="wiki-notice" key={r.document}>
              <h4>
                {title(r.document)} · 关联 {title(r.anchor)}
              </h4>
              {point({ text: r.reason, evidence: r.evidence })}
            </section>
          ))}
        </>
      )}
    </>
  );
}
