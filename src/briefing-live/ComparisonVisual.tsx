import type { BriefingDocument, BriefingRow } from '../../contracts/public-api/briefing-content';
import { compareDecimal, presentationOf } from './presentation';
import { displayAmount } from './money-display';
import { formatBriefingNumber } from './content';
import './composition.css';

export function ComparisonVisual({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const chart = document.content.chart,
    style = presentationOf(document)?.chartStyle;
  if (!chart || !style || style === 'GROUPED_BAR') return null;
  const all =
    style === 'CURRENT_BAR'
      ? [...chart.rows].sort((a, b) => compareDecimal(b.current, a.current))
      : chart.rows;
  const rows = compact ? all.slice(0, style === 'TABLE' ? 4 : 6) : all;
  const missingGroups = all.filter((r) => r.baseline === null || r.current === null).length;
  const field = style === 'DELTA_BAR' ? 'difference' : 'current';
  const numeric = (raw: string | null) => Number(displayAmount(raw, chart.unit) ?? 0);
  const exact = (raw: string | null) => formatBriefingNumber(displayAmount(raw, chart.unit));
  const values = rows.flatMap((r) =>
    style === 'DUMBBELL' ? [numeric(r.baseline), numeric(r.current)] : [numeric(r[field])],
  );
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const position = (n: number) => 5 + ((n - min) / span) * 90;
  const unit = chart.unit === '分' ? '元' : chart.unit;
  const label =
    style === 'DUMBBELL'
      ? `${chart.baseline} → ${chart.current}`
      : style === 'DELTA_BAR'
        ? `${chart.current} 较 ${chart.baseline}增减`
        : style === 'CURRENT_BAR'
          ? `${chart.current} · 按数值排序`
          : `${chart.baseline} / ${chart.current}`;
  const text = (r: BriefingRow) =>
    style === 'DUMBBELL' ? `${exact(r.baseline)} → ${exact(r.current)}` : exact(r[field]);
  return (
    <div className={`briefing-comparison-visual${compact ? ' is-compact' : ''}`} data-chart-style={style}>
      <div className="briefing-visual-caption">
        <span>{label}</span>
        <span>{unit}</span>
      </div>
      {style === 'TABLE' ? (
        <table className="briefing-mini-table">
          <thead>
            <tr>
              <th>分组</th>
              <th>{chart.baseline}</th>
              <th>{chart.current}</th>
              <th>变化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group}>
                <th>{r.group}</th>
                <td>{exact(r.baseline)}</td>
                <td>{exact(r.current)}</td>
                <td>{exact(r.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="briefing-comparison-rows">
          {rows.map((r) => (
            <div className="briefing-comparison-row" key={r.group}>
              <div className="briefing-comparison-label">
                <span>{r.group}</span>
                <strong>{text(r)}</strong>
              </div>
              <svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true">
                <line x1="5" x2="95" y1="8" y2="8" stroke="#e5ebf4" />
                {style === 'DUMBBELL' ? (
                  <>
                    {r.baseline !== null && r.current !== null && (
                      <line
                        x1={position(numeric(r.baseline))}
                        x2={position(numeric(r.current))}
                        y1="8"
                        y2="8"
                        stroke="#aac0e8"
                        strokeWidth="3"
                      />
                    )}
                    {r.baseline !== null && (
                      <ellipse cx={position(numeric(r.baseline))} cy="8" rx="1" ry="4" fill="#adc4e9" />
                    )}
                    {r.current !== null && (
                      <ellipse cx={position(numeric(r.current))} cy="8" rx="1" ry="4" fill="#356cd4" />
                    )}
                  </>
                ) : (
                  <>
                    <line x1={position(0)} x2={position(0)} y1="1" y2="15" stroke="#9ba9bc" />
                    {r[field] !== null && (
                      <rect
                        x={Math.min(position(0), position(numeric(r[field])))}
                        y="4"
                        width={Math.abs(position(numeric(r[field])) - position(0))}
                        height="8"
                        rx="1"
                        fill={numeric(r[field]) < 0 ? '#bc773b' : '#356cd4'}
                      />
                    )}
                  </>
                )}
              </svg>
            </div>
          ))}
        </div>
      )}
      {missingGroups > 0 && <small>存在 {missingGroups} 组期间缺数据，详情保留全部分组</small>}
      {rows.length < all.length && (
        <small>
          前 {rows.length} 组 / 共 {all.length} 组，详情查看全部
        </small>
      )}
      <small className="briefing-comparison-scope">
        {chart.metric} · {chart.range} · 缺失不记零
      </small>
    </div>
  );
}
