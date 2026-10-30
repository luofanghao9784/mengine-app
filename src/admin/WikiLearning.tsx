import { PublishWikiDraft } from './WikiArticles';
import { useEffect, useState } from 'react';
import { useSession } from '../identity/session';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Button, Modal } from '../shared/ui';
import type { MaterialProcessingItem } from '../../contracts/public-api/knowledge';
import type { WikiDraft } from '../../contracts/public-api/wiki-learning';
import { Citation } from '../material/Knowledge';
import { wikiLearning as api } from './wiki-learning-client';
const labels: Record<WikiDraft['status'], string> = {
  QUEUED: '等待学习',
  RUNNING: '正在学习',
  WAITING_CAPABILITY: '等待模型服务',
  WAITING_INPUT: '等待补充',
  PAUSED: '已暂停',
  SUCCEEDED: '草稿待核对',
  FAILED: '学习未完成',
  CANCELLED: '已取消',
  PARTIAL: '学习未完成',
  SOURCE_CHANGED: '来源已变化，请重新学习',
  RESULT_UNKNOWN: '结果待核对，请查看原任务',
  INTERRUPTED: '学习已中断',
};
export function LearnSource({
  tenant,
  source,
  onCreated,
}: {
  tenant: string;
  source: MaterialProcessingItem;
  onCreated: (id: string) => void;
}) {
  const submit = useSubmission<{ versionId: string; generation: number }>();
  return (
    <section className="wiki-notice">
      <p>
        生成本人可见的学习草稿，核对后再决定如何使用。仅覆盖前 10 个解析片段、最多 6,000
        字符；调用当前企业模型并计入用量。
      </p>
      <Button
        disabled={submit.busy || !['READY', 'PARTIAL'].includes(source.status)}
        onClick={() =>
          void submit.submit(
            { versionId: source.versionId, generation: source.generation },
            async (body, requestId) => {
              const result = await api.start(tenant, source.materialId, { ...body, requestId });
              onCreated(result.id);
            },
          )
        }
      >
        {submit.uncertain ? '重试本次学习请求' : '生成学习草稿'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </section>
  );
}
export function WikiDrafts({
  tenant,
  revision,
  select,
}: {
  tenant: string;
  revision: number;
  select: (id: string) => void;
}) {
  const { session } = useSession();
  const [page, setPage] = useState(0);
  const [attempt, retry] = useState(0);
  const data = useRemote(
    (signal) => api.list(tenant, page * 20, signal),
    [tenant, revision, page, attempt, session.identity],
  );
  const busy = data.value?.items.some((x) => ['QUEUED', 'RUNNING'].includes(x.status));
  useEffect(() => {
    if (busy) {
      const timer = setTimeout(() => retry((n) => n + 1), 4000);
      return () => clearTimeout(timer);
    }
  }, [busy, attempt, data.value]);
  if (data.error) return <Failure error={data.error} retry={() => retry((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  return (
    <>
      <p className="wiki-notice">
        仅本人发起的学习草稿，尚未发布为企业共享知识。来源更新或撤权后不继续展示旧内容。
      </p>
      {data.value.items.map((item) => (
        <button className="wiki-match" key={item.id} onClick={() => select(item.id)}>
          <strong>{item.article?.title || item.sourceName}</strong>
          <small>
            {item.sourceName} · v{item.sourceVersion} · {labels[item.status]}
          </small>
          {item.executionClass === 'verification' && <span>模拟验证执行</span>}
        </button>
      ))}
      {!data.value.items.length && (
        <p className="wiki-empty">暂无学习草稿，从资料来源选择一份已解析资料开始。</p>
      )}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
export function WikiDraftReader({ tenant, id, close }: { tenant: string; id: string; close: () => void }) {
  const { session } = useSession();
  const [attempt, retry] = useState(0);
  const [citation, select] = useState<string>();
  const data = useRemote((signal) => api.detail(tenant, id, signal), [tenant, id, attempt, session.identity]);
  const busy = data.value && ['QUEUED', 'RUNNING'].includes(data.value.status);
  useEffect(() => {
    if (busy) {
      const timer = setTimeout(() => retry((n) => n + 1), 3000);
      return () => clearTimeout(timer);
    }
  }, [busy, attempt, data.value]);
  return (
    <Modal title="学习草稿 · 仅本人可见" wide onClose={close}>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {data.value.sourceName} · v{data.value.sourceVersion} · {labels[data.value.status]}
          </p>
          <Button onClick={() => retry((n) => n + 1)}>刷新学习状态</Button>
          <a
            className="button"
            href={`/workspace/#tenant=${tenant}&view=conversations&conversation=${data.value.conversationId}&task=${data.value.taskId}`}
          >
            查看原任务
          </a>
          {data.value.article && (
            <article className="wiki-article">
              <h2>{data.value.article.title}</h2>
              <p>{data.value.article.intro}</p>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.value.article.content}</div>
              <h3>原文依据</h3>
              {data.value.article.evidence.map((e, i) => (
                <blockquote key={i}>
                  <p>{e.quote}</p>
                  <Button onClick={() => select(e.chunkId)}>核对原文 {i + 1}</Button>
                </blockquote>
              ))}
              <p className="muted">
                {data.value.executionClass === 'verification' ? '模拟验证草稿' : 'AI 生成，待人工核对'} ·{' '}
                {data.value.modelName} · 仅覆盖前 10 个解析片段、最多 6,000 字符
              </p>
            </article>
          )}
          {data.value.article && (
            <PublishWikiDraft key={data.value.id + ':' + attempt} tenant={tenant} draft={data.value} />
          )}
          {!busy && !data.value.article && (
            <p>
              可在资料来源重新发起学习；等待中的任务不会重复创建。任务暂停、取消等操作沿现有客户端会话处理。
            </p>
          )}
          {citation && data.value.article && (
            <Citation
              key={citation}
              tenant={tenant}
              id={citation}
              back={() => select(undefined)}
              verification={attempt}
            />
          )}
        </>
      )}
    </Modal>
  );
}
