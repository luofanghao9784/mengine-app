import { useId } from 'react';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { formatBriefingNumber as value } from './content';
import './data-briefing.css';

export function BriefingChart({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const c = document.content.chart,
    uid = useId();
  if (!c) return null;
  const max = Math.max(
    1,
    ...c.rows.flatMap((r) => [Number(r.baseline ?? 0), Number(r.current ?? 0)].map(Math.abs)),
  );
  const negative = c.rows.some((r) => Number(r.baseline ?? 0) < 0 || Number(r.current ?? 0) < 0);
  const width = 640,
    zero = negative ? 325 : 150,
    scale = (negative ? 170 : 330) / max,
    rowHeight = compact ? 48 : 58,
    height = c.rows.length * rowHeight + 24;
  return (
    <figure className={'data-briefing-chart ' + (compact ? 'is-compact' : '')}>
      <div className="data-chart-legend">
        <span>
          <i className="baseline" />
          {c.baseline}
        </span>
        <span>
          <i className="current" />
          {c.current}
        </span>
        <span>{c.metric}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-title ${uid}-desc`}>
        <title id={`${uid}-title`}>{c.metric}两期对比图</title>
        <desc id={`${uid}-desc`}>
          {c.rows
            .map(
              (r) =>
                `${r.group}：${c.baseline} ${value(r.baseline)}，${c.current} ${value(r.current)} ${c.unit}`,
            )
            .join('；')}
          。缺失值不作零处理。
        </desc>
        <line x1={zero} y1={0} x2={zero} y2={height - 5} stroke="#dbe3ee" />
        {c.rows.map((r, index) => (
          <g key={r.group} transform={`translate(0 ${index * rowHeight + 6})`}>
            <text className="chart-group" x={0} y={23}>
              {r.group}
            </text>
            {[r.baseline, r.current].map((n, j) => {
              const size = Math.abs(Number(n ?? 0)) * scale;
              return (
                <g key={j}>
                  {n !== null && (
                    <rect
                      x={Number(n) < 0 ? zero - size : zero}
                      y={j * 20}
                      width={Math.max(Number(n) === 0 ? 0 : 1, size)}
                      height={12}
                      rx={3}
                      className={j ? 'current' : 'baseline'}
                    />
                  )}
                  <text className="chart-value" x={negative ? 520 : zero + size + 8} y={j * 20 + 11}>
                    {value(n)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <figcaption>单位：{c.unit} · 按原表同口径比较，具体日期与统计范围见下方依据。</figcaption>
    </figure>
  );
}
export function DataBriefing({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const c = document.content,
    ch = c.chart;
  if (!ch)
    return (
      <article className="data-briefing">
        <p className="data-briefing-summary">{c.summary}</p>
        {!compact && (
          <>
            <div className="data-briefing-analysis">
              {c.analysis.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {c.source && (
              <details>
                <summary>资料依据</summary>
                <p>
                  {c.source?.filename} · v{c.source?.version}
                </p>
                <pre>{c.source?.scopeExcerpt}</pre>
              </details>
            )}
            <small>生成于 {new Date(c.generatedAt).toLocaleString('zh-CN')}；完整引用见来源卡片。</small>
          </>
        )}
      </article>
    );
  return (
    <div className={'data-briefing ' + (compact ? 'is-compact' : '')}>
      <p className="data-briefing-summary">{c.summary}</p>
      <BriefingChart document={document} compact={compact} />
      {!compact && (
        <>
          <div className="data-briefing-analysis">
            {c.analysis.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <details className="data-briefing-table">
            <summary>查看完整对比数据</summary>
            <div className="data-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>门店 / 分组</th>
                    <th>{ch.baseline}</th>
                    <th>{ch.current}</th>
                    <th>差额</th>
                    <th>变化率</th>
                    <th>排名变化</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ch.rows, { ...ch.totals, group: '总计' }].map((r) => (
                    <tr key={r.group}>
                      <th>{r.group}</th>
                      <td>{value(r.baseline)}</td>
                      <td>{value(r.current)}</td>
                      <td>{value(r.difference)}</td>
                      <td>{r.changePercent === null ? '不可计算' : value(r.changePercent) + '%'}</td>
                      <td>
                        {r.baselineRank === null ? '—' : `${r.baselineRank} → ${r.currentRank ?? '缺数据'}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>缺失期间不记为零；非正基期不计算变化率；并列采用相同名次。</p>
          </details>
          <details className="data-briefing-basis">
            <summary>资料、统计口径与计算依据</summary>
            <p>
              {c.source?.filename} · v{c.source?.version} · {ch.range}
            </p>
            <pre>{c.source?.scopeExcerpt}</pre>
            <p>
              图表与数据表使用同一份计算回执。生成时间：{new Date(c.generatedAt).toLocaleString('zh-CN')}
              。这是固定来源版本的分析，不代表实时经营数据。
            </p>
          </details>
        </>
      )}
    </div>
  );
}
