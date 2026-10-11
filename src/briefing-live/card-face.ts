import type { BriefingDocument, BriefingRow } from '../../contracts/public-api/briefing-content';
import { compareDecimal, presentationOf } from './presentation.ts';

/** Card-face graphic forms. Display choice only: values, units and scope stay those of the verified chart. */
export type FaceKind = 'SLOPE' | 'PAIR' | 'RANK' | 'DELTA' | 'TABLE';

/** A line between two columns claims change over time, so it needs two period labels, not two categories. */
export function isPeriodLabel(label: string): boolean {
  return /^(\d{4}([-/.年]\d{1,2}([-/.月]\d{1,2}日?)?月?)?年?|\d{1,2}月(\d{1,2}日)?|\d{4}\s*(Q[1-4]|第?[一二三四1-4]季度?)|[上本][期月周年]|去年|今年)$/i.test(
    label.trim(),
  );
}

export const slopeGroupLimit = 6;

/** Whether the two columns are periods of one measure rather than two categories of it. */
export function isPeriodComparison(document: BriefingDocument): boolean {
  const { chart, datasetBasis } = document.content;
  if (!chart || datasetBasis?.periodMode === 'SUMMARY' || document.content.datasetBasis?.periodMode === 'COMPOSITION') return false;
  return (
    datasetBasis?.periodMode === 'MONTH' || (isPeriodLabel(chart.baseline) && isPeriodLabel(chart.current))
  );
}

/** Two period labels and few enough groups for every line to keep its own end labels. */
export function slopeEligible(document: BriefingDocument): boolean {
  return isPeriodComparison(document) && document.content.chart!.rows.length <= slopeGroupLimit;
}

export function faceKind(document: BriefingDocument): FaceKind | null {
  const { chart, datasetBasis } = document.content;
  if (!chart) return null;
  const style = presentationOf(document)?.chartStyle;
  if (style === 'TABLE') return 'TABLE';
  if (datasetBasis?.periodMode === 'SUMMARY' || document.content.datasetBasis?.periodMode === 'COMPOSITION' || style === 'CURRENT_BAR') return 'RANK';
  if (style === 'DELTA_BAR') return 'DELTA';
  return slopeEligible(document) ? 'SLOPE' : 'PAIR';
}

/** A graphic of nothing but zeros and gaps says less than one honest sentence. */
export function hasPlottableValues(rows: BriefingRow[]): boolean {
  return rows.some((row) =>
    [row.baseline, row.current].some((value) => value !== null && !/^-?0+(\.0+)?$/.test(value)),
  );
}

export type RowSort = 'SOURCE' | 'CURRENT' | 'CHANGE';
/** Reading order chosen by the reader; missing values always sink to the end. */
export function sortedRows(rows: BriefingRow[], sort: RowSort): BriefingRow[] {
  if (sort === 'SOURCE') return rows;
  const field = sort === 'CURRENT' ? 'current' : 'difference';
  return [...rows].sort((a, b) => compareDecimal(b[field], a[field]));
}

const magnitude = (value: string) => value.replace(/^-/, '');

/** The group a two-period card leads with: the largest verified rate of change, source order on ties. */
export function leadRow(rows: BriefingRow[]): BriefingRow | null {
  let lead: BriefingRow | null = null;
  for (const row of rows)
    if (
      row.changePercent !== null &&
      (!lead || compareDecimal(magnitude(row.changePercent), magnitude(lead.changePercent!)) > 0)
    )
      lead = row;
  return lead;
}

/** Signed text for an already verified decimal; never recomputed from the plotted numbers. */
export function signedText(value: string): string {
  return value.startsWith('-') || /^0+(\.0+)?$/.test(value) ? value : '+' + value;
}

/** Ranking order for the face only; the full reading keeps the source order. */
export function rankedRows(rows: BriefingRow[]): BriefingRow[] {
  return [...rows].sort((a, b) => compareDecimal(b.current, a.current));
}
