import { generationTiles } from '../briefing-live/GenerationPanel';
import type { BriefingGeneration } from '../briefing-live/useBriefingGeneration';
import { ContinueWithMaterial } from '../conversation/AttachmentMaterials';
import { AnalysisPanel } from '../material/Knowledge';
import { briefingTypeLabels } from '../briefing-live/content';
import { useViewState, pageState } from '../shared/useViewState';
import { ForwardPublicationButton } from '../forwarding/ForwardPublicationButton';
import { featureEntries } from '../shared/feature-entries';
import { useContext, useEffect, useRef, useState } from 'react';
import { Download, Newspaper, Share2, Star } from 'lucide-react';
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
import { MagazineGrid } from '../briefing-live/MagazineGrid';
import { MagazineBody, RailButton } from '../briefing-live/Magazine';
import { ReadingDialog } from '../briefing-live/ReadingDialog';
import './recommendation.css';
export function Recommendations({
  tenant,
  workspace,
  businessType,
  publicationsOnly = false,
  focused = false,
  onSettled,
  generation,
}: {
  generation?: BriefingGeneration;
  tenant: string;
  workspace: string | null;
  businessType?: string;
  publicationsOnly?: boolean;
  focused?: boolean;
  onSettled?: (success: boolean) => void;
}) {
  const { session } = useSession(),
    pending = useContext(RequestPending);
  const [page, setPage] = useViewState(
      tenant,
      'recommendation:page:' +
        workspace +
        ':' +
        (businessType || 'ALL') +
        ':' +
        focused +
        ':' +
        publicationsOnly,
      0,
      pageState,
    ),
    [attempt, setAttempt] = useState(0),
    [snapshot, setSnapshot] = useViewState<string | undefined>(
      tenant,
      'recommendation:snapshot:' +
        workspace +
        ':' +
        (businessType || 'ALL') +
        ':' +
        focused +
        ':' +
        publicationsOnly,
      undefined,
      (v): v is string | undefined => v === undefined || (typeof v === 'string' && v.length < 1000),
    );
  const data = useRemote(
    (signal) =>
      api
        .list(tenant, workspace, page * 20, page ? snapshot : undefined, signal, {
          businessType,
          publicationsOnly,
          focused,
        })
        .then(
          (result) => {
            if (!signal.aborted) onSettled?.(true);
            return result;
          },
          (error) => {
            if (!signal.aborted) onSettled?.(false);
            throw error;
          },
        ),
    [tenant, workspace, businessType, publicationsOnly, focused, page, attempt, session.identity],
  );
  const reserved = new Set(generation?.slots.flatMap((slot) => slot.batch.cardIds) || []);
  const visibleItems = (data.value?.items || []).filter((item) => !reserved.has(item.content.id));
  const tiles = [
    ...visibleItems.map((item) => ({
      id: item.content.id + ':' + item.content.versionKey,
      title: item.briefing?.content.title ?? item.content.title,
      summary: item.briefing?.content.summary ?? item.content.excerpt,
      chart: !!item.briefing?.content.chart,
      render: <RecommendationCard tenant={tenant} item={item} />,
    })),
    ...(generation ? generationTiles(generation, (item) => <RecommendationCard tenant={tenant} item={item} />) : []),
  ];
  const submission = useSubmission<{ expectedRevision: number; enabled: boolean }>();
  useRequestLock(submission.busy || submission.uncertain);
  const refresh = () => {
    setPage(0);
    setSnapshot(undefined);
    setAttempt((n) => n + 1);
  };
  return (
    <section className="recommendations" aria-label={focused ? '关注的企业成果' : '工作推荐'}>
      <SubmitError error={submission.error} uncertain={submission.uncertain} />
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : !data.value.settings.enabled && !focused ? (
        <Empty icon={Newspaper} title="一般推荐已关闭" text="会话和成果仍可正常使用，也可以重新开启推荐。">
          <Button
            disabled={submission.busy || (pending && !submission.uncertain)}
            onClick={() =>
              void submission.submit(
                { expectedRevision: data.value!.settings.revision, enabled: true },
                async (body, requestId) => {
                  await api.configure(tenant, { ...body, requestId });
                  refresh();
                },
              )
            }
          >
            {submission.uncertain ? '重试开启推荐' : '开启推荐'}
          </Button>
        </Empty>
      ) : (
        <>
          {data.value.poolLimited && (
            <p className="muted">
              当前对最新 {data.value.rankedCount}{' '}
              项获权成果排序，另有更早成果。可按空间缩小范围，或在会话、资料库查找。
            </p>
          )}
          {!visibleItems.length && !generation && (
            <Empty
              icon={Newspaper}
              title="画报正在等待可用资料"
              text="资料就绪后系统会自动准备画报。也可以在下方生成更多。"
            >
              <a className="button" href={conversationHref(tenant)}>
                发起会话
              </a>
            </Empty>
          )}
          <MagazineGrid items={tiles} />
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
      {generation && (!data.value || !data.value.settings.enabled || !!data.error) && (
        <GeneratedBriefings tenant={tenant} generation={generation} />
      )}
    </section>
  );
}
export function GeneratedBriefings({ tenant, generation }: { tenant: string; generation: BriefingGeneration }) {
  return <MagazineGrid items={generationTiles(generation, (item) => <RecommendationCard tenant={tenant} item={item} />)} />;
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
        <FollowButton
          tenant={tenant}
          conversation={c.conversationId}
          cardId={c.id}
          pinned={pinned}
          changed={setPinned}
        />
      ) : (
        <PublicationFollow tenant={tenant} material={c.materialId!} pinned={pinned} changed={setPinned} />
      )}
      {featureEntries.forwarding &&
        (c.kind === 'PUBLICATION' && item.feedbackTarget?.kind === 'PUBLICATION' ? (
          <ForwardPublicationButton
            tenant={tenant}
            publicationId={item.feedbackTarget.publicationId}
            materialVersionId={item.feedbackTarget.materialVersionId}
            compact
          />
        ) : (
          <RailButton label="转发" icon={Share2} disabled={pending} onClick={() => setShareInfo(true)} />
        ))}
    </>
  );
  return (
    <>
      <article
        className={
          'live-briefing-card recommendation-card ' +
          (item.briefing ? 'has-data-briefing ' : '') +
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
            briefing={item.briefing}
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
          contentLabel={item.briefing ? briefingTypeLabels[item.briefing.content.businessType] : '成果'}
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
              <AnalysisPanel
                tenant={tenant}
                space={c.workspaceId}
                material={c.materialId!}
                version={c.id}
                verification={c.versionKey}
              />
              <ContinueWithMaterial
                tenant={tenant}
                space={c.workspaceId}
                material={c.materialId!}
                version={c.id}
                close={() => setReading(false)}
              />
              <p className="live-publication-excerpt">
                {c.excerpt}
                {c.truncated ? '…' : ''}
              </p>
              <div className="live-publication-download">
                <p>企业发布的独立副本 · v{c.materialVersion}。上方展示已解析正文，可下载该版本核对原件。</p>
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
      {featureEntries.forwarding && shareInfo && (
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

function PublicationFollow({
  tenant,
  material,
  pinned,
  changed,
}: {
  tenant: string;
  material: string;
  pinned: boolean;
  changed: (value: boolean) => void;
}) {
  const submit = useSubmission<{ expectedRevision: number; pinned: boolean }>();
  const [body, setBody] = useState<{ expectedRevision: number; pinned: boolean }>(),
    [reading, setReading] = useState(false),
    [error, setError] = useState<unknown>();
  useRequestLock(reading || submit.busy || submit.uncertain);
  async function send() {
    setReading(true);
    setError(undefined);
    try {
      const current = submit.uncertain
        ? body
        : await api
            .publicationPreference(tenant, material)
            .then((p) => ({ expectedRevision: p.revision, pinned: !p.pinned }));
      if (!current) return;
      setBody(current);
      await submit.submit(current, async (value, requestId) =>
        changed((await api.followPublication(tenant, material, { ...value, requestId })).pinned),
      );
    } catch (e) {
      setError(e);
    } finally {
      setReading(false);
    }
  }
  return (
    <div className="live-follow-action">
      <RailButton
        icon={Star}
        label={submit.uncertain ? '重试本次关注' : pinned ? '取消关注' : '关注'}
        active={pinned}
        disabled={reading || submit.busy}
        onClick={() => void send()}
      />
      <SubmitError error={error || submit.error} uncertain={submit.uncertain} />
    </div>
  );
}
