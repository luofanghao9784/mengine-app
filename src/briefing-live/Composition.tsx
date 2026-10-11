import { displayChart } from './display-labels.ts';
import { FileText } from 'lucide-react';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { presentationOf, sectionLabels } from './presentation';
import { displayAmount } from './money-display';
import { formatBriefingNumber } from './content';
import './composition.css';

export function KeyMetric({ document }: { document: BriefingDocument }) {
  const p = presentationOf(document),
    chart = displayChart(document);
  if (p?.layout !== 'KEY_METRIC' || !chart) return null;
  const row = p.focusGroup ? chart.rows.find((r) => r.group === p.focusGroup)! : chart.totals;
  const field =
    p.focusValue === 'CHANGE_PERCENT'
      ? 'changePercent'
      : p.focusValue === 'DIFFERENCE'
        ? 'difference'
        : 'current';
  const unit = field === 'changePercent' ? '%' : chart.unit === '分' ? '元' : chart.unit;
  const raw = field === 'changePercent' ? row[field] : displayAmount(row[field], chart.unit);
  const label =
    field === 'current'
      ? chart.current
      : field === 'difference'
        ? `${chart.current} 较 ${chart.baseline}变化`
        : `${chart.current} 较 ${chart.baseline}变化率`;
  return (
    <div className="briefing-key-metric" data-composition="KEY_METRIC">
      <span>
        {row.displayGroup ?? p.focusGroup ?? '总计'} · {chart.metric}
      </span>
      <div>
        <strong>
          {raw === null ? (field === 'changePercent' ? '不可计算' : '缺数据') : formatBriefingNumber(raw)}
        </strong>
        {raw !== null && <span>{unit}</span>}
      </div>
      <small>
        {label}
        {row.issue === 'UNEQUAL_GROUP_COVERAGE' ? ' · 两期分组覆盖不一致' : ''}
      </small>
    </div>
  );
}

/** All sections quote existing paragraphs; unselected paragraphs remain in the full reading view. */
export function AnalysisComposition({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const p = presentationOf(document),
    c = document.content;
  const sections = p?.sections ?? [];
  if (!sections.length)
    return compact ? null : (
      <div className="data-briefing-analysis">
        {c.analysis.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
      </div>
    );
  const selected = compact
    ? c.businessType === 'INFO'
      ? sections.filter((section) => section.role === 'OBSERVATION').slice(0, 1)
      : sections.slice(0, 2)
    : sections;
  const layout = p?.layout ?? 'EDITORIAL';
  const Tag = layout === 'STEPS' ? 'ol' : 'div';
  const Block = layout === 'STEPS' ? 'li' : 'div';
  return (
    <>
      <Tag
        className={`briefing-sections layout-${layout.toLowerCase()}${compact ? ' is-compact' : ''}`}
        data-composition={layout}
      >
        {selected.map((section, i) => (
          <Block key={section.paragraphIndex} className="briefing-section">
            <span className="briefing-section-label">
              {layout === 'STEPS' ? `${i + 1} · ` : ''}
              {sectionLabels[section.role]}
              {section.role === 'OPTION' ? ` ${i + 1}` : ''}
            </span>
            <p>{c.analysis[section.paragraphIndex]}</p>
          </Block>
        ))}
      </Tag>
      {compact && sections.length > selected.length && (
        <small className="briefing-composition-note">
          另有 {sections.length - selected.length} 项，详情查看完整内容
        </small>
      )}
      {!compact && (
        <div className="data-briefing-analysis">
          {c.analysis.map((text, i) =>
            sections.some((s) => s.paragraphIndex === i) ? null : <p key={i}>{text}</p>,
          )}
        </div>
      )}
    </>
  );
}

export function SourceCover({ document }: { document: BriefingDocument }) {
  if (presentationOf(document)?.layout !== 'SOURCE') return null;
  const source = document.content.source,
    dataset = document.content.datasetSource;
  if (!source && !dataset) return null;
  return (
    <div className="briefing-source-cover" data-composition="SOURCE">
      <FileText size={32} aria-hidden="true" />
      <div>
        <small>引用依据</small>
        <strong>{source?.filename ?? dataset?.name}</strong>
        <span>版本 {source?.version ?? dataset?.version}</span>
      </div>
    </div>
  );
}
