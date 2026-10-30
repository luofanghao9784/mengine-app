import { versionLabel } from './display-labels';
import { useState } from 'react';
import type { WikiDraft } from '../../contracts/public-api/wiki-learning';
import type { WikiArticle, WikiArticleBody } from '../../contracts/public-api/wiki-articles';
import { useSession } from '../identity/session';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Button, Field, Modal } from '../shared/ui';
import { Citation } from '../material/Knowledge';
import { wikiArticles as api, type ArticleText } from './wiki-articles-client';

function TextFields({
  value,
  onChange,
  disabled,
}: {
  value: ArticleText;
  onChange: (v: ArticleText) => void;
  disabled: boolean;
}) {
  return (
    <div className="wiki-editor">
      <Field label="知识标题">
        <input
          maxLength={80}
          required
          disabled={disabled}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="知识导语">
        <textarea
          maxLength={250}
          required
          rows={3}
          disabled={disabled}
          value={value.intro}
          onChange={(e) => onChange({ ...value, intro: e.target.value })}
        />
      </Field>
      <Field label="知识正文">
        <textarea
          maxLength={1500}
          required
          rows={10}
          disabled={disabled}
          value={value.content}
          onChange={(e) => onChange({ ...value, content: e.target.value })}
        />
      </Field>
    </div>
  );
}
export function PublishWikiDraft({ tenant, draft }: { tenant: string; draft: WikiDraft }) {
  const { session } = useSession();
  const [revision, retry] = useState(0);
  const [opened, open] = useState(false);
  const data = useRemote(
    (signal) => api.prepare(tenant, draft.id, signal),
    [tenant, draft.id, revision, session.identity],
  );
  return (
    <section>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : data.value?.canPublish ? (
        <>
          <Button onClick={() => open((v) => !v)}>{opened ? '收起发布校订' : '校订并发布到 Wiki'}</Button>
          {opened && draft.article && (
            <PublishForm
              key={data.value.expectedRevision}
              tenant={tenant}
              draft={draft}
              expected={data.value.expectedRevision}
              done={() => {
                open(false);
                retry((n) => n + 1);
              }}
            />
          )}
        </>
      ) : data.value ? (
        <p className="muted">发布需要当前来源资料的维护权限；草稿仍仅本人可见。</p>
      ) : (
        <Loading />
      )}
    </section>
  );
}
function PublishForm({
  tenant,
  draft,
  expected,
  done,
}: {
  tenant: string;
  draft: WikiDraft;
  expected: number;
  done: () => void;
}) {
  const [text, setText] = useState<ArticleText>({
    title: draft.article!.title,
    intro: draft.article!.intro,
    content: draft.article!.content,
  });
  const [ack, setAck] = useState(false);
  const [published, setPublished] = useState<WikiArticle>();
  const submit = useSubmission<ArticleText & { expectedRevision: number; acknowledged: boolean }>();
  return published ? (
    <p role="status">
      已发布为 Wiki 知识{versionLabel(published.revision)}。<Button onClick={done}>完成发布</Button>
    </p>
  ) : (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit.submit(
          { ...text, expectedRevision: expected, acknowledged: ack },
          async (body, requestId) =>
            setPublished(await api.publish(tenant, draft.id, { ...body, requestId })),
        );
      }}
    >
      <p className="wiki-notice">
        {expected
          ? `将更新这份资料的现有 Wiki 知识 ${versionLabel(expected)}，旧版保留在维护记录。`
          : '发布后，当前及以后获准读取来源资料的成员可阅读此知识。'}{' '}
        不会开放你的私人会话。原文引用保持不变，正文请依据来源校订。
      </p>
      <TextFields value={text} onChange={setText} disabled={submit.busy || submit.uncertain} />
      <label className="wiki-ack">
        <input
          type="checkbox"
          required
          checked={ack}
          disabled={submit.busy || submit.uncertain}
          onChange={(e) => setAck(e.target.checked)}
        />
        我已核对内容，同意按来源资料的读取范围发布
      </label>
      <Button type="submit" disabled={!ack || submit.busy}>
        {submit.uncertain ? '重试本次发布' : '确认发布'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </form>
  );
}
export function WikiArticles({ tenant, revision }: { tenant: string; revision: number }) {
  const { session } = useSession();
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [attempt, retry] = useState(0);
  const [selected, select] = useState<string>();
  const data = useRemote(
    (signal) => api.list(tenant, archived, page * 20, signal),
    [tenant, archived, page, revision, attempt, session.identity],
  );
  return (
    <>
      <div className="wiki-controls">
        <p>共享知识沿用来源资料权限，不提供额外公开访问。</p>
        <Button
          onClick={() => {
            setArchived((v) => !v);
            setPage(0);
          }}
        >
          {archived ? '查看已发布知识' : '查看已下架知识'}
        </Button>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="wiki-grid">
            {data.value.items.map((item) => (
              <button className="wiki-card" key={item.id} onClick={() => select(item.id)}>
                <h3>{item.article?.title || item.sourceName}</h3>
                <p>
                  {item.sourceName} · 来源{versionLabel(item.sourceVersion)} · 知识{versionLabel(item.revision)}
                </p>
                {item.sourceChanged ? (
                  <span>来源已变化，正文已隐藏</span>
                ) : (
                  <span>{item.article?.intro}</span>
                )}
                {item.executionClass === 'verification' && <small>合成模型验证内容</small>}
              </button>
            ))}
          </div>
          {!data.value.items.length && (
            <p className="wiki-empty">
              {archived ? '暂无本人可维护的已下架知识。' : '暂无可访问的共享知识。'}
            </p>
          )}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
        </>
      )}
      {selected && (
        <ArticleReader
          key={selected}
          tenant={tenant}
          id={selected}
          close={() => {
            select(undefined);
            retry((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
function Body({ article }: { article: WikiArticleBody }) {
  return (
    <article className="wiki-article">
      <h2>{article.title}</h2>
      <p>{article.intro}</p>
      <div style={{ whiteSpace: 'pre-wrap' }}>{article.content}</div>
      <h3>原文依据</h3>
      {article.evidence.map((e, i) => (
        <blockquote key={i}>{e.quote}</blockquote>
      ))}
    </article>
  );
}
export function ArticleReader({ tenant, id, close }: { tenant: string; id: string; close: () => void }) {
  const { session } = useSession();
  const [revision, retry] = useState(0);
  const [editing, edit] = useState(false);
  const [history, showHistory] = useState(false);
  const [citation, select] = useState<string>();
  const data = useRemote(
    (signal) => api.detail(tenant, id, signal),
    [tenant, id, revision, session.identity],
  );
  const submit = useSubmission<{ expectedRevision: number; action: 'ARCHIVE' | 'RESTORE' }>();
  const action = (item: WikiArticle) =>
    void submit.submit(
      { expectedRevision: item.revision, action: item.archived ? 'RESTORE' : 'ARCHIVE' },
      async (body, requestId) => {
        await api.change(tenant, id, { ...body, requestId });
        retry((n) => n + 1);
      },
    );
  return (
    <Modal title="共享 Wiki 知识" wide onClose={close}>
      {data.error ? (
        <Failure error={data.error} retry={() => retry((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {data.value.sourceName} · 来源{versionLabel(data.value.sourceVersion)} · 知识{versionLabel(data.value.revision)}
            {data.value.archived ? ' · 已下架' : ''}
          </p>
          <Button onClick={() => retry((n) => n + 1)}>刷新知识</Button>
          {data.value.sourceChanged ? (
            <p className="wiki-notice">
              来源版本或解析批次已变化，旧正文及历史正文已隐藏。请重新学习并核对后发布。
            </p>
          ) : (
            data.value.article && (
              <>
                <Body article={data.value.article} />
                <p className="muted">
                  {data.value.executionClass === 'verification'
                    ? '合成模型验证内容，非真实模型质量验收'
                    : 'AI 学习，经人工确认发布；可继续校订'}{' '}
                  · {data.value.modelName} · 来源范围最多前 10 个片段、6,000 字符
                </p>
                {data.value.article.evidence.map((e, i) => (
                  <Button key={i} onClick={() => select(e.chunkId)}>
                    核对引用 {i + 1}
                  </Button>
                ))}
                {citation && (
                  <Citation
                    tenant={tenant}
                    id={citation}
                    back={() => select(undefined)}
                    verification={revision}
                  />
                )}
              </>
            )
          )}
          {data.value.canMaintain && (
            <section className="wiki-notice">
              <div className="wiki-controls">
                {!data.value.archived && !data.value.sourceChanged && (
                  <Button onClick={() => edit((v) => !v)}>{editing ? '取消校订' : '校订知识'}</Button>
                )}
                <Button
                  disabled={submit.busy || (data.value.archived && data.value.sourceChanged)}
                  onClick={() => action(data.value!)}
                >
                  {submit.uncertain ? '重试本次操作' : data.value.archived ? '恢复上架' : '下架知识'}
                </Button>
                <Button onClick={() => showHistory((v) => !v)}>
                  {history ? '收起维护记录' : '维护记录'}
                </Button>
              </div>
              <p>下架后退出共享列表，维护者可查看并恢复；来源文件保持不变。</p>
              <SubmitError error={submit.error} uncertain={submit.uncertain} />
              {editing && data.value.article && !data.value.archived && !data.value.sourceChanged && (
                <EditForm
                  key={data.value.revision}
                  tenant={tenant}
                  item={data.value}
                  done={() => {
                    edit(false);
                    retry((n) => n + 1);
                  }}
                />
              )}
              {history && <History key={revision} tenant={tenant} id={id} />}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
function EditForm({ tenant, item, done }: { tenant: string; item: WikiArticle; done: () => void }) {
  const [text, setText] = useState<ArticleText>({
    title: item.article!.title,
    intro: item.article!.intro,
    content: item.article!.content,
  });
  const submit = useSubmission<ArticleText & { expectedRevision: number; action: 'EDIT' }>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit.submit(
          { ...text, expectedRevision: item.revision, action: 'EDIT' },
          async (body, requestId) => {
            await api.change(tenant, item.id, { ...body, requestId });
            done();
          },
        );
      }}
    >
      <TextFields value={text} onChange={setText} disabled={submit.busy || submit.uncertain} />
      <Button type="submit" disabled={submit.busy}>
        {submit.uncertain ? '重试本次校订' : '保存校订并更新共享知识'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </form>
  );
}
function History({ tenant, id }: { tenant: string; id: string }) {
  const { session } = useSession();
  const [page, setPage] = useState(0);
  const [attempt, retry] = useState(0);
  const data = useRemote(
    (signal) => api.history(tenant, id, page * 20, signal),
    [tenant, id, page, attempt, session.identity],
  );
  return data.error ? (
    <Failure error={data.error} retry={() => retry((n) => n + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <>
      {data.value.items.map((h) => (
        <details key={h.revision}>
          <summary>
            {versionLabel(h.revision)} · {{ PUBLISH: '发布', EDIT: '校订', ARCHIVE: '下架', RESTORE: '恢复' }[h.action]} ·{' '}
            {h.createdAt}
          </summary>
          <p>操作者：{h.actorId}</p>
          {h.article ? <Body article={h.article} /> : <p>来源已变化，历史正文已隐藏。</p>}
        </details>
      ))}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
