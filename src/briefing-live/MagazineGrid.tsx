import { legacyEditorialLayout, verificationEditionSize } from './editorial-policy';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CardSize } from '../briefing';
import { fillMagazineGaps, magazineGap, magazineGridMetrics, magazineZoom, packMagazineTiles } from '../briefingGrid';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import { useBriefingCardFit } from '../components/useBriefingCardFit';
import './magazine-grid.css';
import type { CardPresentation } from './card-presentation';

export type MagazineGridItem = {
  id: string;
  title: string;
  summary: string;
  chart?: boolean;
  news?: boolean;
  wide?: boolean;
  fixedSize?: CardSize;
  atEnd?: boolean;
  render: ReactNode;
};
const selectors = { cards: '.live-briefing-tile', button: '.live-briefing-body', growVertically: false, maxRows: 2 };
export function MagazineGrid({
  items,
  sizing = 'container',
  presentation,
  interactive = true,
  minimumColumns = 1,
  minimumRows = 0,
  preserveUnit = false,
  preserveSpans = false,
  preview,
}: {
  items: MagazineGridItem[];
  sizing?: 'container' | 'workspace';
  presentation?: CardPresentation;
  interactive?: boolean;
  minimumColumns?: number;
  minimumRows?: number;
  preserveUnit?: boolean;
  preserveSpans?: boolean;
  preview?: {
    rows: number;
    total: number;
    label: string;
    controls: string;
    disabled: boolean;
    expand: () => void;
  };
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ columns: 1, unit: 254 });
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const canvas = sizing === 'workspace' ? element.closest<HTMLElement>('.access-content') : null;
    // The magazine canvas always reserves a vertical scrollbar. WebKit may
    // give it physical width even when the conversation canvas is not scrolling.
    let scrollbarWidth = 0;
    if (canvas && !preserveUnit) {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:-10000px;width:100px;height:100px;overflow-y:scroll;visibility:hidden';
      document.body.append(probe);
      scrollbarWidth = probe.offsetWidth - probe.clientWidth;
      probe.remove();
    }
    const measure = () => {
      const padding = canvas && getComputedStyle(canvas);
      const canvasWidth =
        canvas && padding
          ? Math.min(
              1600,
              canvas.clientWidth -
                parseFloat(padding.paddingLeft) -
                parseFloat(padding.paddingRight) -
                scrollbarWidth,
            )
          : element.clientWidth;
      const base = magazineGridMetrics(canvasWidth, 2);
      const requiredColumns = Math.max(
        minimumColumns,
        ...items.map((item) => Number(item.fixedSize?.[0] || 1)),
      );
      const previewUnit = preserveUnit
        ? (presentation?.unit ?? base.unit)
        : Math.min(
            presentation?.unit ?? base.unit,
            (element.clientWidth - (requiredColumns - 1) * magazineGap) / requiredColumns,
          );
      // Conversation previews retain the magazine page's unit size. A narrow
      // reader can hold fewer columns, but a wider reader must not enlarge it.
      const next =
        sizing === 'workspace'
          ? {
              unit: previewUnit,
              columns: Math.max(
                requiredColumns,
                Math.min(
                  base.columns,
                  Math.floor((element.clientWidth + magazineGap + 0.5) / (base.unit + magazineGap)),
                ),
              ),
            }
          : base;
      if (next.unit <= 0) return;
      setMetrics((old) => (old.columns === next.columns && old.unit === next.unit ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [
    sizing,
    presentation?.unit,
    minimumColumns,
    preserveUnit,
    items.map((item) => item.fixedSize).join('|'),
  ]);
  const identity = items.map((i) => i.id + i.title + i.summary + i.wide + i.fixedSize).join('|');
  const fit = useBriefingCardFit(
    grid,
    identity + metrics.columns + ':' + metrics.unit,
    metrics.columns,
    metrics.unit,
    preserveSpans ? { ...selectors, measureFullSummary: true } : selectors,
  );
  const packed = packMagazineTiles(
    items.map((item) => {
      // User-selected sizes for the two historical follow-up recommendations.
      const fixedSize = item.fixedSize ?? verificationEditionSize(item.title) ?? legacyEditorialLayout(item.title);
      const preferred: CardSize =
        fixedSize ||
        (item.chart
          ? '2×2'
          : item.news || item.wide || item.title.length > 28 || item.summary.length > 110
            ? '2×1'
            : '1×1');
      const minimum = fixedSize ? undefined : fit[item.id];
      return {
        id: item.id,
        atEnd: item.atEnd,
        // An automatic horizontal text card can use the same area vertically to
        // fill a one-column gap. The fit observer still checks its actual text.
        alternativeSize: !preserveSpans && !fixedSize && !item.chart && !item.news && !item.wide &&
          Number(preferred[2]) === 1 && (!minimum || Number(minimum.size[2]) === 1) &&
          (preferred[0] === '2' || minimum?.size[0] === '2') ? '1×2' as CardSize : undefined,
        size: (minimum
          ? `${Math.max(Number(preferred[0]), Number(minimum.size[0]))}×${Math.max(Number(preferred[2]), Number(minimum.size[2]))}`
          : preferred) as CardSize,
        fixed: preserveSpans || item.wide || item.news || item.summary.length > 110 || !!fixedSize || !!minimum,
        // The magazine supports only the four standard sizes, even for long content.
        rows: minimum ? Math.min(2, Math.max(Number(minimum.size[2]), minimum.rows || 0)) : undefined,
      };
    }),
    metrics.columns,
    !preserveSpans,
  );
  // 中间不留空格：先撑大相邻卡片，没有可撑大的才放梦擎占位卡。用户指定尺寸的卡片不改。
  const userSized = new Set(
    items
      .filter((item) => item.fixedSize ?? verificationEditionSize(item.title) ?? legacyEditorialLayout(item.title))
      .map((item) => item.id),
  );
  const { placements, fillers } = fillMagazineGaps(
    packed,
    metrics.columns,
    (tile) => preserveSpans || userSized.has(tile.id),
  );
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const previousIdentity = useRef(identity);
  useLayoutEffect(() => {
    // Width and text-fit measurements settle synchronously before paint. Do not
    // animate from the provisional one-column layout on mount or page return.
    const contentChanged = previousIdentity.current !== identity;
    // The page can receive a second ranked snapshot while card fitting settles.
    // Reflow transforms would fly those cards sideways over their arrival motion.
    const animateReflow = !grid.current?.closest('.live-briefing');
    previousIdentity.current = identity;
    const next = new Map<string, { x: number; y: number }>();
    for (const element of grid.current?.querySelectorAll<HTMLElement>('.live-briefing-tile') || []) {
      const id = element.dataset.cardId!,
        position = { x: element.offsetLeft, y: element.offsetTop };
      const old = previous.current.get(id);
      if (
        old &&
        animateReflow &&
        !element.dataset.atEnd &&
        contentChanged &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches &&
        (old.x !== position.x || old.y !== position.y)
      ) {
        element.getAnimations().forEach((a) => a.cancel());
        element.animate(
          [
            { transform: `translate(${old.x - position.x}px, ${old.y - position.y}px)` },
            { transform: 'none' },
          ],
          { duration: 220, easing: 'cubic-bezier(.2,.65,.25,1)' },
        );
      }
      next.set(id, position);
    }
    previous.current = next;
  });
  const content = new Map(items.map((item) => [item.id, item.render]));
  const visible = preview ? placements.filter((p) => p.row + p.height <= preview.rows) : placements;
  const remaining = preview ? Math.max(0, preview.total - visible.length) : 0;
  const stackedId = remaining ? visible.at(-1)?.id : undefined;
  return (
    <div
      ref={grid}
      className="live-briefing-grid live-magazine-grid"
      data-packed="true"
      data-sizing={sizing}
      data-static={!interactive || undefined}
      data-preview-rows={preview?.rows}
      data-visible-count={visible.length}
      style={
        {
          '--briefing-columns': metrics.columns,
          '--briefing-unit': `${metrics.unit}px`,
          '--briefing-zoom': magazineZoom(metrics.unit),
          ...(minimumRows ? { minHeight: minimumRows * (metrics.unit + magazineGap) - magazineGap } : {}),
          ...(preserveUnit ? { minWidth: minimumColumns * (metrics.unit + magazineGap) - magazineGap } : {}),
        } as CSSProperties
      }
    >
      {visible.map((p) => (
        <div
          key={p.id}
          className="live-briefing-tile"
          data-card-id={p.id}
          data-size={p.size}
          data-at-end={p.atEnd || undefined}
          data-stacked={p.id === stackedId || undefined}
          style={{ gridColumn: `${p.col + 1} / span ${p.width}`, gridRow: `${p.row + 1} / span ${p.height}` }}
        >
          {p.id === stackedId ? (
            <>
              <div className="timeline-stack-face" inert>
                {content.get(p.id)}
              </div>
              <button
                className="timeline-stack-open"
                type="button"
                aria-label={preview!.label}
                aria-expanded={false}
                aria-controls={preview!.controls}
                disabled={preview!.disabled}
                onClick={preview!.expand}
              >
                <span>
                  +{remaining}
                  <span>展开当天全部</span>
                </span>
              </button>
            </>
          ) : (
            content.get(p.id)
          )}
        </div>
      ))}
      {fillers
        .filter((f) => !preview || f.row + f.height <= preview.rows)
        .map((f) => (
          <div
            key={f.id}
            className="live-briefing-filler"
            aria-hidden="true"
            style={{ gridColumn: `${f.col + 1} / span ${f.width}`, gridRow: `${f.row + 1} / span ${f.height}` }}
          >
            <DreamcoreLogo />
          </div>
        ))}
    </div>
  );
}
