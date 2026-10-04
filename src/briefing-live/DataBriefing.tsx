import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { formatBriefingNumber as value } from './content';
import { BriefingChart as MagazineChart } from '../components/BriefingChart';
import { toMagazineChart } from './chart-presentation';
import '../briefingDesign.css';
import './data-briefing.css';

export function BriefingChart({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const chart = toMagazineChart(document, compact);
  if (!chart) return null;
  if (compact) return <MagazineChart chart={chart} spacious />;
  return (
    <figure className="data-briefing-chart briefing-detail-chart">
      <div className="data-chart-scroll">
        <div style={{ minWidth: chart.rows.length > 6 ? chart.rows.length * 64 + 34 : undefined }}>
          <MagazineChart chart={chart} spacious={false} />
        </div>
      </div>
      <figcaption>按原表同口径比较，具体日期与统计范围见下方依据。</figcaption>
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
              {c.datasetSource?.name ?? c.source?.filename} · v{c.datasetSource?.version ?? c.source?.version}{' '}
              · {ch.range}
            </p>
            {c.datasetSource ? (
              <>
                <p>数据采集于 {new Date(c.datasetSource.collectedAt).toLocaleString('zh-CN')}。</p>
                <p>
                  {c.datasetSource.coverageThrough
                    ? `业务覆盖截至 ${new Date(c.datasetSource.coverageThrough).toLocaleString('zh-CN')}。`
                    : '业务覆盖时间未提供，采集时间不代表数据统计期间。'}
                </p>
                <p>
                  分组字段：{c.datasetBasis?.groupColumn}；期间字段：{c.datasetBasis?.periodColumn}
                  ；数值字段：{ch.metric}。
                </p>
                <p>
                  纳入比较 {c.datasetBasis?.matchedRows} 行，其他期间 {c.datasetBasis?.ignoredRows}{' '}
                  行不纳入比较。读取范围为完整固定快照，快照本身不证明外部业务数据完整。
                </p>
              </>
            ) : (
              <pre>{c.source?.scopeExcerpt}</pre>
            )}
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
