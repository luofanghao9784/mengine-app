import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { displayChart } from './display-labels.ts';

/** Scoped editorial preview for this historical receipt batch; never infer additive statuses for other charts. */
export function pendingReceipts(document?: BriefingDocument | null) {
  if (!document || !['梵华里41笔已复核，4笔分两步接续', '梵华里4笔历史收款记录待核对'].includes(document.content.title)) return null;
  const chart = displayChart(document);
  if (!chart || chart.rows.length !== 3) return null;
  const value = (label: string) => {
    const row = chart.rows.find((item) => (item.displayGroup ?? item.group) === label);
    if (row?.current == null || !/^\d+$/.test(row.current)) return null;
    const count = Number(row.current);
    return Number.isSafeInteger(count) ? count : null;
  };
  const confirmed = value('财务已确认');
  const review = value('待财务审核');
  const receipt = value('已确认待补凭证');
  if (confirmed === null || review === null || receipt === null) return null;
  return { confirmed, review, receipt, total: review + receipt };
}

