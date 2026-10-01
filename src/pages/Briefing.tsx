import { withBriefingArticle } from '../briefingArticle';
import { interleaveNinepopNews } from '../ninepop/editorial';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Newspaper, RefreshCw, ArrowDown, Check } from 'lucide-react';
import { useDemo, useUI } from '../store';
import {
  hiddenPilePositions,
  type BriefingEntry,
  groupBriefingEntries,
  layoutBriefingSpread,
  relativeBriefingDay,
  type Placement,
  type BriefingGroup,
} from '../briefingLayout';
import { visibleSpaces } from '../libraryModel';
import { BriefingCardPeople } from '../components/BriefingMedia';
import { Button, Empty, Modal, PageActions } from '../components/ui';
import { useBriefingTabs } from '../components/useBriefingTabs';
import { useBriefingRefresh } from '../components/useBriefingRefresh';
import { useBriefingCardFit } from '../components/useBriefingCardFit';
import { useBriefingFollowLayout } from '../components/useBriefingFollowLayout';
import { BriefingResizeHandle } from '../components/BriefingResize';
import { BriefingMagazineBody } from '../components/BriefingMagazineBody';
import { magazineType, magazineTypes, magazineFilter } from '../briefingMagazine';
import { BriefingStatusMarks, briefingStatusMarks } from '../components/BriefingStatusMarks';
import { BriefingDetail } from '../components/BriefingDetail';
import { isBriefingRead, recommendBriefing, refreshBriefingRecommendations } from '../briefingFeedback';
import {
  cardConfig,
  canReadCardData,
  localDate,
  type BriefingCard,
  type CardConfig,
  type CardData,
  type BriefingReference,
} from '../briefing';
import { briefingCreatedAt, briefingEntry, briefingLifecycle } from '../briefingLifecycle';

export function BriefingCardBody(props: { data: CardData; config: CardConfig; at: string }) {
  return <BriefingMagazineBody {...props} />;
}

function Card({
  card,
  data,
  at,
  placement,
  onOpen,
  follow,
}: BriefingEntry & {
  placement: Placement;
  onOpen: (reference: BriefingReference, trigger: HTMLButtonElement) => void;
  follow?: ReturnType<typeof useBriefingFollowLayout>;
}) {
  const { state } = useDemo();
  const config = { ...cardConfig(card), title: card.config?.title || data.title, size: placement.size };
  const read = isBriefingRead(state, data);
  const marks = briefingStatusMarks(state, card);
  return (
    <article
      className={`briefing-card template-${data.template} ${read ? 'is-read' : ''} ${follow?.resize.preview?.id === card.id ? 'is-resizing' : ''} ${follow?.move.preview?.id === card.id ? (follow.move.preview.pointer ? 'is-moving' : 'is-keyboard-moving') : ''}`}
      data-card-id={card.id}
      data-size={config.size}
      data-requested-size={follow?.requestedSizes[card.id]}
      data-read={read}
      data-layout-editable={!!follow}
      style={
        {
          '--briefing-marks-space': `${marks.length * 23}px`,
          gridColumn: `${placement.col + 1} / span ${placement.width}`,
          gridRow: `${placement.row + 1} / span ${placement.height}`,
        } as CSSProperties
      }
    >
      <button
        className="briefing-card-main"
        aria-label={[config.title, ...(read ? ['已读'] : []), ...marks.map((mark) => mark.label)].join('，')}
        aria-describedby={follow ? 'briefing-move-help' : undefined}
        aria-keyshortcuts={follow ? 'Alt+Enter' : undefined}
        onPointerDown={follow ? (event) => follow.move.start(event, card.id, 'following') : undefined}
        onKeyDown={
          follow
            ? (event) => {
                if (event.altKey && event.key === 'Enter' && !follow.move.preview) {
                  event.preventDefault();
                  follow.move.startKeyboard(event.currentTarget, card.id, 'following');
                } else follow.move.keyDown(event, card.id);
              }
            : undefined
        }
        onClick={(e) =>
          !follow?.edit.editing &&
          onOpen(
            withBriefingArticle({
              cardId: card.id,
              asOf: at,
              snapshot: structuredClone(data),
              config: structuredClone(config),
            }),
            e.currentTarget,
          )
        }
      >
        <BriefingCardBody data={data} config={config} at={at} />
        <BriefingStatusMarks marks={marks} />
      </button>
      <BriefingCardPeople data={data} />
      {follow && (
        <BriefingResizeHandle
          id={card.id}
          title={config.title}
          size={placement.size}
          resize={follow.resize}
          disabled={!!follow.move.preview}
          position={{ groupId: 'following', row: placement.row, col: placement.col }}
        />
      )}
    </article>
  );
}
function HiddenPile({
  entries,
  day,
  position,
  onOpen,
}: {
  entries: BriefingEntry[];
  day: string;
  position: { row: number; col: number };
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      className="briefing-hidden-pile"
      data-size="1×1"
      data-day={day}
      aria-label={`查看 ${day} 已隐藏卡片，共 ${entries.length} 则`}
      aria-haspopup="dialog"
      onClick={(event) => onOpen(event.currentTarget)}
      style={{ gridColumn: position.col + 1, gridRow: position.row + 1 }}
    >
      {entries
        .slice(0, 3)
        .reverse()
        .map((entry, index, all) => (
          <span
            className="briefing-hidden-sheet"
            key={entry.card.id}
            aria-hidden="true"
            style={{ '--sheet-index': all.length - index - 1 } as CSSProperties}
          >
            <span className="briefing-hidden-preview">
              <span>{magazineType(entry.data)}</span>
              <strong>{entry.data.title}</strong>
              <span>{entry.data.fact}</span>
              <i />
              <i />
              <i />
            </span>
          </span>
        ))}
      <span className="briefing-hidden-label">已隐藏</span>
    </button>
  );
}

function HiddenCards({
  entries,
  day,
  onClose,
}: {
  entries: BriefingEntry[];
  day: string;
  onClose: () => void;
}) {
  const { change } = useDemo();
  const ui = useUI();
  return (
    <Modal title={`${day} · 已隐藏`} onClose={onClose}>
      <p className="briefing-hidden-note">仅从画报隐藏，事项和会话均保留。恢复后继续显示原卡内容。</p>
      <ul className="briefing-hidden-list">
        {entries.map(({ card, data }) => (
          <li key={card.id}>
            <div>
              <strong>{card.config?.title || data.title}</strong>
              <small>
                {magazineType(data)} · {data.source}
              </small>
            </div>
            <Button
              icon={RotateCcw}
              aria-label={`恢复 ${card.config?.title || data.title}`}
              onClick={() => {
                change((s) => {
                  s.briefing!.cards.find((c) => c.id === card.id)!.hidden = false;
                });
                ui.toast('卡片已恢复');
                if (entries.length === 1) {
                  onClose();
                  requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLButtonElement>(
                        `.briefing-grid [data-card-id="${CSS.escape(card.id)}"] .briefing-card-main`,
                      )
                      ?.focus({ preventScroll: true });
                  });
                }
              }}
            >
              恢复
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const tabs = ['推荐', '关注', '日期', '类型', '空间'] as const;
// Temporarily hide conversation summaries on the briefing surface; retain their data and chats.
const visibleTypes = magazineTypes.filter((type) => type !== '会话');
export function Briefing() {
  const { state, change } = useDemo();
  const ui = useUI();
  const routeScope = ui.route.split('/')[1];
  const saved = ui.briefingViews.current[ui.route];
  const [tab, setTab] = useState<(typeof tabs)[number]>(
    saved?.tab === '最新' ? '推荐' : saved?.tab || (routeScope ? '空间' : '推荐'),
  );
  const savedType = magazineFilter(saved?.type || '全部');
  const [type, setType] = useState(savedType === '会话' ? '全部' : savedType);
  const [scope, setScope] = useState(saved?.scope || routeScope || 'all');
  const [day, setDay] = useState(saved?.day || '');
  const [detail, setDetail] = useState<BriefingReference | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [hiddenGroup, setHiddenGroup] = useState<{ groupId: string; day: string } | null>(null);
  const hiddenTrigger = useRef<HTMLButtonElement | null>(null);
  const [recommendations, setRecommendations] = useState(() => recommendBriefing(state));
  useEffect(() => {
    setRecommendations(change((draft) => refreshBriefingRecommendations(draft)));
  }, [state.profile.name]);
  const view = useRef({ tab, type, scope, day, closed: false, scrollTop: saved?.scrollTop || 0 });
  view.current = { ...view.current, tab, type, scope, day };
  const pageRef = useRef<HTMLDivElement>(null);
  const [{ columns, unit, ready: gridReady }, setGrid] = useState({ columns: 5, unit: 248, ready: false });
  const live = (state.briefing?.cards || []).filter(
    (c) => magazineType(c.data) !== '会话' && c.active && canReadCardData(state, c.data),
  );
  const dates = [
    ...new Set(
      live.filter((c) => briefingLifecycle(c.data) === 'dated').map((c) => localDate(briefingCreatedAt(c))),
    ),
  ]
    .sort()
    .reverse();
  const entries = live
    .filter((c) => tab !== '关注' || c.pinned)
    .flatMap((card) => {
      const entry = briefingEntry(card, tab === '日期' ? day : undefined);
      return entry ? [entry] : [];
    })
    .filter(
      ({ data }) =>
        magazineType(data) !== '会话' &&
        (tab !== '类型' || type === '全部' || magazineType(data) === type) &&
        (tab !== '空间' || scope === 'all' || data.space === scope),
    );
  const normalGroups = () =>
    groupBriefingEntries(entries, tab === '推荐' ? '最新' : tab, false, {
      personal: '个人空间',
      ...Object.fromEntries(visibleSpaces(state).map((s) => [s.id, s.name])),
    });
  const initialGroups: BriefingGroup[] =
    tab === '推荐'
      ? [
          {
            id: 'recommended',
            label: '为你推荐',
            entries: recommendations.flatMap((r) => {
              const entry = entries.find((e) => e.card.id === r.id);
              return entry ? [entry] : [];
            }),
          },
        ].filter((g) => g.entries.length)
      : tab === '关注'
        ? entries.length
          ? [{ id: 'following', label: '我的关注', entries }]
          : []
        : normalGroups();
  const groups =
    state.scenario === 'ninepop' && tab !== '关注'
      ? initialGroups.map((group) => ({ ...group, entries: interleaveNinepopNews(group.entries) }))
      : initialGroups;
  const viewKey = JSON.stringify([ui.route, tab, type, scope, day]);
  const fit = useBriefingCardFit(
    pageRef,
    JSON.stringify([
      viewKey,
      columns,
      unit,
      entries.map((e) => [e.card.id, e.data, e.card.config?.title]),
      tab === '关注' ? state.briefing?.followLayouts?.[state.profile.name]?.sizes : undefined,
    ]),
    columns,
    unit,
  );
  const follow = useBriefingFollowLayout({
    minimum: fit,
    page: pageRef,
    columns,
    unit,
    viewKey,
    enabled: tab === '关注',
    blocked: ui.conversationOpen || !!detail || !!hiddenGroup,
    entries,
  });
  const arranging = !!follow.move.preview || !!follow.resize.preview || follow.edit.editing;
  const refresh = useBriefingRefresh({
    page: pageRef,
    ready: gridReady,
    viewKey,
    blocked: ui.conversationOpen || !!detail || !!hiddenGroup || arranging,
    onRefresh: () => {
      setRecommendations(change((draft) => refreshBriefingRecommendations(draft)));
    },
  });
  const selectTab = useBriefingTabs({
    page: pageRef,
    index: tabs.indexOf(tab),
    count: tabs.length,
    blocked: ui.conversationOpen || !!detail || !!hiddenGroup || refresh.active || arranging,
    onSelect: (index) => {
      view.current.scrollTop = 0;
      pageRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'instant' });
      setTab(tabs[index]);
    },
  });
  const closeDetail = () => {
    setDetail(null);
    requestAnimationFrame(() => detailTrigger.current?.focus({ preventScroll: true }));
  };
  const hiddenEntries = hiddenGroup
    ? groups
        .find((g) => g.id === hiddenGroup.groupId)
        ?.entries.filter((e) => e.card.hidden && localDate(e.at) === hiddenGroup.day) || []
    : [];
  useLayoutEffect(() => {
    const scroller = pageRef.current?.closest('main');
    if (!scroller) return;
    let ready = false;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = view.current.scrollTop;
      ready = true;
    });
    const save = () => {
      if (ready) view.current.scrollTop = scroller.scrollTop;
      ui.briefingViews.current[ui.route] = { ...view.current };
    };
    scroller.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', save);
    };
  }, []);
  useLayoutEffect(() => {
    const measure = (width: number) => {
      const columns = width >= 1210 ? 5 : width >= 966 ? 4 : width >= 722 ? 3 : width >= 478 ? 2 : 1;
      setGrid({ columns, unit: (width - (columns - 1) * 10) / columns, ready: true });
    };
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    if (pageRef.current) {
      const style = getComputedStyle(pageRef.current);
      measure(
        pageRef.current.getBoundingClientRect().width -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      );
      observer.observe(pageRef.current);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={`briefing-page ${tab === '关注' ? 'can-arrange' : ''} ${follow.resize.preview ? 'is-resizing' : ''} ${follow.move.preview ? 'is-moving' : ''} ${follow.edit.editing ? 'is-editing' : ''} ${refresh.active ? 'is-refreshing' : ''}`}
      ref={pageRef}
      data-briefing-arriving={refresh.arriving || undefined}
      data-refresh-phase={refresh.phase}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && follow.edit.editing && !follow.move.preview && !follow.resize.preview)
          follow.finishEditing();
      }}
      style={{ '--briefing-columns': columns, '--briefing-unit': `${unit}px` } as CSSProperties}
    >
      {tab === '关注' && (
        <>
          <span id="briefing-move-help" className="briefing-sr-only">
            拖动卡片调整位置，松手保存，Esc 取消。触屏长按后拖动。Alt 加回车拿起卡片，方向键移动，回车放下。
          </span>
          <span id="briefing-resize-help" className="briefing-sr-only">
            拖动右下角调整大小，松手保存，Esc 取消；也可聚焦此按钮后使用方向键调整大小。
          </span>
          <span role="status" className="briefing-sr-only">
            {follow.move.announcement || follow.resize.announcement}
          </span>
          {follow.resize.preview && (
            <div ref={follow.resize.hint} className="briefing-resize-hint" aria-hidden="true">
              {follow.resize.preview.size}
            </div>
          )}
        </>
      )}
      <PageActions>
        <div role="tablist" aria-label="画报分类" className="briefing-tabs">
          {tabs.map((t, index) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              aria-controls="briefing-panel"
              disabled={refresh.active || arranging}
              onClick={() => selectTab(index)}
            >
              {t}
            </button>
          ))}
        </div>
      </PageActions>
      <PageActions placement="meta">
        {follow.edit.editing ? (
          <button className="briefing-edit-done" onClick={follow.finishEditing}>
            完成
          </button>
        ) : (
          <button
            className="briefing-refresh-button"
            aria-label={state.scenario === 'ninepop' ? '刷新智能画报' : '刷新智能画报（演示）'}
            title="刷新画报内容"
            disabled={refresh.active || !!detail || !!hiddenGroup || arranging}
            onClick={refresh.refresh}
          >
            <RefreshCw size={17} />
          </button>
        )}
      </PageActions>
      {follow.undo &&
        createPortal(
          <div className="briefing-layout-notice" role="status">
            <span>{follow.undo.text}</span>
            <button onClick={follow.restore}>撤销</button>
          </div>,
          document.body,
        )}
      <div className="briefing-refresh-space" style={{ height: `${refresh.distance}px` }} aria-hidden="true">
        <div className="briefing-refresh-indicator">
          {refresh.phase === 'refreshing' ? (
            <RefreshCw className="briefing-refresh-spinner" size={17} />
          ) : refresh.phase === 'done' ? (
            <Check size={17} />
          ) : (
            <ArrowDown
              size={17}
              style={{ transform: `rotate(${Math.min(1, refresh.distance / 64) * 180}deg)` }}
            />
          )}
          <span>
            {refresh.phase === 'refreshing'
              ? '正在刷新'
              : refresh.phase === 'done'
                ? '已更新排列'
                : refresh.phase === 'ready'
                  ? '松开刷新'
                  : '下拉刷新'}
          </span>
        </div>
      </div>
      <span className="briefing-sr-only" role="status" aria-live="polite">
        {refresh.announcement}
      </span>
      <div
        className="briefing-panel"
        id="briefing-panel"
        role="tabpanel"
        aria-label={`${tab}画报`}
        inert={refresh.active && refresh.phase !== 'pulling' && refresh.phase !== 'ready'}
      >
        {tab === '类型' && (
          <div className="briefing-filters" aria-label="内容类型">
            {['全部', ...visibleTypes].map((t) => (
              <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {tab === '空间' && (
          <div className="briefing-filters">
            <label>
              工作空间
              <select aria-label="画报工作空间" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">全部空间</option>
                <option value="personal">个人空间</option>
                {visibleSpaces(state).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {tab === '日期' && (
          <div className="briefing-filters briefing-date-filter">
            <button aria-pressed={!day} onClick={() => setDay('')}>
              全部日期
            </button>
            <label>
              产生日期
              <input
                type="date"
                aria-label="产生日期"
                value={day}
                max={localDate(new Date().toISOString())}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <span>查找当天产生的内容；数据卡在推荐、关注或类型中查看最新状态。</span>
            <div className="briefing-date-shortcuts">
              {dates.slice(0, 3).map((d) => (
                <button key={d} aria-pressed={day === d} onClick={() => setDay(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === '关注' && entries.length > 0 && (
          <div className="briefing-follow-controls">
            <p className="briefing-view-note">拖动卡片调整位置，拖动右下角调整大小；触屏长按后调整。</p>
            {follow.hasLayout && (
              <button disabled={arranging} onClick={follow.reset}>
                恢复自动排列
              </button>
            )}
          </div>
        )}
        {groups.map((group) => {
          const visible = group.entries.filter((e) => !e.card.hidden);
          const hiddenDays = groupBriefingEntries(
            group.entries.filter((e) => e.card.hidden),
            '最新',
          );
          // Ignore legacy manual sizes/positions for automatic layout, retaining
          // old stored preferences and all source snapshots for compatibility.
          const automatic = visible.map((entry) => ({
            ...entry,
            card: { ...entry.card, config: undefined },
          }));
          const placements = (
            tab === '关注'
              ? follow.placements
              : layoutBriefingSpread(automatic, columns, false, {}, undefined, undefined, false, fit)
          ).map((p) => ({ ...p, entry: visible.find((e) => e.card.id === p.entry.card.id)! }));
          const piles = hiddenPilePositions(placements, columns, hiddenDays.length);
          return (
            <section
              className="briefing-date-group"
              key={group.id}
              aria-label={`${group.label} 的画报`}
              data-recommendation-group={tab === '推荐' ? group.id : undefined}
            >
              <div className="briefing-date-divider">
                {group.day ? (
                  <time dateTime={group.day}>
                    {group.day === localDate(new Date().toISOString())
                      ? '今天'
                      : group.day.replaceAll('-', ' / ')}
                  </time>
                ) : (
                  <strong>{group.label}</strong>
                )}
                {group.day && relativeBriefingDay(group.day) && (
                  <small>{relativeBriefingDay(group.day)}</small>
                )}
                <small>{visible.length} 则</small>
              </div>
              <div className="briefing-grid" data-group-id={group.id}>
                {placements.map((placement) => (
                  <Card
                    key={placement.entry.card.id}
                    {...placement.entry}
                    placement={placement}
                    follow={tab === '关注' ? follow : undefined}
                    onOpen={(reference, trigger) => {
                      detailTrigger.current = trigger;
                      setDetail(reference);
                    }}
                  />
                ))}
                {hiddenDays.map((hidden, index) => (
                  <HiddenPile
                    key={hidden.id}
                    entries={hidden.entries}
                    day={hidden.day!}
                    position={piles[index]}
                    onOpen={(trigger) => {
                      hiddenTrigger.current = trigger;
                      setHiddenGroup({ groupId: group.id, day: hidden.day! });
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {!entries.length && (
          <Empty
            icon={Newspaper}
            title={tab === '关注' ? '把关心的变化留在这里' : '这个分类暂时没有卡片'}
            text="可以切换分类，继续浏览已有内容。"
          >
            <Button onClick={() => selectTab(0)}>返回推荐</Button>
          </Empty>
        )}
      </div>
      {hiddenGroup && hiddenEntries.length > 0 && (
        <HiddenCards
          entries={hiddenEntries}
          day={hiddenGroup.day}
          onClose={() => {
            setHiddenGroup(null);
            requestAnimationFrame(() => hiddenTrigger.current?.focus({ preventScroll: true }));
          }}
        />
      )}
      {detail && (
        <BriefingDetail
          key={`${detail.cardId}:${detail.asOf}`}
          reference={detail}
          onClose={closeDetail}
          onEnterConversation={() => setDetail(null)}
          returnFocus={detailTrigger.current}
        />
      )}
    </div>
  );
}
