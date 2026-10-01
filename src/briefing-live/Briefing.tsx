import { briefingTypeLabels } from './content';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { ForwardInbox } from '../forwarding/ForwardInbox';
import { Recommendations } from '../recommendation/Recommendations';
import { FeedbackActions } from './FeedbackActions';
import { MoreActions } from '../shared/MoreActions';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { useContext } from 'react';
import { Attention } from '../attention/Attention';
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Newspaper, Star, RefreshCw, Expand, Minimize, Share2 } from 'lucide-react';
import { MagazineBody, RailButton } from './Magazine';
import { ReadingDialog } from './ReadingDialog';
import type {
  BriefingCard,
  BriefingView,
  BriefingPreference,
  BriefingLayoutMove,
} from '../../contracts/public-api/briefing';
import { identityClient, useSession } from '../identity/session';
import { Button, Empty, Field, PageActions, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { conversationHref } from '../conversation/Conversations';
import { briefingClient as api } from './client';
import './briefing.css';

export const briefingHref = (tenant: string) => '#' + new URLSearchParams({ tenant, view: 'briefing' });
export function LiveBriefing({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const [view, setView] = useViewState<BriefingView | 'RECOMMENDED'>(
    tenant,
    'briefing:view',
    'RECOMMENDED',
    (v): v is BriefingView | 'RECOMMENDED' =>
      typeof v === 'string' && ['RECOMMENDED', 'FOCUSED', 'LATEST', 'HIDDEN'].includes(v),
  );
  const [tab, setTab] = useViewState(tenant, 'briefing:tab', '推荐', textState);
  const [date, setDate] = useViewState(tenant, 'briefing:date', '', textState),
    [space, setSpace] = useViewState(tenant, 'briefing:space', '', textState);
  const [page, setPage] = useViewState(tenant, 'briefing:page', 0, pageState),
    [attempt, setAttempt] = useState(0);
  const [businessType, setBusinessType] = useViewState(tenant, 'briefing:type', '', textState);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = () => setAttempt((n) => n + 1);
  const [moving, setMoving] = useState<string>();
  const [layoutNotice, setLayoutNotice] = useState('');
  const layout = useRemote(
    (signal) => (view === 'FOCUSED' ? api.layout(tenant, signal) : Promise.resolve(null)),
    [tenant, view, attempt, session.identity],
  );
  const layoutSubmit = useSubmission<Omit<BriefingLayoutMove, 'requestId'>>();
  useRequestLock(layoutSubmit.busy || layoutSubmit.uncertain);
  const move = (anchorId: string, direction: BriefingLayoutMove['direction'], source = moving) => {
    if (!source || !layout.value) return;
    setMoving(source);
    void layoutSubmit.submit(
      { expectedRevision: layout.value.revision, conversationId: source, anchorId, direction },
      async (body, requestId) => {
        const receipt = await api.move(tenant, { ...body, requestId });
        setMoving(undefined);
        setLayoutNotice(
          receipt.currentRevision === receipt.appliedRevision
            ? '关注布局已保存。其他视图和成果版本保持原有顺序与内容。'
            : '原移动已经保存，布局随后又有修改；当前显示最新顺序。',
        );
        refresh();
      },
    );
  };
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, session.identity, attempt],
  );
  const feed = useRemote(
    (signal) =>
      view === 'RECOMMENDED'
        ? Promise.resolve(null)
        : api.list(
            tenant,
            {
              view,
              businessType: businessType || undefined,
              date: date || null,
              zone,
              ...(space ? { workspaceId: space } : {}),
            },
            page * 20,
            signal,
          ),
    [tenant, view, businessType, date, zone, space, page, session.identity, attempt],
  );
  useEffect(() => {
    const check = () => {
      if (!pendingRequest && document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pendingRequest]);
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
          {['推荐', '关注', '日期', '类型', '空间'].map((label) => (
            <button
              key={label}
              role="tab"
              aria-selected={tab === label}
              aria-controls="live-briefing-panel"

              disabled={pendingRequest}
              onClick={() => {
                setTab(label);
                setPage(0);
                setDate('');
                setMoving(undefined);
                setView(label === '关注' ? 'FOCUSED' : label === '日期' ? 'LATEST' : 'RECOMMENDED');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </PageActions>
      <PageActions placement="meta">
        <button
          className="live-briefing-refresh"
          aria-label="刷新智能画报"
          title="刷新画报内容"
          disabled={pendingRequest}
          onClick={refresh}
        >
          <RefreshCw size={17} />
        </button>
      </PageActions>
      <section className="live-briefing" id="live-briefing-panel" role="tabpanel">
        <Attention tenant={tenant} refreshToken={attempt} />
        <ForwardInbox tenant={tenant} />
        <div className="live-briefing-filters">
          <Field label="内容类型">
            <select
              aria-label="内容类型"
              value={businessType}
              onChange={(e) => {
                setBusinessType(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(briefingTypeLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {tab === '日期' && (
            <Field label="完成日期">
              <input
                type="date"
                aria-label="查看日期"
                disabled={pendingRequest}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPage(0);
                }}
              />
            </Field>
          )}
          <Field label="工作空间">
            <select
              aria-label="工作空间"
              disabled={pendingRequest}
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部可访问空间</option>
              {context.value?.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <details className="live-briefing-view-options">
            <summary>
              {view === 'HIDDEN' ? '已隐藏' : view === 'LATEST' && tab !== '日期' ? '最新会话' : '更多视图'}
            </summary>
            <Field label="画报视图">
              <select
                aria-label="画报视图"
                disabled={pendingRequest}
                value={view}
                onChange={(e) => {
                  const next = e.target.value as BriefingView | 'RECOMMENDED';
                  setView(next);
                  setPage(0);
                  setMoving(undefined);
                  if (next === 'RECOMMENDED' || next === 'FOCUSED') {
                    setDate('');
                    setTab(next === 'RECOMMENDED' ? '推荐' : '关注');
                  }
                }}
              >
                <option value="RECOMMENDED">工作推荐</option>
                <option value="LATEST">最新会话成果</option>
                <option value="FOCUSED">关注</option>
                <option value="HIDDEN">已隐藏</option>
              </select>
            </Field>
          </details>
          {tab === '日期' && <span className="live-briefing-filter-note">按完成日期查看本人会话成果</span>}
        </div>
        {!!context.error && <Failure error={context.error} retry={refresh} />}
        {view === 'RECOMMENDED' ? (
          <Recommendations
            key={tenant + ':' + space + ':' + businessType + ':' + attempt}
            tenant={tenant}
            workspace={space || null}
            businessType={businessType || undefined}
          />
        ) : feed.error || context.error ? (
          <Failure error={feed.error || context.error} retry={refresh} />
        ) : !feed.value || !context.value ? (
          <Loading />
        ) : (
          <>
            {view === 'FOCUSED' && (
              <Recommendations
                key={'publication-focus:' + space + ':' + businessType + ':' + attempt}
                tenant={tenant}
                workspace={space || null}
                businessType={businessType || undefined}
                publicationsOnly
                focused
              />
            )}
            {view === 'FOCUSED' && (
              <section className="focus-layout-tools" aria-label="关注布局">
                <details>
                  <summary>调整关注布局</summary>
                  <p className="muted">
                    拖动卡片的移动按钮调整顺序，也可选择卡片后跨页指定位置。宽度和顺序仅影响自己的关注画报。
                  </p>
                </details>
                {!!layout.error && <Failure error={layout.error} retry={refresh} />}
                {moving && (
                  <p role="status">已选择待移动卡片。请拖到另一张卡片前，或选择“移到此卡前 / 后”。</p>
                )}
                {layoutNotice && <p role="status">{layoutNotice}</p>}
                <SubmitError error={layoutSubmit.error} uncertain={layoutSubmit.uncertain} />
                {layoutSubmit.uncertain ? (
                  <Button disabled={layoutSubmit.busy} onClick={() => move(moving!, 'BEFORE')}>
                    重试本次布局
                  </Button>
                ) : (
                  moving && (
                    <Button disabled={pendingRequest} onClick={() => setMoving(undefined)}>
                      取消移动
                    </Button>
                  )
                )}
              </section>
            )}
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
                text={
                  date
                    ? '这一天没有符合当前范围的画报。可切换日期或空间。'
                    : '可在会话中要求 AI 根据资料生成画报；有完整内容和依据的结果会出现在这里。'
                }
              >
                <a className="button" href={conversationHref(tenant)}>
                  进入会话
                </a>
              </Empty>
            )}
            {[...groups].map(([day, cards]) => (
              <section className="live-briefing-day" key={day}>
                <h2>{day}</h2>
                <div className="live-briefing-grid">
                  {cards.map((card) => (
                    <Card
                      key={card.conversationId}
                      tenant={tenant}
                      card={card}
                      changed={refresh}
                      focused={view === 'FOCUSED'}
                      moving={moving}
                      canMove={!!layout.value}
                      pick={() => setMoving(card.conversationId)}
                      move={(direction) => move(card.conversationId, direction)}
                      drop={(anchor) => move(anchor, 'BEFORE', card.conversationId)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {feed.value.items.length > 0 && (
              <Pager
                page={page}
                next={feed.value.hasMore}
                onPage={(next) => {
                  if (!pendingRequest) setPage(next);
                }}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
function Card({
  tenant,
  card,
  changed,
  focused,
  moving,
  canMove,
  pick,
  move,
  drop,
}: {
  tenant: string;
  card: BriefingCard;
  changed: () => void;
  focused: boolean;
  moving?: string;
  canMove: boolean;
  pick: () => void;
  move: (direction: BriefingLayoutMove['direction']) => void;
  drop: (anchor: string) => void;
}) {
  const pendingRequest = useContext(RequestPending);
  const [reading, setReading] = useState(false),
    [shareInfo, setShareInfo] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const ignoreClick = useRef(false);
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
        await api.update(tenant, card.conversationId, { ...body, requestId });
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
      <RailButton label="转发" icon={Share2} disabled={pendingRequest} onClick={() => setShareInfo(true)} />
      <MoreActions label="卡片设置">
        <RailButton
          label={card.preference.hidden ? '恢复显示' : '隐藏'}
          icon={card.preference.hidden ? Eye : EyeOff}
          disabled={submission.busy || pendingRequest}
          onClick={() => edit({ hidden: !card.preference.hidden })}
        />
        <RailButton
          label={card.preference.size === 'WIDE' ? '标准卡片' : '加宽卡片'}
          icon={card.preference.size === 'WIDE' ? Minimize : Expand}
          disabled={submission.busy || pendingRequest}
          onClick={() => edit({ size: card.preference.size === 'WIDE' ? 'STANDARD' : 'WIDE' })}
        />
      </MoreActions>
    </>
  );
  return (
    <>
      <article
        className={
          'live-briefing-card ' +
          (card.briefing ? 'has-data-briefing ' : '') +
          (card.preference.size === 'WIDE' ? 'wide' : '')
        }
        aria-label={(card.briefing ? '画报：' : '会话成果：') + card.title}
        data-conversation-id={card.conversationId}
      >
        <button
          type="button"
          className="live-briefing-body"
          disabled={pendingRequest}
          onClick={() => setReading(true)}
        >
          <MagazineBody
            briefing={card.briefing}
            title={card.title}
            excerpt={card.excerpt}
            truncated={card.truncated}
            workspace={card.workspaceName}
            date={card.completedAt}
            pinned={card.preference.pinned}
            verification={card.executionClass === 'verification'}
            footer={card.artifactCount > 0 ? <span>{card.artifactCount} 份成果</span> : undefined}
          />
        </button>
        <div className="live-briefing-controls">
          {focused && (
            <Button
              variant="ghost"
              disabled={pendingRequest || !canMove}
              style={{ touchAction: 'none', cursor: 'grab' }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                drag.current = { x: event.clientX, y: event.clientY, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (
                  drag.current &&
                  Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 6
                )
                  drag.current.moved = true;
              }}
              onPointerUp={(event) => {
                const moved = drag.current?.moved;
                drag.current = undefined;
                ignoreClick.current = !!moved;
                if (moved && !pendingRequest) {
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>('.live-briefing-card[data-conversation-id]');
                  const id = target?.dataset.conversationId;
                  if (id && id !== card.conversationId) drop(id);
                }
              }}
              onPointerCancel={() => {
                drag.current = undefined;
              }}
              onClick={() => {
                if (ignoreClick.current) ignoreClick.current = false;
                else pick();
              }}
            >
              {moving === card.conversationId ? '已选择此卡' : '移动此卡'}
            </Button>
          )}
          {focused && moving && moving !== card.conversationId && (
            <>
              <Button variant="ghost" disabled={pendingRequest || !canMove} onClick={() => move('BEFORE')}>
                移到此卡前
              </Button>
              <Button variant="ghost" disabled={pendingRequest || !canMove} onClick={() => move('AFTER')}>
                移到此卡后
              </Button>
            </>
          )}
        </div>
        {!reading && (
          <div className="live-card-action-rail">
            <FeedbackActions tenant={tenant} target={feedbackTarget}>
              {actions}
            </FeedbackActions>
          </div>
        )}
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
          }}
          pinned={card.preference.pinned}
          onClose={() => setReading(false)}
          feedbackTarget={feedbackTarget}
          actions={actions}
        />
      )}
      {shareInfo && (
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
