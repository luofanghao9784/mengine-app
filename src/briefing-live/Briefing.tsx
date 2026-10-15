import { DateTimeline } from './DateTimeline';
import { FollowInteraction } from './FollowGrid';
import { PersonalFollowGrid } from './PersonalFollowGrid';
import { useInfiniteBriefing, BriefingFeedTail } from './useInfiniteBriefing';
import { MagazineGrid } from './MagazineGrid';
import { useBriefingTabs } from '../components/useBriefingTabs';
import { useBriefingRefresh } from '../components/useBriefingRefresh';
import { useBriefingGeneration } from './useBriefingGeneration';
import { briefingTypeLabels } from './content';
import { useViewState, textState } from '../shared/useViewState';
import { ForwardInbox } from '../forwarding/ForwardInbox';
import { Recommendations } from '../recommendation/Recommendations';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { useContext } from 'react';
import { Attention } from '../attention/Attention';
import { featureEntries } from '../shared/feature-entries';
import { useEffect, useRef, useState } from 'react';
import { Newspaper, Star, RefreshCw, ArrowDown, Check, Share2 } from 'lucide-react';
import { MagazineBody, RailButton, briefingTypeIcons } from './Magazine';
import { ReadingDialog } from './ReadingDialog';
import { captureCardPresentation, type CardPresentation } from './card-presentation';
import type { BriefingCard, BriefingView, BriefingPreference } from '../../contracts/public-api/briefing';
import { identityClient, useSession } from '../identity/session';
import { Button, Empty, PageActions, Modal } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { conversationHref } from '../conversation/Conversations';
import { briefingClient as api } from './client';
import './briefing.css';

export const briefingHref = (tenant: string) => '#' + new URLSearchParams({ tenant, view: 'briefing' });
type BriefingProps = { tenant: string; onMonthChange: (month: string | null) => void };
const ignoreMonth = () => {};
export function LiveBriefing({
  tenant,
  onMonthChange = ignoreMonth,
}: Omit<BriefingProps, 'onMonthChange'> & Partial<Pick<BriefingProps, 'onMonthChange'>>) {
  const { session } = useSession();
  return <BriefingPage key={tenant + ':' + session.identity} tenant={tenant} onMonthChange={onMonthChange} />;
}
function BriefingPage({ tenant, onMonthChange }: BriefingProps) {
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [view, setView] = useState<BriefingView | 'RECOMMENDED'>('RECOMMENDED');
  const [tab, setTab] = useState('推荐');
  useEffect(() => {
    if (tab !== '日期') onMonthChange(null);
    return () => onMonthChange(null);
  }, [tab, onMonthChange]);
  const [space, setSpace] = useViewState(tenant, 'briefing:space', '', textState);
  const [attempt, setAttempt] = useState(0);
  const [businessType, setBusinessType] = useViewState(tenant, 'briefing:type', '', textState);
  const selectedType = tab === '类型' ? businessType : '';
  const selectedSpace = tab === '空间' ? space : '';
  const generation = useBriefingGeneration(tenant, selectedSpace || undefined, selectedType || undefined);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = () => setAttempt((n) => n + 1);
  const pageRef = useRef<HTMLElement>(null);
  const [transitionHeight, setTransitionHeight] = useState(0);
  const reloadState = useRef<{
    attempt: number;
    pending: Set<string>;
    finish: (success: boolean) => void;
  } | null>(null);
  const settled = (part: string, revision: number, success: boolean) => {
    const state = reloadState.current;
    if (!state || state.attempt !== revision) return;
    state.pending.delete(part);
    if (!success || !state.pending.size) {
      reloadState.current = null;
      state.finish(success);
    }
  };
  const trackRead = async <T,>(part: string, request: Promise<T>, signal: AbortSignal) => {
    try {
      const value = await request;
      if (!signal.aborted) {
        settled(part, attempt, true);
        if (part === 'feed') setTransitionHeight(0);
      }
      return value;
    } catch (error) {
      if (!signal.aborted) {
        settled(part, attempt, false);
        setTransitionHeight(0);
      }
      throw error;
    }
  };
  useEffect(() => () => reloadState.current?.finish(false), []);
  const [arranging, setArranging] = useState(false);
  const context = useRemote(
    (signal) => trackRead('context', identityClient.context(tenant, signal), signal),
    [tenant, session.identity, attempt],
  );
  const anchor = useRef<{ key: string; asOf?: string }>({ key: '' });
  const anchorKey = JSON.stringify([
    tenant,
    view,
    selectedType,
    tab,
    zone,
    selectedSpace,
    session.identity,
    attempt,
  ]);
  if (anchor.current.key !== anchorKey) anchor.current = { key: anchorKey };
  const feed = useInfiniteBriefing<import('../../contracts/public-api/briefing').BriefingPage>(
    (offset, _previous, signal) =>
      trackRead(
        tab === '日期' ? 'unused-feed' : 'feed',
        view === 'RECOMMENDED' || tab === '日期'
          ? Promise.resolve(null)
          : api
              .list(
                tenant,
                {
                  view,
                  asOf: anchor.current.asOf,
                  businessType: selectedType || undefined,
                  date: null,
                  zone,
                  ...(selectedSpace ? { workspaceId: selectedSpace } : {}),
                },
                offset,
                signal,
              )
              .then((result) => {
                if (!signal.aborted && anchor.current.key === anchorKey) anchor.current.asOf = result.asOf;
                return result;
              }),
        signal,
      ),
    [tenant, view, tab, selectedType, zone, selectedSpace, session.identity, attempt],
    (card) => card.cardId || card.taskId,
    true,
  );
  const timeline = useInfiniteBriefing<import('../../contracts/public-api/briefing').BriefingTimelinePage>(
    (offset, _previous, signal) =>
      trackRead(
        tab === '日期' ? 'feed' : 'unused-timeline',
        tab === '日期'
          ? api.timeline(tenant, zone, offset, anchor.current.asOf, signal).then((result) => {
              if (!signal.aborted && anchor.current.key === anchorKey) anchor.current.asOf = result.asOf;
              return result;
            })
          : Promise.resolve(null),
        signal,
      ),
    [tenant, tab, zone, session.identity, attempt],
    (day) => day.date,
    true,
  );
  const recommendationKey = JSON.stringify([tenant, view, selectedSpace, selectedType, attempt]);
  const [recommendationReady, setRecommendationReady] = useState<string>();
  const recommendationsSettled = (success: boolean) => {
    setRecommendationReady(success ? recommendationKey : undefined);
    setTransitionHeight(0);
    settled('recommendations', attempt, success);
  };
  const pullRefresh = useBriefingRefresh({
    page: pageRef,
    ready:
      !!context.value &&
      (tab === '日期' ? !!timeline.value : view === 'RECOMMENDED' || !!feed.value) &&
      (!['RECOMMENDED', 'FOCUSED'].includes(view) || recommendationReady === recommendationKey),
    viewKey: JSON.stringify([tenant, view, tab, selectedType, selectedSpace]),
    blocked: pendingRequest || arranging,
    reload: () =>
      new Promise<boolean>((finish) => {
        reloadState.current?.finish(false);
        const revision = attempt + 1;
        reloadState.current = {
          attempt: revision,
          pending: new Set([
            'context',
            'feed',
            ...(['RECOMMENDED', 'FOCUSED'].includes(view) ? ['recommendations'] : []),
          ]),
          finish,
        };

        setAttempt(revision);
      }),
  });
  const tabs = ['推荐', '关注', '日期', '类型', '空间'];
  const selectTab = useBriefingTabs({
    page: pageRef,
    index: Math.max(0, tabs.indexOf(tab)),
    count: tabs.length,
    blocked: pendingRequest || pullRefresh.active || arranging,
    onSelect: (index) => {
      const label = tabs[index];
      setTransitionHeight(pageRef.current?.getBoundingClientRect().height || 0);
      pageRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'instant' });
      setTab(label);

      setArranging(false);
      setView(label === '关注' ? 'FOCUSED' : label === '日期' ? 'LATEST' : 'RECOMMENDED');
    },
  });
  // useRemote already revalidates on focus without discarding mounted cards.
  // Only explicit refresh/filter changes should reset the recommendation grid.

  const groups = new Map<string, BriefingCard[]>();
  for (const card of feed.value?.items || []) {
    const day =
      view === 'FOCUSED'
        ? '我的关注'
        : new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: zone,
          }).format(new Date(card.completedAt));
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(card);
  }
  return (
    <>
      <PageActions>
        <div role="tablist" aria-label="画报分类" className="live-briefing-tabs">
          {tabs.map((label, index) => (
            <button
              key={label}
              role="tab"
              aria-selected={tab === label}
              aria-controls="live-briefing-panel"
              data-briefing-type={
                (label === '类型' && tab === '类型' && briefingTypeLabels[businessType]) || undefined
              }
              disabled={pendingRequest || pullRefresh.active}
              onClick={() => selectTab(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </PageActions>
      <section
        className="live-briefing"
        id="live-briefing-panel"
        role="tabpanel"
        ref={pageRef}
        style={{ minHeight: transitionHeight || undefined }}
        data-refresh-phase={pullRefresh.phase}
        data-briefing-arriving={pullRefresh.arriving || undefined}
      >
        <div
          className="live-briefing-refresh-space"
          style={{ height: pullRefresh.distance }}
          aria-hidden="true"
        >
          <div className="live-briefing-refresh-indicator">
            {pullRefresh.phase === 'refreshing' ? (
              <RefreshCw className="live-briefing-refresh-spinner" size={17} />
            ) : pullRefresh.phase === 'done' ? (
              <Check size={17} />
            ) : (
              <ArrowDown
                size={17}
                style={{ transform: `rotate(${Math.min(1, pullRefresh.distance / 64) * 180}deg)` }}
              />
            )}
            <span>
              {pullRefresh.phase === 'refreshing'
                ? '正在刷新'
                : pullRefresh.phase === 'done'
                  ? '已刷新'
                  : pullRefresh.phase === 'ready'
                    ? '松开刷新'
                    : '下拉刷新'}
            </span>
          </div>
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {pullRefresh.announcement}
        </span>
        {featureEntries.attention && <Attention tenant={tenant} refreshToken={attempt} />}
        {featureEntries.forwarding && <ForwardInbox tenant={tenant} />}
        {['类型', '空间'].includes(tab) && (
          <div className="live-briefing-filters">
            {tab === '类型' && (
              <div className="live-briefing-type-options" role="group" aria-label="内容类型">
                {[['', '全部'], ...Object.entries(briefingTypeLabels)].map(([value, label]) => {
                  const Icon = briefingTypeIcons[value as keyof typeof briefingTypeIcons];
                  return (
                    <button
                      type="button"
                      key={value}
                      className="magazine-type"
                      data-briefing-type={label}
                      aria-pressed={businessType === value}
                      disabled={pendingRequest}
                      onClick={() => {
                        setBusinessType(value);
                      }}
                    >
                      {Icon && <Icon size={14} aria-hidden="true" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {tab === '空间' && (
              <select
                aria-label="画报工作空间"
                disabled={pendingRequest}
                value={space}
                onChange={(e) => {
                  setSpace(e.target.value);
                }}
              >
                <option value="">全部可访问空间</option>
                {context.value?.workspaces.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {!!context.error && <Failure error={context.error} retry={refresh} />}
        {tab !== '日期' && ['RECOMMENDED', 'FOCUSED'].includes(view) && (
          <Recommendations
            key={tenant}
            tenant={tenant}
            refreshToken={attempt}
            generation={tab === '推荐' ? generation : undefined}
            onSettled={recommendationsSettled}
            workspace={selectedSpace || null}
            businessType={selectedType || undefined}
            publicationsOnly={view === 'FOCUSED'}
            focused={view === 'FOCUSED'}
            onArranging={setArranging}
          />
        )}
        {tab === '日期' ? (
          <DateTimeline
            tenant={tenant}
            zone={zone}
            feed={timeline}
            revision={attempt}
            onMonthChange={onMonthChange}
            renderCard={(card) => (
              <Card key={card.cardId || card.taskId} tenant={tenant} card={card} changed={refresh} />
            )}
          />
        ) : view === 'RECOMMENDED' ? null : feed.error || context.error ? (
          <Failure error={feed.error || context.error} retry={refresh} />
        ) : !feed.value || !context.value ? (
          <Loading />
        ) : (
          <>
            {!feed.value.items.length && (
              <Empty
                icon={Newspaper}
                title={
                  view === 'HIDDEN'
                    ? '没有隐藏的卡片'
                    : view === 'FOCUSED'
                      ? '还没有关注的卡片'
                      : '暂时没有生成的画报'
                }
                text={'系统会在资料就绪后自动生成，也可以前往推荐栏生成更多。'}
              >
                <a className="button" href={conversationHref(tenant)}>
                  进入会话
                </a>
              </Empty>
            )}
            {[...groups].map(([day, cards]) => (
              <section className="live-briefing-day" key={day}>
                {view !== 'FOCUSED' && <h2>{day}</h2>}
                <FeedGrid
                  tenant={tenant}
                  focused={view === 'FOCUSED'}
                  board="PRIVATE"
                  onArranging={setArranging}
                  items={cards.map((card) => ({
                    id: card.cardId || card.taskId,
                    title: card.briefing?.content.title ?? card.title,
                    summary: card.briefing?.content.summary ?? card.excerpt,
                    chart: !!card.briefing?.content.chart,
                    wide: card.preference.size === 'WIDE',
                    render: (
                      <Card key={card.cardId || card.taskId} tenant={tenant} card={card} changed={refresh} />
                    ),
                  }))}
                />
              </section>
            ))}
            <BriefingFeedTail feed={feed} blocked={pendingRequest} />
          </>
        )}
      </section>
    </>
  );
}
function FeedGrid(props: React.ComponentProps<typeof PersonalFollowGrid> & { focused: boolean }) {
  return props.focused ? <PersonalFollowGrid {...props} /> : <MagazineGrid items={props.items} />;
}

function Card({
  tenant,
  card,
  changed,
  compact = false,
}: {
  tenant: string;
  card: BriefingCard;
  changed: () => void;
  compact?: boolean;
}) {
  const [presentation, setPresentation] = useState<CardPresentation>();
  const pendingRequest = useContext(RequestPending);
  const [reading, setReading] = useState(false),
    [shareInfo, setShareInfo] = useState(false);
  const follow = useContext(FollowInteraction);
  const submission = useSubmission<Omit<BriefingPreference, 'revision'> & { expectedRevision: number }>();
  useRequestLock(submission.busy || submission.uncertain);
  const edit = (change: Partial<Omit<BriefingPreference, 'revision'>>) =>
    void submission.submit(
      {
        expectedRevision: card.preference.revision,
        pinned: card.preference.pinned,
        hidden: card.preference.hidden,
        size: card.preference.size,
        ...change,
      },
      async (body, requestId) => {
        await api.cardUpdate(tenant, card.cardId || card.taskId, { ...body, requestId });
        changed();
      },
    );
  const feedbackTarget = {
    kind: 'BRIEFING' as const,
    taskId: card.taskId,
    taskRevision: card.taskRevision,
    attempt: card.attempt,
    presentationVersion: 'briefing-basic-v1' as const,
    presentationRevision: card.preference.revision,
  };
  const actions = (
    <>
      <RailButton
        label={submission.uncertain ? '重试本次设置' : card.preference.pinned ? '取消关注' : '关注'}
        icon={Star}
        active={card.preference.pinned}
        aria-pressed={card.preference.pinned}
        disabled={submission.busy || (pendingRequest && !submission.uncertain)}
        onClick={() => edit({ pinned: !card.preference.pinned })}
      />
      {featureEntries.forwarding && (
        <RailButton label="转发" icon={Share2} disabled={pendingRequest} onClick={() => setShareInfo(true)} />
      )}
    </>
  );
  return (
    <>
      <article
        className={
          'live-briefing-card ' +
          (compact ? 'timeline-summary-card ' : '') +
          (card.briefing ? 'has-data-briefing ' : '') +
          (card.preference.size === 'WIDE' ? 'wide' : '')
        }
        aria-label={(card.briefing ? '画报：' : '会话成果：') + card.title}
        data-conversation-id={card.cardId || card.taskId}
      >
        <button
          type="button"
          className="live-briefing-body"
          disabled={pendingRequest}
          onPointerDown={follow?.onPointerDown}
          onKeyDown={follow?.onKeyDown}
          aria-keyshortcuts={follow ? 'Alt+Enter' : undefined}
          aria-describedby={follow ? 'briefing-move-help' : undefined}
          onClick={(event) => {
            if (!follow?.editing) {
              setPresentation(captureCardPresentation(event.currentTarget));
              setReading(true);
            }
          }}
        >
          <MagazineBody
            compact={compact}
            briefing={card.briefing}
            title={card.title}
            excerpt={card.excerpt}
            truncated={card.truncated}
            workspace={card.workspaceName}
            date={card.completedAt}
            pinned={card.preference.pinned}
            feedback={{ tenant, target: feedbackTarget }}
            discussion={
              card.briefing
                ? {
                    tenant,
                    source: {
                      conversationId: card.conversationId,
                      taskId: card.taskId,
                      taskRevision: card.taskRevision,
                      attempt: card.attempt,
                    },
                  }
                : undefined
            }
            verification={card.executionClass === 'verification' && !card.engineVersion.startsWith('codex-demo-import-')}
            footer={card.executionClass === 'external' ? <span>Codex 首轮生成</span> : card.artifactCount > 0 ? <span>{card.artifactCount} 份成果</span> : undefined}
          />
        </button>
        <SubmitError error={submission.error} uncertain={submission.uncertain} />
      </article>
      {reading && (
        <ReadingDialog
          tenant={tenant}
          title={card.title}
          contentLabel={card.briefing ? '数据分析' : undefined}
          workspace={card.workspaceName}
          date={card.completedAt}
          task={{
            conversationId: card.conversationId,
            taskId: card.taskId,
            taskRevision: card.taskRevision,
            attempt: card.attempt,
            workspaceId: card.workspaceId,
            presentation,
          }}
          pinned={card.preference.pinned}
          onClose={() => setReading(false)}
          feedbackTarget={feedbackTarget}
          actions={actions}
        />
      )}
      {featureEntries.forwarding && shareInfo && (
        <Modal title="转发这份成果" onClose={() => setShareInfo(false)}>
          <p>这份成果来自你的私人会话。先保存为文稿并发布到有权共享的空间，再转发企业副本给已获权同事。</p>
          <a className="button primary" href={conversationHref(tenant, card.conversationId)}>
            打开会话并保存成果
          </a>
        </Modal>
      )}
    </>
  );
}
