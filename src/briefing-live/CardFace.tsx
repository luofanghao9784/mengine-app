import { displayChart } from './display-labels.ts';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BriefingDocument, BriefingRow } from '../../contracts/public-api/briefing-content';
import { ComparisonVisual } from './ComparisonVisual';
import { faceKind, hasPlottableValues, leadRow, rankedRows, signedText, type FaceKind } from './card-face';
import { formatBriefingNumber } from './content';
import { displayAmount } from './money-display';
import { presentationOf } from './presentation';
import './card-face.css';

type Chart = NonNullable<BriefingDocument['content']['chart']>;
export type Box = { w: number; h: number; left: number; right: number; top: number; bottom: number };

/**
 * Own size plus the offsets to the card body's edges. The slope art is positioned against that
 * body, so it reaches the card edge while the text column keeps its normal overflow clipping.
 */
export function useFaceBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0, left: 0, right: 0, top: 0, bottom: 0 });
  const [bleed, setBleed] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const body = element.closest<HTMLElement>('.live-briefing-body');
    setBleed(!!body);
    const measure = () => {
      const own = element.getBoundingClientRect();
      const outer = body?.getBoundingClientRect();
      const next = {
        w: Math.round(own.width),
        h: Math.round(own.height),
        left: outer ? Math.max(0, Math.round(own.left - outer.left)) : 0,
        right: outer ? Math.max(0, Math.round(outer.right - own.right)) : 0,
        top: outer ? Math.max(0, Math.round(own.top - outer.top)) : 0,
        bottom: outer ? Math.max(0, Math.round(outer.bottom - own.bottom)) : 0,
      };
      setBox((old) =>
        (Object.keys(next) as (keyof Box)[]).every((key) => old[key] === next[key]) ? old : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (body) observer.observe(body);
    return () => observer.disconnect();
  }, []);
  return [ref, box, bleed] as const;
}

export const unitOf = (chart: Chart) => (chart.unit === '分' ? '元' : chart.unit);
export const exact = (raw: string | null, chart: Chart) =>
  formatBriefingNumber(displayAmount(raw, chart.unit));
const plotted = (raw: string | null, chart: Chart) => Number(displayAmount(raw, chart.unit) ?? 0);
/** Clip by estimated width (CJK about one em, Latin and digits about half) instead of overflow. */
const clip = (label: string, width: number) => {
  let used = 0;
  for (let i = 0; i < label.length; i++) {
    used += label.charCodeAt(i) > 0x2e7f ? 12.5 : 7;
    if (used > width) return label.slice(0, Math.max(1, i - 1)) + '…';
  }
  return label;
};

/** Keep end labels at least `gap` apart without detaching them far from their marks. */
function spread(positions: (number | null)[], gap: number) {
  const order = positions
    .map((y, i) => ({ y, i }))
    .filter((d): d is { y: number; i: number } => d.y !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++)
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out = [...positions];
  for (const d of order) out[d.i] = d.y;
  return out;
}

export function slopeLayout(chart: Chart, box: Box, lead: boolean) {
  const narrow = box.w < 380;
  const top = lead && box.h >= 250 ? 62 : 0;
  const height = box.h - top;
  const digits = (side: 'baseline' | 'current') =>
    Math.max(...chart.rows.map((row) => exact(row[side], chart).length)) * 7.2;
  const names = Math.min(5, Math.max(...chart.rows.map((row) => (row.displayGroup ?? row.group!).length))) * 12.5;
  const leftLabel = 12 + digits('baseline') + (narrow ? 0 : 10 + names);
  const rightLabel = 12 + digits('current') + 10 + names;
  const width = box.left + box.w + box.right;
  const x1 = box.left + leftLabel,
    x2 = width - box.right - rightLabel;
  if (height < 150 || x2 - x1 < 90) return null;
  return { narrow, top, height, width, x1, x2, names };
}

export function Slope({
  chart,
  box,
  layout,
  lead,
  onActive,
  panel = false,
}: {
  chart: Chart;
  box: Box;
  layout: NonNullable<ReturnType<typeof slopeLayout>>;
  lead: BriefingRow | null;
  onActive?: (group: string | null) => void;
  /** Standalone panels round every corner; on a card the bands run into the card edge. */
  panel?: boolean;
}) {
  const [active, setActiveGroup] = useState<string | null>(null);
  const setActive = (group: string | null) => {
    setActiveGroup(group);
    onActive?.(group);
  };
  const { narrow, top, height, width, x1, x2, names } = layout;
  const shown = chart.rows.find((row) => row.group === active) ?? lead;
  const values = chart.rows.flatMap((row) =>
    [row.baseline, row.current].filter((raw) => raw !== null).map((raw) => plotted(raw, chart)),
  );
  const min = Math.min(...values),
    max = Math.max(...values);
  const plotTop = 34,
    plotBottom = height - 10;
  const y = (raw: string) =>
    max === min
      ? (plotTop + plotBottom) / 2
      : plotBottom - ((plotted(raw, chart) - min) / (max - min)) * (plotBottom - plotTop);
  const left = spread(
    chart.rows.map((row) => (row.baseline === null ? null : y(row.baseline))),
    17,
  );
  const right = spread(
    chart.rows.map((row) => (row.current === null ? null : y(row.current))),
    17,
  );
  const full = height + box.bottom;
  // Bands reach the card edges; only the outer bottom corners follow the card radius.
  const band = (from: number, to: number, outer: 'left' | 'right') =>
    outer === 'left'
      ? `M${from},0 H${to - 16} a16,16 0 0 1 16,16 V${full} H${from + 23} a23,23 0 0 1 -23,-23 Z`
      : `M${from + 16},0 H${to} V${full - 23} a23,23 0 0 1 -23,23 H${from} V16 a16,16 0 0 1 16,-16 Z`;
  return (
    <>
      {top > 0 && shown && (
        <div className="face-lead">
          <strong>
            {shown.changePercent === null ? '—' : formatBriefingNumber(signedText(shown.changePercent)) + '%'}
          </strong>
          <small>
            <b>{shown.displayGroup ?? shown.group}</b>
            {exact(shown.baseline, chart)} → {exact(shown.current, chart)} {unitOf(chart)}
          </small>
        </div>
      )}
      <svg
        className="face-art"
        style={{ left: 0, top: box.top + top, width, height: full }}
        width={width}
        height={full}
        role="img"
        aria-label={`${chart.metric}：${chart.baseline} 到 ${chart.current}`}
      >
        {panel ? (
          <>
            <rect className="face-band" x={0} y={0} width={x1} height={full} rx={16} />
            <rect className="face-band" x={x2} y={0} width={width - x2} height={full} rx={16} />
          </>
        ) : (
          <>
            <path className="face-band" d={band(0, x1, 'left')} />
            <path className="face-band" d={band(x2, width, 'right')} />
          </>
        )}
        <text className="face-tick" x={x1 - 12} y={20} textAnchor="end">
          {clip(chart.baseline, x1 - box.left - 12)}
        </text>
        <text className="face-tick" x={x2 + 12} y={20}>
          {clip(chart.current, width - box.right - x2 - 12)}
        </text>
        {chart.rows.map((row, i) => {
          const tone =
            row.baseline === null || row.current === null
              ? 'is-partial'
              : plotted(row.current, chart) >= plotted(row.baseline, chart)
                ? 'is-up'
                : 'is-down';
          return (
            <g
              key={row.group}
              className={`face-slope ${tone}${shown?.group === row.group ? ' is-active' : ''}`}
              onPointerEnter={() => setActive(row.group)}
              onPointerLeave={() => setActive(null)}
            >
              {row.baseline !== null && row.current !== null && (
                <>
                  <line className="face-hit" x1={x1} y1={y(row.baseline)} x2={x2} y2={y(row.current)} />
                  <line
                    className="face-stroke"
                    x1={x1}
                    y1={y(row.baseline)}
                    x2={x2}
                    y2={y(row.current)}
                    pathLength={1}
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                </>
              )}
              {row.baseline !== null && (
                <>
                  <circle className="face-dot" cx={x1} cy={y(row.baseline)} r={4.5} />
                  <text className="face-end" x={x1 - 12} y={left[i]! + 4} textAnchor="end">
                    {exact(row.baseline, chart)}
                  </text>
                  {!narrow && (
                    <text className="face-name" x={box.left} y={left[i]! + 4}>
                      {clip(row.displayGroup ?? row.group!, names)}
                    </text>
                  )}
                </>
              )}
              {row.current !== null && (
                <>
                  <circle className="face-dot" cx={x2} cy={y(row.current)} r={4.5} />
                  <text className="face-end" x={x2 + 12} y={right[i]! + 4}>
                    {exact(row.current, chart)}
                  </text>
                  <text className="face-name" x={width - box.right} y={right[i]! + 4} textAnchor="end">
                    {clip(row.displayGroup ?? row.group!, names)}
                  </text>
                </>
              )}
              {row.current === null && row.baseline !== null && (
                <text className="face-name" x={x2 + 12} y={left[i]! + 4}>
                  缺数据
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}

const rowHeights: Record<'PAIR' | 'RANK' | 'DELTA', number> = { PAIR: 46, RANK: 40, DELTA: 36 };

export type RowsKind = Exclude<FaceKind, 'SLOPE' | 'TABLE'>;
/** `ordered` is the full reading: every group in the given order, never truncated to a card height. */
export function Rows({
  kind,
  chart,
  box,
  summary,
  ordered,
  active,
  onActive,
}: {
  kind: RowsKind;
  chart: Chart;
  box: Box;
  summary: boolean;
  ordered?: BriefingRow[];
  active?: string | null;
  onActive?: (group: string | null) => void;
}) {
  const all = ordered ?? (kind === 'RANK' ? rankedRows(chart.rows) : chart.rows);
  const count = ordered
    ? all.length
    : Math.max(1, Math.min(all.length, Math.floor((box.h - 48) / rowHeights[kind])));
  const rows = all.slice(0, count);
  const rowHeight = ordered
    ? rowHeights[kind] + 6
    : Math.min(rowHeights[kind] + 14, Math.floor((box.h - 48) / count));
  const field = kind === 'DELTA' ? 'difference' : 'current';
  const values = rows.flatMap((row) =>
    kind === 'PAIR'
      ? [plotted(row.baseline, chart), plotted(row.current, chart)]
      : [plotted(row[field], chart)],
  );
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const position = (raw: string | null) => ((plotted(raw, chart) - min) / span) * 100;
  const zero = ((0 - min) / span) * 100;
  const bar = (raw: string | null, i: number): CSSProperties => ({
    left: `${Math.min(zero, position(raw))}%`,
    width: `${Math.abs(position(raw) - zero)}%`,
    animationDelay: `${i * 60}ms`,
  });
  const missing = summary ? 0 : all.filter((row) => row.baseline === null || row.current === null).length;
  return (
    <>
      <div className="face-caption">
        {kind === 'PAIR' ? (
          <span className="face-keys">
            <i className="is-base" />
            {chart.baseline}
            <i />
            {chart.current}
          </span>
        ) : (
          <span>{kind === 'DELTA' ? `${chart.current} 较 ${chart.baseline}增减` : chart.current}</span>
        )}
        <span>{unitOf(chart)}</span>
      </div>
      <ol
        className={`face-rows is-${kind.toLowerCase()}${active ? ' has-active' : ''}`}
        style={{ gridAutoRows: rowHeight }}
      >
        {rows.map((row, i) => (
          <li
            key={row.group}
            className={`${kind === 'RANK' && i === 0 ? 'is-lead' : ''}${active === row.group ? ' is-active' : ''}`}
            tabIndex={onActive ? 0 : undefined}
            onPointerEnter={onActive && (() => onActive(row.group))}
            onPointerLeave={onActive && (() => onActive(null))}
            onFocus={onActive && (() => onActive(row.group))}
            onBlur={onActive && (() => onActive(null))}
          >
            {kind === 'RANK' && <span className="face-rank">{i + 1}</span>}
            <span className="face-row">
              <span className="face-row-text">
                <span>{row.displayGroup ?? row.group}</span>
                <b>
                  {kind === 'PAIR'
                    ? `${exact(row.baseline, chart)} · ${exact(row.current, chart)}`
                    : kind === 'DELTA' && row.difference !== null
                      ? formatBriefingNumber(signedText(displayAmount(row.difference, chart.unit)!))
                      : exact(row[field], chart)}
                </b>
              </span>
              <span className="face-track">
                {kind === 'DELTA' && <i className="face-zero" style={{ left: `${zero}%` }} />}
                {kind === 'PAIR' && row.baseline !== null && (
                  <i className="face-bar is-base" style={bar(row.baseline, i)} />
                )}
                {row[field] !== null && (
                  <i
                    className={`face-bar${kind === 'DELTA' && plotted(row.difference, chart) < 0 ? ' is-down' : ''}`}
                    style={bar(row[field], i)}
                  />
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <small className="face-note">
        {chart.metric} · {chart.range}
        {rows.length < all.length && ` · 前 ${rows.length} 组 / 共 ${all.length} 组，详情查看全部`}
        {missing > 0 && ` · 存在 ${missing} 组期间缺数据`}
      </small>
    </>
  );
}

/** The card-face graphic for a verified comparison. The full reading keeps every group and the evidence. */
export function CardFace({ document }: { document: BriefingDocument }) {
  const [ref, box, bleed] = useFaceBox();
  const chart = displayChart(document);
  const kind = faceKind(document);
  if (!chart || !kind) return null;
  const presentation = presentationOf(document);
  const style = presentation?.chartStyle ?? 'GROUPED_BAR';
  if (kind === 'TABLE') return <ComparisonVisual document={document} compact />;
  const ownLead = presentation?.layout !== 'KEY_METRIC';
  const slope = kind === 'SLOPE' && box.w > 0 ? slopeLayout(chart, box, ownLead) : null;
  return (
    <div
      ref={ref}
      className={`briefing-face is-${(slope ? 'SLOPE' : kind).toLowerCase()}${bleed ? '' : ' is-contained'}`}
      data-chart-style={style}
    >
      {!hasPlottableValues(chart.rows) ? (
        <p className="face-empty">本次没有可比数据，详情保留统计口径与依据。</p>
      ) : (
        box.w > 0 &&
        (slope ? (
          <Slope
            chart={chart}
            box={box}
            layout={slope}
            lead={
              ownLead
                ? leadRow(chart.rows)
                : (chart.rows.find((row) => row.group === presentation?.focusGroup) ?? null)
            }
          />
        ) : (
          <Rows
            kind={kind === 'SLOPE' ? 'PAIR' : kind}
            chart={chart}
            box={box}
            summary={document.content.datasetBasis?.periodMode === 'SUMMARY'}
          />
        ))
      )}
    </div>
  );
}
