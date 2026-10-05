import { displayAmount } from './money-display.ts';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import type { BriefingChart } from '../briefingPresentation';
import { formatBriefingNumber } from './content.ts';

/** Display projection only; receipts, decimal strings and source order stay intact. */
export function toMagazineChart(document: BriefingDocument, compact = false): BriefingChart | null {
  const chart = document.content.chart;
  if (!chart) return null;
  const rows = compact ? chart.rows.slice(0, 6) : chart.rows;
  const cellRange = /^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(
    chart.range.split('!').at(-1)!.trim(),
  );
  return {
    kind: 'columns',
    unit: chart.unit === '分' ? '元' : chart.unit,
    period:
      (cellRange ? '两期对比' : chart.range) +
      (rows.length < chart.rows.length
        ? ` · 前${rows.length}组 / 共${chart.rows.length}组，详情查看全部`
        : ''),
    columns: [chart.baseline, chart.current],
    rows: rows.map((row) => ({
      label: row.group!,
      previous: Number(displayAmount(row.baseline, chart.unit) ?? 0),
      value: Number(displayAmount(row.current, chart.unit) ?? 0),
      previousMissing: row.baseline === null,
      valueMissing: row.current === null,
      previousText: formatBriefingNumber(displayAmount(row.baseline, chart.unit)),
      valueText: formatBriefingNumber(displayAmount(row.current, chart.unit)),
    })),
  };
}
