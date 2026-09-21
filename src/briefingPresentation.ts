import type { CardData, CardSize } from './briefing.ts';

export type ChartDatum = { label: string; value: number; previous?: number };
export type BriefingChart = {
  kind:
    | 'line'
    | 'area'
    | 'stacked'
    | 'bullet'
    | 'lollipop'
    | 'waffle'
    | 'ring'
    | 'timeline'
    | 'dumbbell'
    | 'heatmap'
    | 'waterfall'
    | 'multiples';
  unit: string;
  period: string;
  rows: ChartDatum[];
  total?: number;
  target?: number;
  columns?: string[];
  matrix?: number[][];
  series?: { label: string; values: number[] }[];
};
export type BriefingPresentation = {
  format:
    'chart' | 'insight' | 'analysis' | 'recommendation' | 'comparison' | 'brief' | 'digest' | 'document';
  kicker?: string;
  lead?: string;
  points?: { label: string; text: string }[];
  chart?: BriefingChart;
  size?: CardSize;
};
export type BriefingPerson = { name: string; role: string };

// Read-only design projection: old source facts, dates, preferences and snapshots remain intact.
export function briefingPresentation(data: CardData): BriefingPresentation | undefined {
  if (data.photo) return undefined;
  if (data.presentation) return data.presentation;
  const rows = (data.items || []).map((d) => ({ label: d.label, value: Number(d.value) }));
  const numeric = rows.length > 0 && rows.every((d) => Number.isFinite(d.value) && d.value >= 0);
  const chart = (
    kind: BriefingChart['kind'],
    period: string,
    size: CardSize = '2×1',
    extra: Partial<BriefingChart> = {},
  ): BriefingPresentation => ({
    format: 'chart',
    size,
    chart: { kind, period, unit: data.unit || '项', rows, ...extra },
  });
  if (numeric && data.id === 'finance:demo-receipts') return chart('line', '8/29—9/19 · 每周到账', '2×2');
  if (numeric && data.id === 'demo:qualified-inquiries') return chart('area', '8/27—9/17 · 每周新增', '2×2');
  if (numeric && data.id === 'demo:opportunity-funnel') return chart('lollipop', '9/19 · 各阶段现存商机');
  if (numeric && data.id === 'demo:receivables-aging')
    return chart('stacked', '截至 9/19 · 未到账余额', '2×1', { total: Number(data.value) });
  if (numeric && data.id === 'demo:launch-budget')
    return chart('bullet', '截至 9/17 · 预算上限', '2×1', { target: Number(data.value) });
  if (numeric && data.id === 'demo:pilot-feedback') return chart('waffle', '9/18 · 每格一条反馈', '2×1');
  if (data.id === 'demo:delivery-walkthrough')
    return {
      format: 'chart',
      size: '2×2',
      chart: {
        kind: 'ring',
        unit: '准备项',
        period: '截至 9/18 · 仅表示准备项计数',
        rows: [
          { label: '已准备', value: 6 },
          { label: '待确认', value: 2 },
        ],
        total: 8,
      },
    };
  if (numeric && data.sourceKind === 'followup' && data.template === 'chart')
    return chart('stacked', '当前跟进记录');
  if (data.id === 'news:direction') return undefined; // Preserve the existing photograph edition.
  if (data.template === 'editorial')
    return {
      format: data.id === 'demo:feedback-to-knowledge' ? 'digest' : 'brief',
      kicker: '阅读札记 · 合成资讯',
      size: data.size,
    };
  if (data.template === 'document')
    return {
      format: 'document',
      kicker: data.type === '成果交付' ? '阶段成果' : undefined,
      size: data.type === '成果交付' ? '2×1' : data.size,
    };
  if (data.id === 'demo:homepage-review') return { format: 'analysis', kicker: 'AI 分析', size: '1×2' };
  if (data.type === '风险提醒' || data.id === 'demo:weekly-meeting' || data.id === 'demo:trial-roster')
    return { format: 'recommendation', kicker: 'AI 建议', lead: data.advice, size: data.size };
  if (data.type === '知识洞察') return { format: 'insight', kicker: 'AI 观察', size: data.size };
  if (data.id.startsWith('demo:')) return { format: 'analysis', size: data.size };
  return undefined;
}

export function chartDescription(chart: BriefingChart): string {
  const rows = chart.rows
    .map((r) => `${r.label} ${r.previous === undefined ? '' : `${r.previous} → `}${r.value}${chart.unit}`)
    .join('，');
  if (chart.kind === 'heatmap')
    return `${chart.period}；${chart.rows.map((r, i) => `${r.label}：${chart.columns?.map((c, j) => `${c} ${['待补充', '待确认', '齐备'][chart.matrix?.[i]?.[j] ?? 0]}`).join('，')}`).join('；')}`;
  if (chart.kind === 'multiples')
    return `${chart.period}；${chart.series?.map((s) => `${s.label}：${s.values.map((v, i) => `${chart.columns?.[i]} ${v}${chart.unit}`).join('，')}`).join('；')}`;
  if (chart.kind === 'timeline')
    return `${chart.period}；${chart.rows.map((r) => `${r.label}：${new Date(r.value).toISOString().slice(0, 10)}（计划）`).join('，')}`;
  return `${chart.period}；${rows}${chart.target === undefined ? '' : `；上限 ${chart.target}${chart.unit}`}`;
}
