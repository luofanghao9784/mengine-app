import { isSignalReading, SignalReading } from './SignalReading';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { fusionNumber, fusionRows } from './fusion';
import './fusion.css';
export function FusionBriefing({
  document,
  compact = false,
}: {
  document: BriefingDocument;
  compact?: boolean;
}) {
  const e = document.content.fusion;
  if (!e) return null;
  const rows = fusionRows(e);
  const visibleMetrics = compact ? e.results.slice(0, 2) : e.results;
  return (
    <article className={`fusion-briefing${compact ? ' is-compact' : ''}`} aria-label="多表关联分析">
      <p className="fusion-proof">
        {e.sources.length} 个数据集关联 · {e.results.length} 项已发布指标 · 计算已校验
      </p>
      {!compact && <p>{document.content.summary}</p>}
      <div className="fusion-metrics">
        {visibleMetrics.map((r) => (
          <section key={r.metricId}>
            <span>{r.label}</span>
            <strong>
              {fusionNumber(r.total)} <small>{r.unit}</small>
            </strong>
          </section>
        ))}
      </div>
      <div className="fusion-table-wrap">
        <table>
          <caption>按共同关联对象对齐；各指标保留各自单位</caption>
          <thead>
            <tr>
              <th>关联对象</th>
              {visibleMetrics.map((r) => (
                <th key={r.metricId}>
                  {r.label}
                  <small>（{r.unit}）</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(compact ? rows.slice(0, 4) : rows).map((r) => (
              <tr key={r.key}>
                <th>{r.label}</th>
                {(compact ? r.values.slice(0, 2) : r.values).map((v, i) => (
                  <td key={e.results[i].metricId}>{v === null ? '—' : fusionNumber(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compact && e.results.length > visibleMetrics.length && (
        <p>
          预览 {visibleMetrics.length} 项，打开查看全部 {e.results.length} 项指标。
        </p>
      )}
      {compact ? (
        rows.length > 4 && <p>另有 {rows.length - 4} 个对象，打开查看完整结果。</p>
      ) : (
        <>
          {isSignalReading(document) ? <SignalReading document={document} /> : <section aria-label="综合解读">
            {document.content.analysis.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>}
        </>
      )}
    </article>
  );
}

export function FusionEvidence({ document }: { document: BriefingDocument }) {
  const e = document.content.fusion;
  if (!e) return null;
  return (
    <section className="fusion-scope">
      <h3>计算范围与数据依据</h3>
      <p>{e.boundary}</p>
      <p>“—”表示该指标没有对应分组，不等于业务值为零。</p>
      {e.results.map((r) => (
        <p key={r.metricId}>
          {r.label}：纳入 {r.includedRecords} / {r.baseRecords} 条记录；各关联步骤未匹配记录{' '}
          {Object.entries(r.unmatched)
            .map(
              ([alias, count]) =>
                `${e.sources.find((s) => s.alias === alias)?.name ?? '关联步骤'}：${count} 条`,
            )
            .join('；') || '0 条'}
          。多跳中同一记录可能涉及多个步骤，不能相加。
        </p>
      ))}
      <ul>
        {e.sources.map((s) => (
          <li key={s.datasetId}>
            {s.name} · {s.rowCount} 条记录
          </li>
        ))}
      </ul>
    </section>
  );
}
