import {
  createContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import { usePersonalBriefingLayout, type FollowPreference } from '../components/useBriefingFollowLayout';
import { BriefingResizeHandle } from '../components/BriefingResize';
import { useBriefingCardFit } from '../components/useBriefingCardFit';
import type { BriefingEntry } from '../briefingLayout';
import type { CardData, CardSize } from '../briefing';
import { magazineGridMetrics } from '../briefingGrid';
import type { MagazineGridItem } from './MagazineGrid';
import { Button } from '../shared/ui';
import './follow-grid.css';

type Interaction = {
  editing: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};
export const FollowInteraction = createContext<Interaction | undefined>(undefined);
export function FollowGrid({
  items,
  saved,
  onSave,
  owner,
  blocked,
  onArranging,
}: {
  items: MagazineGridItem[];
  saved?: FollowPreference;
  onSave: (value: FollowPreference | undefined) => void | Promise<boolean>;
  owner: string;
  blocked: boolean;
  onArranging: (active: boolean) => void;
}) {
  const page = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ columns: 1, unit: 254 });
  useLayoutEffect(() => {
    const element = page.current!;
    const measure = () => {
      const next = magazineGridMetrics(element.clientWidth);
      if (next.unit > 0)
        setMetrics((old) => (old.columns === next.columns && old.unit === next.unit ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const defaults: Record<string, CardSize> = Object.fromEntries(
    items.map((item) => [
      item.id,
      item.chart ? '2×2' : item.wide || item.title.length > 28 || item.summary.length > 110 ? '2×1' : '1×1',
    ]),
  );
  // Geometry adapter only: all displayed contents continue to come from the authorized live feed.
  const entries: BriefingEntry[] = items.map((item) => {
    const data: CardData = {
      id: item.id,
      title: item.title,
      fact: item.summary,
      advice: '',
      source: '',
      space: '',
      type: '知识洞察',
      template: 'editorial',
      size: defaults[item.id],
      sourceKind: 'request',
      sourceId: item.id,
      prompts: [],
    };
    return {
      at: '',
      data,
      card: { id: item.id, data, updatedAt: '', history: [], active: true, pinned: true, hidden: false },
    };
  });
  const measuredMinimum = useBriefingCardFit(
    page,
    JSON.stringify([items.map((i) => [i.id, i.title, i.summary]), metrics, saved?.sizes]),
    metrics.columns,
    metrics.unit,
    { cards: '.live-follow-tile', button: '.live-briefing-body', growVertically: true },
  );
  // Follow cards never exceed the four supported grid sizes, even for long titles.
  const minimum = Object.fromEntries(
    Object.entries(measuredMinimum).map(([id, fit]) => [
      id,
      { ...fit, ...(fit.rows ? { rows: Math.min(2, fit.rows) } : {}) },
    ]),
  );
  const follow = usePersonalBriefingLayout({
    page,
    ...metrics,
    viewKey: owner,
    owner,
    saved,
    onSave,
    entries,
    enabled: true,
    editingBlocked: false,
    blocked,
    minimum,
    defaultSizes: defaults,
    reflowSelector: '.live-follow-grid > *',
    cardSelector: '.live-follow-tile',
    surfaceSelector: '.live-briefing-body',
    dragLayerClass: 'briefing-drag-layer live-follow-drag live-magazine-grid',
  });
  const arranging = follow.edit.editing || !!follow.move.preview || !!follow.resize.preview;
  useLayoutEffect(() => {
    onArranging(arranging);
    return () => onArranging(false);
  }, [arranging, onArranging]);
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <div ref={page} className={`live-follow-board ${follow.edit.editing ? 'is-editing' : ''}`}>
      {follow.edit.editing && (
        <div className="live-follow-edit-control">
          <Button onClick={follow.finishEditing}>完成</Button>
        </div>
      )}
      <p className="sr-only" id="briefing-resize-help">
        拖动右下角或使用方向键调整大小，Escape 取消。
      </p>
      <p className="sr-only" id="briefing-move-help">
        拖动卡片移动；触屏长按进入编辑；Alt+Enter 拿起，方向键移动，Enter 放下，Escape 取消。
      </p>
      <span className="sr-only" role="status">
        {follow.move.announcement.replace('位置已保存，可撤销本次调整', '位置已调整') ||
          follow.resize.announcement}
      </span>
      <div
        className="live-briefing-grid live-magazine-grid live-follow-grid"
        data-group-id="following"
        style={
          { '--briefing-columns': metrics.columns, '--briefing-unit': `${metrics.unit}px` } as CSSProperties
        }
      >
        {follow.placements.map((p) => {
          const id = p.entry.card.id,
            item = byId.get(id)!;
          const moving = follow.move.preview?.id === id,
            resizing = follow.resize.preview?.id === id;
          return (
            <div
              key={id}
              data-card-id={id}
              data-size={p.size}
              data-layout-editable="true"
              className={`live-briefing-tile live-follow-tile ${moving ? 'is-moving' : ''} ${resizing ? 'is-resizing' : ''}`}
              style={{
                gridColumn: `${p.col + 1} / span ${p.width}`,
                gridRow: `${p.row + 1} / span ${p.height}`,
              }}
            >
              <FollowInteraction.Provider
                value={{
                  editing: follow.edit.editing,
                  onPointerDown: (event) => follow.move.start(event, id, 'following'),
                  onKeyDown: (event) => {
                    if (event.altKey && event.key === 'Enter' && !follow.move.preview) {
                      event.preventDefault();
                      follow.move.startKeyboard(event.currentTarget, id, 'following');
                    } else follow.move.keyDown(event, id);
                  },
                }}
              >
                {item.render}
              </FollowInteraction.Provider>
              <BriefingResizeHandle
                id={id}
                title={item.title}
                size={p.size}
                resize={follow.resize}
                disabled={blocked || !!follow.move.preview}
                position={{ groupId: 'following', row: p.row, col: p.col }}
              />
            </div>
          );
        })}
      </div>
      {follow.resize.preview && (
        <div ref={follow.resize.hint} className="briefing-resize-hint" aria-hidden="true">
          {follow.resize.preview.size}
        </div>
      )}
    </div>
  );
}
