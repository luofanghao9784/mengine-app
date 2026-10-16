import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { fusionNumber, fusionRows } from './fusion';
import './fusion.css';
export function FusionBriefing({document,compact=false}:{document:BriefingDocument;compact?:boolean}){
 const e=document.content.fusion;if(!e)return null;
 const rows=fusionRows(e);
 return <article className={`fusion-briefing${compact?' is-compact':''}`} aria-label="多表关联分析">
  <p className="fusion-proof">{e.sources.length} 个数据集关联 · {e.results.length} 项已发布指标 · 计算已校验</p>
  {!compact&&<p>{document.content.summary}</p>}
  <div className="fusion-metrics">{e.results.map(r=><section key={r.metricId}><span>{r.label}</span><strong>{fusionNumber(r.total)} <small>{r.unit}</small></strong></section>)}</div>
  <div className="fusion-table-wrap"><table><caption>按共同关联对象对齐；各指标保留各自单位</caption><thead><tr><th>关联对象</th>{e.results.map(r=><th key={r.metricId}>{r.label}<small>（{r.unit}）</small></th>)}</tr></thead><tbody>{(compact?rows.slice(0,4):rows).map(r=><tr key={r.key}><th>{r.label}</th>{r.values.map((v,i)=><td key={e.results[i].metricId}>{v===null?'—':fusionNumber(v)}</td>)}</tr>)}</tbody></table></div>
  {compact?rows.length>4&&<p>另有 {rows.length-4} 个对象，打开查看完整结果。</p>:<>
   <section aria-label="综合解读">{document.content.analysis.map((p,i)=><p key={i}>{p}</p>)}</section>
   <section className="fusion-scope"><h3>计算范围与数据依据</h3><p>{e.boundary}</p><p>“—”表示该指标没有对应分组，不等于业务值为零。</p>
    {e.results.map(r=><p key={r.metricId}>{r.label}：纳入 {r.includedRecords} / {r.baseRecords} 条记录；未匹配关联对象 {Object.values(r.unmatched).reduce((a,b)=>a+b,0)} 条，保留在未匹配分组。</p>)}
    <ul>{e.sources.map(s=><li key={s.datasetId}>{s.name} · {s.rowCount} 条记录</li>)}</ul>
   </section>
  </>}
 </article>;
}
