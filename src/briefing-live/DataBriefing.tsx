import { KeyMetric, AnalysisComposition, SourceCover } from './Composition';
import { ComparisonVisual } from './ComparisonVisual';
import { presentationOf } from './presentation';
import { NewsCover } from './NewsCover';
import { ReadingEvidence } from './ReadingEvidence';
import { displayAmount } from './money-display';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { briefingTypeLabels, formatBriefingNumber as value } from './content';
import { DetailChart } from './DetailChart';
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
  // The full reading uses one interactive graphic for every chart style; cards keep compact forms.
  if (!compact)
    return document.content.chart ? (
      <figure className="data-briefing-chart briefing-detail-chart">
        <DetailChart document={document} />
        <figcaption>
          {document.content.chart.unit === '分' ? '金额以元显示，计算依据保留原始单位。' : '按同口径比较。'}
          具体日期与统计范围见下方依据。
        </figcaption>
      </figure>
    ) : null;
  if (presentationOf(document)?.chartStyle && presentationOf(document)?.chartStyle !== 'GROUPED_BAR')
    return <ComparisonVisual document={document} compact />;
  const chart = toMagazineChart(document, true);
  return chart && <MagazineChart chart={chart} spacious />;
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
  const summary = c.datasetBasis?.periodMode === 'SUMMARY';
  const amount = (raw: string | null) => value(displayAmount(raw, ch?.unit ?? ''));
  if (!ch)
    return (
      <article className="data-briefing" data-briefing-type={briefingTypeLabels[c.businessType]}>
        {c.businessType === 'INFO' && <NewsCover cover={document.cover} seed={c.title} />}
        <p className="data-briefing-summary">{c.summary}</p>
        <SourceCover document={document} />
        {!compact && (
          <>
            <AnalysisComposition document={document} />
            {c.source && (
              <ReadingEvidence title="资料依据" filename={c.source.filename} version={c.source.version}>
                <pre>{c.source?.scopeExcerpt}</pre>
              </ReadingEvidence>
            )}
            {c.datasetSource && (
              <ReadingEvidence
                title="数据依据"
                filename={c.datasetSource.name}
                version={c.datasetSource.version}
              >
                <p>数据版本包含 {c.datasetSource.rowCount} 条记录</p>
                <p>
                  采集于 {new Date(c.datasetSource.collectedAt).toLocaleString('zh-CN')}；
                  {c.datasetSource.coverageThrough
                    ? `业务覆盖截至 ${new Date(c.datasetSource.coverageThrough).toLocaleString('zh-CN')}`
                    : '业务覆盖时间未提供'}
                  。
                </p>
                <p>这是任务所读的固定数据版本；快照行数不代表逐行阅读或完整业务覆盖。</p>
              </ReadingEvidence>
            )}
          </>
        )}
      </article>
    );
  return (
    <div
      className={'data-briefing ' + (compact ? 'is-compact' : '')}
      data-briefing-type={briefingTypeLabels[c.businessType]}
    >
      <p className="data-briefing-summary">{c.summary}</p>
      <KeyMetric document={document} />
      <BriefingChart document={document} compact={compact} />
      {!compact && (
        <>
          <AnalysisComposition document={document} />
          <details className="data-briefing-table">
            <summary>{summary ? '查看完整汇总数据' : '查看完整对比数据'}</summary>
            <div className="data-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>门店 / 分组{ch.unit === '分' ? '（金额：元）' : ''}</th>
                    {!summary && <th>{ch.baseline}</th>}
                    <th>{ch.current}</th>
                    {!summary && <><th>差额</th><th>变化率</th><th>排名变化</th></>}
                  </tr>
                </thead>
                <tbody>
                  {[...ch.rows, { ...ch.totals, group: '总计' }].map((r) => (
                    <tr key={r.group}>
                      <th>{r.group}</th>
                      {!summary && <td>{amount(r.baseline)}</td>}
                      <td>{amount(r.current)}</td>
                      {!summary && <><td>{amount(r.difference)}</td>
                      <td>{r.changePercent === null ? '不可计算' : value(r.changePercent) + '%'}</td>
                      <td>
                        {r.baselineRank === null ? '—' : `${r.baselineRank} → ${r.currentRank ?? '缺数据'}`}
                      </td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{summary ? '汇总使用完整固定快照内符合筛选条件的记录，无对照期间，不计算变化率。' : '缺失期间不记为零；非正基期不计算变化率；并列采用相同名次。'}</p>
          </details>
          <ReadingEvidence
            title="统计口径与计算依据"
            filename={c.datasetSource?.name ?? c.source?.filename}
            version={c.datasetSource?.version ?? c.source?.version}
          >
            <p>统计范围：{ch.range}</p>
            {c.datasetSource ? (
              <>
                <p>数据采集于 {new Date(c.datasetSource.collectedAt).toLocaleString('zh-CN')}。</p>
                <p>
                  {c.datasetSource.coverageThrough
                    ? `业务覆盖截至 ${new Date(c.datasetSource.coverageThrough).toLocaleString('zh-CN')}。`
                    : '业务覆盖时间未提供，采集时间不代表数据统计期间。'}
                </p>
                <p>
                  {c.datasetBasis?.periodMode === 'MONTH' && (
                    <>
                      按日期归月，业务时区：{c.datasetBasis.timeZone}。<br />
                    </>
                  )}
                  统计指标：{ch.metric}。
                </p>
                <p>
                  纳入{summary ? '汇总' : '比较'} {c.datasetBasis?.matchedRows} 行，筛选排除 {c.datasetBasis?.ignoredRows}{' '}
                  行。读取范围为完整固定快照，快照本身不证明外部业务数据完整。
                </p>
              </>
            ) : (
              <pre>{c.source?.scopeExcerpt}</pre>
            )}
            <p>本分析基于上述数据版本，不代表实时经营数据。</p>
          </ReadingEvidence>
        </>
      )}
    </div>
  );
}
