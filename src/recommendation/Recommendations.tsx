import { useViewState, pageState } from '../shared/useViewState';
import { ForwardPublicationButton } from '../forwarding/ForwardPublicationButton';
import { useContext, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Newspaper, Share2, Star } from 'lucide-react';
import type { RecommendationItem } from '../../contracts/public-api/recommendation';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { Button, Empty } from '../shared/ui';
import { useSession } from '../identity/session';
import { materialClient } from '../material/client';
import { conversationHref } from '../conversation/Conversations';
import { FeedbackActions } from '../briefing-live/FeedbackActions';
import { FollowButton } from '../briefing-live/FollowButton';
import { Modal } from '../shared/ui';
import { recommendationClient as api } from './client';
import { usePackedRecommendations } from './usePackedRecommendations';
import { MagazineBody, RailButton } from '../briefing-live/Magazine';
import { ReadingDialog } from '../briefing-live/ReadingDialog';
import './recommendation.css';
export function Recommendations({ tenant, workspace }: { tenant: string; workspace: string | null }) {
  const { session } = useSession(),
    pending = useContext(RequestPending);
  const [page, setPage] = useViewState(tenant, 'recommendation:page:' + workspace, 0, pageState),
    [attempt, setAttempt] = useState(0),
    [snapshot, setSnapshot] = useViewState<string | undefined>(
      tenant,
      'recommendation:snapshot:' + workspace,
      undefined,
      (v): v is string | undefined => v === undefined || (typeof v === 'string' && v.length < 1000),
    );
  const data = useRemote(
    (signal) => api.list(tenant, workspace, page * 20, page ? snapshot : undefined, signal),
    [tenant, workspace, page, attempt, session.identity],
  );
  const grid = useRef<HTMLDivElement>(null);
  usePackedRecommendations(
    grid,
    data.value?.items.map((i) => i.content.id + ':' + i.content.versionKey).join('|') ?? '',
  );
  const submission = useSubmission<{ expectedRevision: number; enabled: boolean }>();
  useRequestLock(submission.busy || submission.uncertain);
  const refresh = () => {
    setPage(0);
    setSnapshot(undefined);
    setAttempt((n) => n + 1);
  };
  const settings = data.value?.settings;
  return (
    <section className="recommendations" aria-label="工作推荐">
      <details className="recommendation-options">
        <summary>推荐设置与依据</summary>
        <div className="recommendation-toolbar">
          <p>按当前可访问成果、明确关注和有效方法排序，阅读后保留原位。</p>
          <Button icon={RefreshCw} disabled={pending} onClick={refresh}>
            刷新推荐
          </Button>
          {settings && (
            <Button
              disabled={submission.busy || (pending && !submission.uncertain)}
              onClick={() =>
                void submission.submit(
                  { expectedRevision: settings.revision, enabled: !settings.enabled },
                  async (body, key) => {
                    await api.configure(tenant, { ...body, requestId: key });
                    refresh();
                  },
                )
              }
            >
              {submission.uncertain ? '重试本次设置' : settings.enabled ? '关闭一般推荐' : '开启一般推荐'}
            </Button>
          )}
        </div>
      </details>
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.settings.enabled ? (
        <Empty
          icon={Newspaper}
          title="一般推荐已关闭"
          text="随时可以在推荐设置中重新开启。会话、成果和待办仍可正常使用。"
        />
      ) : (
        <>
          {data.value.poolLimited && (
            <p className="muted">
              当前对最新 {data.value.rankedCount}{' '}
              项获权成果排序，另有更早成果。可按空间缩小范围，或在会话、资料库查找。
            </p>
          )}
          {!data.value.items.length && (
            <Empty
              icon={Newspaper}
              title="你的下一份工作成果，从一次会话开始"
              text="完成的会话成果和已发布的企业副本，会在这里汇集。"
            >
              <a className="button" href={conversationHref(tenant)}>
                发起会话
              </a>
            </Empty>
          )}
          <div className="live-briefing-grid recommendation-grid" ref={grid}>
            {data.value.items.map((item) => (
              <RecommendationCard
                key={item.content.id + ':' + item.content.versionKey}
                tenant={tenant}
                item={item}
              />
            ))}
          </div>
          {(page > 0 || data.value.hasMore) && (
            <Pager
              page={page}
              next={data.value.hasMore}
              onPage={(next) => {
                if (pending) return;
                setSnapshot(data.value!.snapshot);
                setPage(next);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
function RecommendationCard({ tenant, item }: { tenant: string; item: RecommendationItem }) {
  const c = item.content,
    pending = useContext(RequestPending),
    { expire } = useSession();
  const [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [errorAction, setErrorAction] = useState<'open' | 'download'>('open'),
    [opened, setOpened] = useState(c.openedAt),
    [pinned, setPinned] = useState(c.pinned),
    [shareInfo, setShareInfo] = useState(false);
  const download = useRef<AbortController | null>(null),
    current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
      download.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (c.openedAt) setOpened(c.openedAt);
  }, [c.openedAt]);
  useRequestLock(busy);
  const failed = (e: unknown) => {
    if (!current.current) return;
    setError(e);
    if (e && typeof e === 'object' && 'status' in e && e.status === 401) expire();
  };
  const recordOpen = async () => {
    setErrorAction('open');
    setBusy(true);
    setError(undefined);
    try {
      const receipt = await api.opened(tenant, { kind: c.kind, id: c.id, versionKey: c.versionKey });
      if (current.current) setOpened(receipt.openedAt);
      return true;
    } catch (e) {
      failed(e);
      return false;
    } finally {
      if (current.current) setBusy(false);
    }
  };
  const open = async () => {
    if (c.kind === 'TASK') setReading(true);
    else if (await recordOpen()) setReading(true);
  };
  const save = async () => {
    setErrorAction('download');
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    download.current = controller;
    try {
      const blob = await materialClient.download(
        tenant,
        c.workspaceId,
        c.materialId!,
        c.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const href = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = href;
      a.download = c.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      if (!controller.signal.aborted) failed(e);
    } finally {
      if (current.current) setBusy(false);
    }
  };
  const actions = (
    <>
      {c.kind === 'TASK' && c.conversationId ? (
        <FollowButton tenant={tenant} conversation={c.conversationId} pinned={pinned} changed={setPinned} />
      ) : (
        <RailButton label="企业副本暂不支持关注" icon={Star} disabled />
      )}
      {c.kind === 'PUBLICATION' && item.feedbackTarget?.kind === 'PUBLICATION' ? (
        <ForwardPublicationButton
          tenant={tenant}
          publicationId={item.feedbackTarget.publicationId}
          materialVersionId={item.feedbackTarget.materialVersionId}
          compact
        />
      ) : (
        <RailButton label="转发" icon={Share2} disabled={pending} onClick={() => setShareInfo(true)} />
      )}
    </>
  );
  return (
    <>
      <article
        className={
          'live-briefing-card recommendation-card ' +
          (opened ? 'is-read ' : '') +
          (item.presentation.style === 'CONCISE' ? 'compact' : '')
        }
        aria-label={'推荐成果：' + c.title}
        data-content-id={c.id}
        data-read={!!opened}
      >
        <button
          type="button"
          className="live-briefing-body"
          disabled={pending || busy}
          onClick={() => void open()}
          aria-label={'阅读：' + c.title}
        >
          <MagazineBody
            title={c.title}
            excerpt={c.excerpt}
            truncated={c.truncated}
            workspace={c.workspaceName}
            date={c.createdAt}
            publication={c.kind === 'PUBLICATION'}
            pinned={pinned}
            verification={c.executionClass === 'verification'}
            footer={c.kind === 'PUBLICATION' ? <span>v{c.materialVersion}</span> : undefined}
          />
        </button>
        {!reading && item.feedbackTarget && (
          <div className="live-card-action-rail">
            <FeedbackActions tenant={tenant} target={item.feedbackTarget}>
              {actions}
            </FeedbackActions>
          </div>
        )}
        {!reading && <SubmitError error={error} uncertain={false} />}
      </article>
      {reading && (
        <ReadingDialog
          title={c.title}
          workspace={c.workspaceName}
          date={c.createdAt}
          tenant={tenant}
          task={
            c.kind === 'TASK'
              ? {
                  conversationId: c.conversationId!,
                  taskId: c.id,
                  taskRevision: c.taskRevision!,
                  attempt: c.attempt!,
                  workspaceId: c.workspaceId,
                }
              : undefined
          }
          onRead={() => {
            void recordOpen();
          }}
          onClose={() => setReading(false)}
          pinned={pinned}
          preface={
            item.presentation.style === 'TABLE_FIRST' ? (
              <table className="recommendation-context-table">
                <tbody>
                  <tr>
                    <th>来源</th>
                    <td>{c.workspaceName}</td>
                  </tr>
                  <tr>
                    <th>形成时间</th>
                    <td>{new Date(c.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                  <tr>
                    <th>当前可用</th>
                    <td>站内可访问</td>
                  </tr>
                </tbody>
              </table>
            ) : item.presentation.style === 'DETAIL_FIRST' ? (
              <p className="recommendation-context-reason">{item.reason}</p>
            ) : undefined
          }
          feedbackTarget={item.feedbackTarget || undefined}
          actions={
            <>
              {actions}
              {c.kind === 'PUBLICATION' && (
                <RailButton
                  label={busy ? '正在下载…' : '下载发布副本'}
                  icon={Download}
                  disabled={pending || busy}
                  onClick={() => void save()}
                />
              )}
            </>
          }
        >
          {c.kind === 'PUBLICATION' && (
            <>
              <p className="live-publication-excerpt">
                {c.excerpt}
                {c.truncated ? '…' : ''}
              </p>
              <div className="live-publication-download">
                <p>企业发布的独立副本 · v{c.materialVersion}。此处为内容摘要，请下载该版本核对完整正文。</p>
                <Button icon={Download} disabled={pending || busy} onClick={() => void save()}>
                  下载发布副本 v{c.materialVersion}
                </Button>
              </div>
            </>
          )}
          <SubmitError error={error} uncertain={false} />
          {!!error && !busy && (
            <Button
              onClick={() => {
                if (errorAction === 'download') void save();
                else void recordOpen();
              }}
            >
              {errorAction === 'download' ? '重试下载副本' : '重试记录本次打开'}
            </Button>
          )}
          <details className="recommendation-reason">
            <summary>推荐与呈现依据</summary>
            <p>{item.reason}</p>
            <p>
              方法：{item.method.scope === 'BUILTIN' ? '内建基础排序' : `已采用版本 ${item.method.versionId}`}
              。已读内容留在原位。
            </p>
            <p>
              呈现：
              {item.presentation.profileId
                ? `本人已确认偏好，修订 ${item.presentation.profileRevision}`
                : '默认原文视图'}
              。正文保持原结果。
            </p>
            <p>{opened ? '你已打开过此版本' : '尚无此版本的打开记录'} · 业务效果未评估</p>
          </details>
        </ReadingDialog>
      )}
      {shareInfo && (
        <Modal title="转发这份成果" onClose={() => setShareInfo(false)}>
          <p>
            这份成果来自你的私人会话。先在会话中保存为文稿并发布到有权共享的空间，随后即可从企业副本转发给已获权同事。
          </p>
          <a className="button primary" href={conversationHref(tenant, c.conversationId || undefined)}>
            打开会话并保存成果
          </a>
        </Modal>
      )}
    </>
  );
}
