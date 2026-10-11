import { displayChart } from './display-labels.ts';
import { useState } from 'react';
import type { BriefingDocument, BriefingRow } from '../../contracts/public-api/briefing-content';
import { Rows, Slope, exact, slopeLayout, unitOf, useFaceBox, type RowsKind } from './CardFace';
import {
  faceKind,
  hasPlottableValues,
  isPeriodComparison,
  leadRow,
  rankedRows,
  signedText,
  slopeEligible,
  sortedRows,
  type RowSort,
} from './card-face';
import { formatBriefingNumber } from './content';
import { presentationOf } from './presentation';

const viewLabels = { SLOPE: '变化', PAIR: '对照', DELTA: '增减', RANK: '排名' };
type View = keyof typeof viewLabels;
const sortLabels: Record<RowSort, string> = { SOURCE: '原顺序', CURRENT: '本期高→低', CHANGE: '变化大→小' };
const slopeHeight = 320;

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="detail-choice" role="group" aria-label={label}>
      <span>{label}</span>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The full reading of a verified comparison: every group, the same graphic language as the card
 * face, and reader-chosen view and order. Nothing here recomputes a value.
 */
export function DetailChart({ document }: { document: BriefingDocument }) {
  const [ref, measured] = useFaceBox();
  const [chosen, setChosen] = useState<View>();
  const [sort, setSort] = useState<RowSort>('SOURCE');
  const [active, setActive] = useState<string | null>(null);
  const chart = displayChart(document);
  const kind = faceKind(document);
  if (!chart || !kind) return null;
  const summary = document.content.datasetBasis?.periodMode === 'SUMMARY' || document.content.datasetBasis?.periodMode === 'COMPOSITION';
  // A rate of change between two categories is not a change; only periods get one in the readout.
  const periods = isPeriodComparison(document);
  // Inside the article there is no card edge to run to; keep a small inset for the end labels.
  const box = { w: Math.max(0, measured.w - 24), h: slopeHeight, left: 12, right: 12, top: 0, bottom: 0 };
  const slope = slopeEligible(document) && box.w > 0 ? slopeLayout(chart, box, false) : null;
  const views: View[] = summary
    ? ['RANK']
    : [...(slope ? (['SLOPE'] as View[]) : []), 'PAIR', 'DELTA', 'RANK'];
  const preferred: View = kind === 'TABLE' ? 'PAIR' : kind;
  const view = chosen && views.includes(chosen) ? chosen : views.includes(preferred) ? preferred : views[0];
  const sortable = (view === 'PAIR' || view === 'DELTA') && chart.rows.length > 1;
  const ordered = view === 'RANK' ? rankedRows(chart.rows) : sortedRows(chart.rows, sort);
  // Totals may be uncomputable (unequal coverage); then the readout starts from the lead group.
  const fallback =
    chart.totals.baseline !== null || chart.totals.current !== null
      ? chart.totals
      : (leadRow(chart.rows) ?? chart.rows[0]);
  const shown: BriefingRow = chart.rows.find((row) => row.group === active) ?? fallback;
  const rate =
    shown.changePercent === null ? '不可计算' : formatBriefingNumber(signedText(shown.changePercent)) + '%';
  return (
    <div
      ref={ref}
      className="briefing-face briefing-detail-face is-contained"
      data-chart-style={presentationOf(document)?.chartStyle ?? 'GROUPED_BAR'}
      data-detail-view={view}
    >
      {!hasPlottableValues(chart.rows) ? (
        <p className="face-empty">本次没有可比数据，下方保留完整的统计口径与依据。</p>
      ) : (
        <>
          {(views.length > 1 || sortable) && (
            <div className="detail-controls">
              {views.length > 1 && (
                <Choice
                  label="视角"
                  options={views.map((key) => [key, viewLabels[key]])}
                  value={view}
                  onChange={setChosen}
                />
              )}
              {sortable && (
                <Choice
                  label="排序"
                  options={(Object.keys(sortLabels) as RowSort[]).map((key) => [key, sortLabels[key]])}
                  value={sort}
                  onChange={setSort}
                />
              )}
            </div>
          )}
          <div className="detail-readout" aria-live="polite">
            <strong>{shown.displayGroup ?? shown.group ?? '总计'}</strong>
            {summary ? (
              <span>
                {chart.current} {exact(shown.current, chart)} {unitOf(chart)}
              </span>
            ) : (
              <>
                <span>
                  {chart.baseline} {exact(shown.baseline, chart)}
                </span>
                <span>
                  {chart.current} {exact(shown.current, chart)}
                </span>
                <span>
                  差额{' '}
                  {shown.difference === null
                    ? '缺数据'
                    : formatBriefingNumber(signedText(exact(shown.difference, chart).replace(/,/g, '')))}
                </span>
                {periods && <span>变化率 {rate}</span>}
              </>
            )}
            {!active && chart.rows.length > 1 && <em>指向任一分组查看明细</em>}
          </div>
          {view === 'SLOPE' && slope ? (
            <div className="detail-slope" style={{ height: slopeHeight }}>
              <Slope
                chart={chart}
                box={box}
                layout={slope}
                lead={leadRow(chart.rows)}
                onActive={setActive}
                panel
              />
            </div>
          ) : (
            box.w > 0 && (
              <Rows
                kind={(view === 'SLOPE' ? 'PAIR' : view) as RowsKind}
                chart={chart}
                box={box}
                summary={summary}
                ordered={ordered}
                active={active}
                onActive={setActive}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
