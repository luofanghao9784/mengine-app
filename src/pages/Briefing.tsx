import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Ellipsis,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  X,
  Newspaper,
  MessageSquare,
  RefreshCw,
  ArrowDown,
  Check,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import {
  hiddenPilePositions,
  type BriefingEntry,
  groupBriefingEntries,
  layoutBriefingSpread,
  relativeBriefingDay,
  type Placement,
  saveBriefingLayout,
  refreshConversationLayout,
  type BriefingSavedLayout,
} from '../briefingLayout';
import { briefingPhoto, briefingPeople, briefingDocuments, type BriefingPhoto } from '../briefingMedia';
import { visibleSpaces } from '../libraryModel';
import { BriefingCardPeople, BriefingDocumentCovers } from '../components/BriefingMedia';
import { Button, Empty, Modal, PageActions } from '../components/ui';
import { BriefingResizeHandle, useBriefingResize, type BriefingResize } from '../components/BriefingResize';
import { useBriefingMove, useBriefingEdit, type BriefingMove } from '../components/BriefingMove';
import { captureBriefingVisual } from '../components/conversationMotion';
import { useBriefingTabs } from '../components/useBriefingTabs';
import { useBriefingRefresh } from '../components/useBriefingRefresh';
import { briefingPresentation } from '../briefingPresentation';
import { BriefingDesignedBody } from '../components/BriefingDesignedBody';
import {
  cardConfig,
  canReadCardData,
  cardTypes,
  localDate,
  openBriefingChat,
  snapshotOn,
  type BriefingCard,
  type CardConfig,
  type CardData,
} from '../briefing';

function NewsPhoto({ photo }: { photo: BriefingPhoto }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo.src]);
  if (failed) return null;
  return (
    <figure className="briefing-news-photo">
      {failed ? (
        <div className="briefing-photo-fallback" role="img" aria-label="资讯配图暂不可用">
          图片暂不可用
        </div>
      ) : (
        <img
          src={photo.src}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ objectFit: photo.fit || 'cover' }}
          onError={() => setFailed(true)}
        />
      )}
    </figure>
  );
}

export function BriefingCardBody({ data, config, at }: { data: CardData; config: CardConfig; at: string }) {
  const { state } = useDemo();
  if (data.template === 'conversation')
    return (
      <>
        <div className="briefing-card-eyebrow">
          <span className="briefing-card-meta briefing-conversation-meta">
            <MessageSquare size={13} aria-hidden="true" />
            <span>活跃会话</span>
            <time dateTime={at}>
              {new Date(at).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </time>
          </span>
        </div>
        <div className={`briefing-conversation-content ${config.compact ? 'is-compact' : ''}`}>
          <h3>{config.title}</h3>
          <span className="briefing-reply-label">AI 最新回复</span>
          <p className="briefing-reply-preview">{data.fact}</p>
        </div>
        <small className="briefing-source briefing-conversation-footer">
          <span>{data.source}</span>
          <span>
            继续对话 <span aria-hidden="true">↗</span>
          </span>
        </small>
      </>
    );
  const presentation = briefingPresentation(data);
  if (presentation)
    return <BriefingDesignedBody data={data} config={config} at={at} presentation={presentation} />;
  const photo = briefingPhoto(data);
  const people = briefingPeople(state, data);
  const large = config.size.endsWith('2') && !config.compact;
  const documents =
    ['chart', 'trend', 'progress', 'editorial'].includes(data.template) || (data.template === 'list' && large)
      ? []
      : briefingDocuments(state, data);
  const documentPreview = documents.length > 0;
  const project = data.template === 'progress';
  return (
    <>
      {photo && <NewsPhoto photo={photo} />}
      <div className="briefing-card-eyebrow">
        <span className="briefing-card-meta">
          <span>{data.type}</span>
          <time dateTime={at}>
            {new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </time>
        </span>
        {people.length > 0 && (
          <span
            className="briefing-people-placeholder"
            aria-hidden="true"
            style={{ width: Math.min(people.length, 4) * 19 + 9 }}
          />
        )}
      </div>
      <div className={`briefing-card-content ${documentPreview ? 'with-document' : ''}`}>
        <div className="briefing-copy">
          <h3>{config.title}</h3>
          {data.value && data.template !== 'chart' && (
            <div className={`briefing-value ${Number.isNaN(Number(data.value)) ? 'text-value' : ''}`}>
              <strong>{data.value}</strong>
              <span>{data.unit}</span>
            </div>
          )}
          {project ? (
            <div className="briefing-project-state">
              <p className="briefing-phase">{data.fact.replace(/^当前阶段：/, '').replace(/。$/, '')}</p>
              <span className="briefing-target">
                计划交付<strong>{data.items?.find((x) => x.label === '交付日期')?.value}</strong>
              </span>
            </div>
          ) : (
            <p className="briefing-fact">{data.fact}</p>
          )}
          {project && <div className="briefing-milestone" aria-hidden="true" />}
          {data.template === 'trend' && large && (
            <div
              className="briefing-trend"
              role="img"
              aria-label={`${data.title}：${data.items?.map((x) => `${x.label} ${x.value}${data.unit || ''}`).join('，')}`}
            >
              {data.items?.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span>
                    <i
                      style={{
                        height: `${(Number(item.value) / Math.max(...data.items!.map((x) => Number(x.value)), 1)) * 100}%`,
                      }}
                    />
                  </span>
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          )}
          {data.template === 'chart' && (
            <div className="briefing-chart" aria-label={`${data.title}，单位：${data.unit || '项'}`}>
              {data.items?.map((item) => (
                <div key={item.label}>
                  <div className="briefing-chart-label">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <span className="briefing-bar">
                    <i
                      style={{
                        width: `${Number(data.value) ? (Number(item.value) / Number(data.value)) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          {large && !photo && data.items && !['chart', 'trend'].includes(data.template) && (
            <div className={`briefing-items ${data.template === 'editorial' ? 'editorial-items' : ''}`}>
              {data.items
                .filter((item) => !project || item.label !== '交付日期')
                .map((item) => (
                  <div key={item.label}>
                    <strong>{item.label}</strong>
                    <p>{item.value}</p>
                  </div>
                ))}
            </div>
          )}
          {!config.compact && data.advice && <p className="briefing-advice">{data.advice}</p>}
        </div>
        {documentPreview && <BriefingDocumentCovers documents={documents} />}
      </div>
      <small className="briefing-source" title={data.source}>
        {data.source}
        {photo && (
          <span className="briefing-photo-credit" title={photo.sourceUrl}>
            {photo.credit}
          </span>
        )}
      </small>
    </>
  );
}

function Card({
  card,
  data,
  at,
  historical,
  placement,
  resize,
  groupId,
  move,
  editing,
  onResetLayout,
  hasLayout,
}: {
  card: BriefingCard;
  data: CardData;
  at: string;
  historical: boolean;
  placement: Placement;
  resize: BriefingResize;
  groupId: string;
  move: BriefingMove;
  editing: boolean;
  onResetLayout: () => void;
  hasLayout: boolean;
}) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!editing) setMenu(false);
  }, [editing]);
  const ref = useRef<HTMLElement>(null);
  const config = historical
    ? { size: placement.size, title: data.title, compact: false }
    : { ...cardConfig(card), size: placement.size };
  const hasChat = state.chats.some((c) => c.id === card.chatId);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(false);
        ref.current?.querySelector<HTMLButtonElement>('.briefing-menu-button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const update = (fn: (c: BriefingCard) => void) =>
    change((s) => fn(s.briefing!.cards.find((c) => c.id === card.id)!));
  const open = (purpose: 'content' | 'optimize') => {
    const visual = purpose === 'content' && ref.current ? captureBriefingVisual(ref.current) : undefined;
    const id = change((s) =>
      openBriefingChat(
        s,
        card.id,
        purpose,
        historical && purpose === 'content' ? { at, data } : undefined,
        purpose === 'content' || !historical ? config : undefined,
      ),
    );
    ui.preview(null);
    ui.go(
      `chat/${id}`,
      purpose === 'content' && ref.current
        ? {
            element: ref.current,
            visual,
            reference: {
              cardId: card.id,
              asOf: at,
              snapshot: structuredClone(data),
              config: structuredClone(config),
            },
          }
        : undefined,
    );
  };
  return (
    <article
      ref={ref}
      className={`briefing-card template-${data.template} ${menu ? 'menu-open' : ''} ${resize.preview?.id === card.id ? 'is-resizing' : ''} ${move.preview?.id === card.id ? (move.preview.pointer ? 'is-moving' : 'is-keyboard-moving') : ''}`}
      data-card-id={card.id}
      data-size={config.size}
      style={{
        gridColumn: `${placement.col + 1} / span ${placement.width}`,
        gridRow: `${placement.row + 1} / span ${placement.height}`,
      }}
    >
      <button
        className="briefing-card-main"
        aria-describedby="briefing-move-help"
        onPointerDown={(event) => move.start(event, card.id, groupId)}
        onKeyDown={(event) => move.keyDown(event, card.id)}
        aria-label={`${config.title}${hasChat ? '，已有会话' : ''}`}
        onClick={() => {
          if (!editing) open('content');
        }}
      >
        <BriefingCardBody data={data} config={config} at={at} />
        {hasChat && data.sourceKind !== 'conversation' && (
          <span className="briefing-conversation-mark" title="已有会话" role="img" aria-label="已有会话">
            <MessageSquare size={17} fill="none" strokeWidth={2} />
          </span>
        )}
      </button>
      <BriefingCardPeople data={data} />
      <BriefingResizeHandle
        id={card.id}
        title={config.title}
        size={config.size}
        resize={resize}
        disabled={!!move.preview}
        position={{ groupId, row: placement.row, col: placement.col }}
      />
      <div className="briefing-card-tools">
        <button
          title={card.pinned ? '取消关注' : '固定到关注'}
          aria-label={`${card.pinned ? '取消关注' : '固定到关注'} ${config.title}`}
          aria-pressed={card.pinned}
          onClick={() => {
            update((c) => {
              c.pinned = !c.pinned;
            });
            ui.toast(card.pinned ? '已取消关注' : '已加入关注，仍保留在最新中');
          }}
        >
          {card.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
        <button
          className="briefing-menu-button"
          title="卡片操作"
          aria-label={`卡片操作 ${config.title}`}
          aria-expanded={menu}
          aria-controls={`card-menu-${card.id}`}
          onClick={() => setMenu(!menu)}
        >
          <Ellipsis size={18} />
        </button>
      </div>
      {menu && (
        <div className="briefing-card-menu" id={`card-menu-${card.id}`} aria-label="卡片操作">
          <button
            onClick={() => {
              setMenu(false);
              requestAnimationFrame(() => {
                const surface = ref.current?.querySelector<HTMLButtonElement>('.briefing-card-main');
                if (surface) move.startKeyboard(surface, card.id, groupId);
              });
            }}
          >
            用方向键调整位置
          </button>
          {hasLayout && (
            <button
              onClick={() => {
                setMenu(false);
                onResetLayout();
              }}
            >
              <RotateCcw size={15} />
              恢复本组自动排列
            </button>
          )}
          <button onClick={() => open('optimize')}>
            <Sparkles size={15} />让 AI 优化卡片
          </button>
          <button
            onClick={() => {
              update((c) => {
                c.hidden = true;
              });
              setMenu(false);
              ui.toast('已收进当天末尾的「已隐藏」卡片，可随时恢复');
            }}
          >
            <X size={15} />
            隐藏卡片
          </button>
        </div>
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
              <span>{entry.data.type}</span>
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
      <p className="briefing-hidden-note">仅从画报隐藏，事项和会话均保留。恢复后继续显示在原日期下。</p>
      <ul className="briefing-hidden-list">
        {entries.map(({ card, data }) => (
          <li key={card.id}>
            <div>
              <strong>{card.config?.title || data.title}</strong>
              <small>
                {data.type} · {data.source}
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

const tabs = ['最新', '关注', '日期', '类型', '空间'] as const;
export function Briefing() {
  const { state, change } = useDemo();
  const ui = useUI();
  const routeScope = ui.route.split('/')[1];
  const saved = ui.briefingViews.current[ui.route];
  const [tab, setTab] = useState<(typeof tabs)[number]>(saved?.tab || (routeScope ? '空间' : '最新'));
  const [type, setType] = useState<string>(saved?.type || '全部');
  const [scope, setScope] = useState(saved?.scope || routeScope || 'all');
  const [day, setDay] = useState(saved?.day || localDate(new Date().toISOString()));
  const [hiddenGroup, setHiddenGroup] = useState<{ groupId: string; day: string } | null>(null);
  const hiddenTrigger = useRef<HTMLButtonElement | null>(null);
  const closeHidden = () => {
    setHiddenGroup(null);
    requestAnimationFrame(() => hiddenTrigger.current?.focus({ preventScroll: true }));
  };
  const view = useRef({ tab, type, scope, day, closed: false, scrollTop: saved?.scrollTop || 0 });
  view.current = { ...view.current, tab, type, scope, day, closed: false };
  const live = (state.briefing?.cards || []).filter((c) => c.active);
  const dates = [...new Set(live.flatMap((c) => c.history.map((h) => localDate(h.at))))].sort().reverse();
  const entries = live
    .filter((c) => tab !== '关注' || c.pinned)
    .flatMap((card) => {
      const snapshot = tab === '日期' ? snapshotOn(card, day) : { data: card.data, at: card.updatedAt };
      return snapshot && canReadCardData(state, snapshot.data) ? [{ card, ...snapshot }] : [];
    })
    .filter(
      ({ data }) =>
        (tab !== '类型' || type === '全部' || data.type === type) &&
        (tab !== '空间' || scope === 'all' || data.space === scope),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const groups = groupBriefingEntries(entries, tab, false, {
    personal: '个人空间',
    ...Object.fromEntries(visibleSpaces(state).map((s) => [s.id, s.name])),
  });
  const pageRef = useRef<HTMLDivElement>(null);
  const [{ columns, unit, ready: gridReady }, setGrid] = useState({ columns: 5, unit: 248, ready: false });
  const viewKey = JSON.stringify([
    ui.route,
    tab,
    tab === '类型' ? type : '',
    tab === '空间' ? scope : '',
    tab === '日期' ? day : '',
  ]);
  const layoutKey = (groupId: string) => JSON.stringify([tab, tab === '日期' ? day : '', groupId]);
  const savedLayout = (groupId: string) => {
    const saved = state.briefing?.layouts?.[layoutKey(groupId)];
    return tab === '最新' ? refreshConversationLayout(visibleEntries(groupId), saved) : saved;
  };
  const visibleEntries = (groupId: string) =>
    groups.find((g) => g.id === groupId)?.entries.filter((e) => !e.card.hidden) || [];
  const edit = useBriefingEdit(pageRef, viewKey, ui.conversationOpen);
  const [undo, setUndo] = useState<{ key: string; previous?: BriefingSavedLayout; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    setUndo(null);
  }, [viewKey]);
  const resize = useBriefingResize({
    page: pageRef,
    columns,
    unit,
    viewKey,
    onCommit: (id, size, position) => {
      const placements = layoutBriefingSpread(
        visibleEntries(position.groupId),
        columns,
        tab === '日期',
        { [id]: size },
        { id, row: position.row, col: position.col },
        savedLayout(position.groupId),
      );
      setUndo(null);
      change((s) => {
        const card = s.briefing!.cards.find((c) => c.id === id);
        if (card?.active && !card.hidden) {
          card.config = { ...cardConfig(card), size };
          (s.briefing!.layouts ||= {})[layoutKey(position.groupId)] = saveBriefingLayout(
            placements,
            columns,
            [id, ...(savedLayout(position.groupId)?.manual || [])],
          );
        }
      });
    },
  });
  const move = useBriefingMove({
    page: pageRef,
    columns,
    unit,
    viewKey,
    blocked: ui.conversationOpen || !!resize.preview || !!hiddenGroup,
    manual: (groupId) => savedLayout(groupId)?.manual || [],
    placements: (groupId) =>
      layoutBriefingSpread(
        visibleEntries(groupId),
        columns,
        tab === '日期',
        {},
        resize.layoutAnchor(groupId),
        savedLayout(groupId),
      ),
    onStart: () => resize.clearAnchors(),
    onTouchHold: () => edit.setEditing(true),
    onCommit: (preview) => {
      const key = layoutKey(preview.groupId);
      const placements = layoutBriefingSpread(
        visibleEntries(preview.groupId),
        columns,
        tab === '日期',
        { [preview.id]: preview.size },
        preview,
        preview.baseline,
      );
      setUndo({ key, previous: savedLayout(preview.groupId), text: '位置已保存' });
      change((s) => {
        (s.briefing!.layouts ||= {})[key] = saveBriefingLayout(placements, columns, [
          preview.id,
          ...(preview.baseline.manual || []),
        ]);
      });
    },
  });
  const finishEditing = () => {
    move.cancel();
    resize.cancel();
    edit.setEditing(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const resetLayout = (groupId: string) => {
    move.capture();
    resize.clearAnchors();
    const key = layoutKey(groupId);
    setUndo({ key, previous: savedLayout(groupId), text: '已恢复本组自动排列' });
    change((s) => {
      if (s.briefing?.layouts) delete s.briefing.layouts[key];
    });
  };
  const refresh = useBriefingRefresh({
    page: pageRef,
    ready: gridReady,
    viewKey,
    blocked: ui.conversationOpen || !!resize.preview || !!move.preview || !!hiddenGroup || edit.editing,
  });
  const selectTab = useBriefingTabs({
    page: pageRef,
    index: tabs.indexOf(tab),
    count: tabs.length,
    blocked:
      ui.conversationOpen ||
      !!resize.preview ||
      !!move.preview ||
      !!hiddenGroup ||
      edit.editing ||
      refresh.active,
    onSelect: (index) => {
      view.current.scrollTop = 0;
      pageRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'instant' });
      setTab(tabs[index]);
    },
  });
  const sizeOverrides =
    resize.preview && resize.preview.size !== resize.preview.initial
      ? { [resize.preview.id]: resize.preview.size }
      : {};
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
      className={`briefing-page ${resize.preview ? 'is-resizing' : ''} ${move.preview ? 'is-moving' : ''} ${edit.editing ? 'is-editing' : ''} ${refresh.active ? 'is-refreshing' : ''}`}
      ref={pageRef}
      data-briefing-arriving={refresh.arriving || undefined}
      data-refresh-phase={refresh.phase}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && edit.editing && !move.preview && !resize.preview) finishEditing();
      }}
      style={{ '--briefing-columns': columns, '--briefing-unit': `${unit}px` } as CSSProperties}
    >
      <span id="briefing-resize-help" className="briefing-sr-only">
        拖动右下角把手调整大小，松手保存，Esc 取消。也可用方向键改变宽度或高度。
      </span>
      <span className="briefing-sr-only" role="status" aria-live="polite">
        {move.preview
          ? move.announcement
          : resize.preview
            ? resize.announcement
            : edit.editing
              ? '正在调整画报，完成后点击右上角完成'
              : move.announcement || resize.announcement}
      </span>
      <span id="briefing-move-help" className="briefing-sr-only">
        鼠标直接拖动卡片，在当前分组内调整位置，松手保存，Esc 取消。触屏每次静止长按后拖动，普通滑动仍可滚动。
        也可从卡片操作选择用方向键调整位置，方向键移动，回车或空格放下。
      </span>
      {resize.preview && (
        <div ref={resize.hint} className="briefing-resize-hint" aria-hidden="true">
          {resize.preview.size}
        </div>
      )}
      <PageActions>
        <div role="tablist" aria-label="画报分类" className="briefing-tabs">
          {tabs.map((t, index) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              aria-controls="briefing-panel"
              disabled={edit.editing || refresh.active}
              onClick={() => selectTab(index)}
            >
              {t}
            </button>
          ))}
        </div>
      </PageActions>
      <PageActions placement="meta">
        {edit.editing ? (
          <button className="briefing-edit-done" onClick={finishEditing}>
            完成
          </button>
        ) : (
          <button
            className="briefing-refresh-button"
            aria-label="刷新智能画报（演示）"
            title="刷新画报，也可在顶部下拉刷新（演示）"
            disabled={refresh.active || !!move.preview || !!resize.preview || !!hiddenGroup}
            onClick={refresh.refresh}
          >
            <RefreshCw size={17} />
          </button>
        )}
      </PageActions>
      {undo &&
        createPortal(
          <div className="briefing-layout-notice" role="status">
            <span>{undo.text}</span>
            <button
              onClick={() => {
                move.cancel();
                move.capture();
                resize.clearAnchors();
                change((s) => {
                  const layouts = (s.briefing!.layouts ||= {});
                  if (undo.previous) layouts[undo.key] = undo.previous;
                  else delete layouts[undo.key];
                });
                setUndo(null);
              }}
            >
              撤销
            </button>
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
              ? '正在刷新 · 演示'
              : refresh.phase === 'done'
                ? '刷新演示完成'
                : refresh.phase === 'ready'
                  ? '松开刷新'
                  : '下拉刷新'}
          </span>
        </div>
      </div>
      <span className="briefing-sr-only" role="status" aria-live="polite">
        {refresh.phase === 'ready' ? '松开刷新智能画报' : refresh.announcement}
      </span>
      <div
        className="briefing-panel"
        id="briefing-panel"
        role="tabpanel"
        aria-label={`${tab}画报`}
        inert={refresh.phase === 'refreshing' || refresh.phase === 'done'}
      >
        {tab === '类型' && (
          <div className="briefing-filters" aria-label="内容类型">
            {['全部', ...cardTypes].map((t) => (
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
            <span>按卡片所属空间筛选</span>
          </div>
        )}
        {tab === '日期' && (
          <div className="briefing-filters briefing-date-filter">
            <label>
              回看日期
              <input
                type="date"
                aria-label="回看日期"
                value={day}
                max={localDate(new Date().toISOString())}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <span>截至当日最后一次留存 · 未留存的历史不补造</span>
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
          <p className="briefing-view-note">已固定的卡片集中在这里，仍会出现在「最新」。</p>
        )}
        {groups.map((group) => {
          const visible = group.entries.filter((e) => !e.card.hidden);
          const hiddenDays = groupBriefingEntries(
            group.entries.filter((e) => e.card.hidden),
            '最新',
          );
          const placements = layoutBriefingSpread(
            visible,
            columns,
            tab === '日期',
            move.preview?.groupId === group.id ? { [move.preview.id]: move.preview.size } : sizeOverrides,
            move.preview?.groupId === group.id ? move.preview : resize.layoutAnchor(group.id),
            move.preview?.groupId === group.id ? move.preview.baseline : savedLayout(group.id),
          );
          const piles = hiddenPilePositions(placements, columns, hiddenDays.length);
          return (
            <section className="briefing-date-group" key={group.id} aria-label={`${group.label} 的画报`}>
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
                  <small className="briefing-relative-day">{relativeBriefingDay(group.day)}</small>
                )}
                <small>{visible.length} 则</small>
              </div>
              <div className="briefing-grid" data-group-id={group.id}>
                {placements.map((placement) => (
                  <Card
                    key={placement.entry.card.id}
                    {...placement.entry}
                    placement={placement}
                    groupId={group.id}
                    historical={tab === '日期'}
                    resize={resize}
                    move={move}
                    editing={edit.editing}
                    hasLayout={!!savedLayout(group.id)}
                    onResetLayout={() => resetLayout(group.id)}
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
            title={
              tab === '关注'
                ? '把关心的变化留在这里'
                : tab === '日期'
                  ? '这一天还没有留存快照'
                  : '这个分类暂时没有卡片'
            }
            text={tab === '关注' ? '在卡片上选择固定，即可加入关注。' : '可以切换分类，继续浏览已有内容。'}
          >
            <Button
              onClick={() => {
                selectTab(0);
              }}
            >
              返回最新
            </Button>
          </Empty>
        )}
      </div>
      {hiddenGroup && hiddenEntries.length > 0 && (
        <HiddenCards entries={hiddenEntries} day={hiddenGroup.day} onClose={closeHidden} />
      )}
    </div>
  );
}
