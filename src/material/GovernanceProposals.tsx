import { useRequestLock, requestNavigationLocked } from '../shared/request-guard';
import { useEffect, useState } from 'react';
import { useSession } from '../identity/session';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Button, Field, Modal } from '../shared/ui';
import { Citation } from './Knowledge';
import { proposals as api } from './proposals-client';
import { wikiLearning } from '../admin/wiki-learning-client';
import type {
  GovernanceProposalCreate,
  GovernancePreparation,
} from '../../contracts/public-api/governance-proposals';
export function GovernanceProposals({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(0);
  const [revision, refresh] = useState(0);
  const [selected, select] = useState<string>();
  const data = useRemote(
    (signal) => api.list(tenant, status, page * 20, signal),
    [tenant, status, page, revision, session.identity],
  );
  return (
    <section className="mg-page">
      <header className="mg-heading">
        <div>
          <h2>业务提案</h2>
          <p>核对标签与摘要建议，由来源资料当前维护者确认。不会调整资料权限。</p>
        </div>
        <Button onClick={() => refresh((n) => n + 1)}>刷新提案</Button>
      </header>
      <label>
        提案状态{' '}
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          {[
            ['PENDING', '待确认'],
            ['APPLIED', '已采用'],
            ['REJECTED', '已拒绝'],
            ['ALL', '全部'],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>仅展示本人当前可以维护的来源资料提案。</p>
          {data.value.items.map((p) => (
            <button className="wiki-match" key={p.id} onClick={() => select(p.id)}>
              <strong>
                {p.sourceName} · {p.kind === 'TAGS' ? '标签整理' : '摘要建议'}
              </strong>
              <small>
                {p.stale
                  ? '来源或维护记录已变化'
                  : p.status === 'PENDING'
                    ? '待确认'
                    : p.status === 'APPLIED'
                      ? '已采用'
                      : '已拒绝'}
              </small>
            </button>
          ))}
          {!data.value.items.length && <p>暂无符合条件的业务提案。可从资料治理诊断中的治理助手创建。</p>}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
        </>
      )}
      {selected && (
        <ProposalReader
          key={selected}
          tenant={tenant}
          id={selected}
          close={() => {
            select(undefined);
            refresh((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
function ProposalReader({ tenant, id, close }: { tenant: string; id: string; close: () => void }) {
  const { session } = useSession();
  const [revision, refresh] = useState(0);
  const [citation, select] = useState<string>();
  const submit = useSubmission<'APPROVE' | 'REJECT'>();
  useRequestLock(submit.busy || submit.uncertain);
  const data = useRemote(
    (signal) =>
      api
        .detail(tenant, id, signal)
        .then(async (p) => ({ ...p, current: await api.prepare(tenant, p.materialId, signal) })),
    [tenant, id, revision, session.identity],
  );
  return (
    <Modal
      title="业务提案核对"
      wide
      onClose={() => {
        if (!requestNavigationLocked()) close();
      }}
    >
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <h3>{data.value.sourceName}</h3>
          <p>{data.value.stale ? '来源或维护记录已变化，旧建议已隐藏。' : data.value.reason}</p>
          {data.value.patch && (
            <>
              <p>
                当前值：
                {data.value.kind === 'TAGS'
                  ? data.value.current.tags.join('、') || '未填写'
                  : data.value.current.summary || '未填写'}
              </p>
              <h4>建议采用</h4>
              {data.value.patch.executionClass === 'verification' && <p>模拟验证生成，需核对真实资料。</p>}
              <p>{data.value.patch.tags?.join('、')}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.value.patch.summary}</p>
              {data.value.patch.evidence.map((e, i) => (
                <blockquote key={i}>
                  {e.quote}
                  <Button onClick={() => select(e.chunkId)}>核对原文依据</Button>
                </blockquote>
              ))}
            </>
          )}
          <p>
            提交人：{data.value.actorId} · {data.value.createdAt}
          </p>
          {data.value.resolvedBy && (
            <p>
              处理人：{data.value.resolvedBy} · {data.value.resolvedAt}
            </p>
          )}
          {data.value.status === 'PENDING' ? (
            <>
              <p>采用后更新来源资料的业务标签或摘要，不修改原件内容和访问权限。</p>
              {(['APPROVE', 'REJECT'] as const).map((action) => (
                <Button
                  key={action}
                  disabled={submit.busy || (action === 'APPROVE' && data.value!.stale)}
                  onClick={() =>
                    void submit.submit(action, async (decision, key) => {
                      await api.resolve(tenant, id, decision, key);
                      refresh((n) => n + 1);
                    })
                  }
                >
                  {action === 'APPROVE' ? '确认采用' : '拒绝提案'}
                </Button>
              ))}
            </>
          ) : (
            <p>{data.value.status === 'APPLIED' ? '已采用' : '已拒绝'}，处理结果已记录。</p>
          )}
          <SubmitError error={submit.error} uncertain={submit.uncertain} />
          {citation && data.value.patch && (
            <Modal title="原文依据" wide onClose={() => select(undefined)}>
              <Citation
                tenant={tenant}
                id={citation}
                back={() => select(undefined)}
                verification={revision}
                embedded
              />
            </Modal>
          )}
        </>
      )}
    </Modal>
  );
}
export function GovernanceAssistant({ tenant, material }: { tenant: string; material: string }) {
  const { session } = useSession();
  const [revision, refresh] = useState(0);
  const [draft, setDraft] = useState<string>();
  const start = useSubmission<{ versionId: string; generation: number }>();
  useRequestLock(start.busy || start.uncertain);
  const data = useRemote(
    (signal) => api.prepare(tenant, material, signal),
    [tenant, material, revision, session.identity],
  );
  return (
    <section className="wiki-notice">
      <h3>治理助手</h3>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {data.value.summary && (
            <>
              <h4>当前资料摘要</h4>
              {data.value.summaryExecutionClass === 'verification' && <p>模拟验证生成</p>}
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.value.summary}</p>
            </>
          )}
          {data.value.canMaintain ? (
            <>
              <p>
                标签可先形成整理提案；摘要可人工填写，或由 AI 生成私人草稿后核对提交。AI
                调用计入企业用量，不自动采用建议。
              </p>
              <ProposalForm
                key={data.value.versionId + ':' + data.value.tagsRevision + ':' + data.value.summaryRevision}
                tenant={tenant}
                material={material}
                preparation={data.value}
              />
              <Button
                disabled={start.busy || data.value.generation === null}
                onClick={() =>
                  void start.submit(
                    { versionId: data.value!.versionId, generation: data.value!.generation! },
                    async (body, key) => {
                      const d = await wikiLearning.start(tenant, material, { ...body, requestId: key });
                      setDraft(d.id);
                    },
                  )
                }
              >
                {start.uncertain ? '重试本次摘要生成请求' : 'AI 生成摘要草稿'}
              </Button>
              <SubmitError error={start.error} uncertain={start.uncertain} />
              {data.value.generation === null && <p>当前资料尚无可用解析片段，完成解析后可生成 AI 草稿。</p>}
              {draft && (
                <SummaryDraft
                  key={draft}
                  tenant={tenant}
                  material={material}
                  id={draft}
                  preparation={data.value}
                />
              )}
            </>
          ) : (
            <p>当前没有来源资料维护权，不能提交或处理业务提案。</p>
          )}
        </>
      )}
    </section>
  );
}
function SummaryDraft({
  tenant,
  material,
  id,
  preparation,
}: {
  tenant: string;
  material: string;
  id: string;
  preparation: GovernancePreparation;
}) {
  const [revision, refresh] = useState(0);
  const { session } = useSession();
  const data = useRemote(
    (signal) => wikiLearning.detail(tenant, id, signal),
    [tenant, id, revision, session.identity],
  );
  const busy = data.value && ['QUEUED', 'RUNNING'].includes(data.value.status);
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => refresh((n) => n + 1), 3000);
      return () => clearTimeout(t);
    }
  }, [busy, revision, data.value]);
  if (data.error) return <Failure error={data.error} retry={() => refresh((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  return (
    <>
      <p>
        摘要草稿：
        {data.value.status === 'SUCCEEDED'
          ? '待核对'
          : data.value.status === 'SOURCE_CHANGED'
            ? '来源已变化'
            : busy
              ? '正在生成'
              : '请查看原任务状态'}
        {data.value.executionClass === 'verification' ? ' · 模拟验证执行' : ''}
      </p>
      <a
        href={`/workspace/#tenant=${tenant}&view=conversations&conversation=${data.value.conversationId}&task=${data.value.taskId}`}
      >
        查看原任务
      </a>
      <Button onClick={() => refresh((n) => n + 1)}>刷新摘要草稿</Button>
      {data.value.article && (
        <ProposalForm
          key={id}
          tenant={tenant}
          material={material}
          preparation={preparation}
          draftId={id}
          initialSummary={data.value.article.intro + '\n' + data.value.article.content}
        />
      )}
    </>
  );
}
function ProposalForm({
  tenant,
  material,
  preparation,
  draftId,
  initialSummary = '',
}: {
  tenant: string;
  material: string;
  preparation: GovernancePreparation;
  draftId?: string;
  initialSummary?: string;
}) {
  const [kind, setKind] = useState<'TAGS' | 'SUMMARY'>(draftId ? 'SUMMARY' : 'TAGS');
  const [tags, setTags] = useState([...new Set([...preparation.tags, '知识沉淀'])].slice(0, 12).join('，'));
  const [summary, setSummary] = useState(initialSummary);
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState(false);
  const submit = useSubmission<GovernanceProposalCreate>();
  useRequestLock(submit.busy || submit.uncertain);
  if (created) return <p>提案已提交，尚未采用。请到“业务提案”核对和确认。</p>;
  return (
    <form
      className="wiki-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit.submit(
          {
            versionId: preparation.versionId,
            expectedRevision: kind === 'TAGS' ? preparation.tagsRevision : preparation.summaryRevision,
            kind,
            tags:
              kind === 'TAGS'
                ? tags
                    .split(/[，,]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                : null,
            summary: kind === 'SUMMARY' ? summary : null,
            draftId: draftId || null,
            reason,
          },
          async (body, key) => {
            await api.create(tenant, material, body, key);
            setCreated(true);
          },
        );
      }}
    >
      {!draftId && (
        <Field label="建议类型">
          <select
            value={kind}
            disabled={submit.busy}
            onChange={(e) => setKind(e.target.value as 'TAGS' | 'SUMMARY')}
          >
            <option value="TAGS">标签整理</option>
            <option value="SUMMARY">人工摘要</option>
          </select>
        </Field>
      )}
      {kind === 'TAGS' ? (
        <Field label="建议标签（逗号分隔）">
          <input
            value={tags}
            disabled={submit.busy}
            required
            maxLength={500}
            onChange={(e) => setTags(e.target.value)}
          />
          <small>“知识沉淀”为固定整理建议，请按业务核对或修改。</small>
        </Field>
      ) : (
        <Field label="建议摘要">
          <textarea
            value={summary}
            disabled={submit.busy}
            required
            maxLength={2000}
            rows={6}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
      )}
      <Field label="提案理由">
        <input
          value={reason}
          disabled={submit.busy}
          required
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <p>提交后建议与原文依据对当前来源维护者可见，私人会话不会公开。</p>
      <Button type="submit" disabled={submit.busy}>
        {submit.uncertain ? '重试本次提案' : '提交业务提案'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </form>
  );
}
