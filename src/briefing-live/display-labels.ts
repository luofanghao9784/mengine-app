import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
/** Only visual components call this. Source evidence, IDs, hashes and focusGroup retain raw values. */
export function displayChart(document: BriefingDocument) {
  const chart=document.content.chart, labels=document.chartLabels;
  if(!chart || !labels)return chart;
  const label=(map: Record<string,string>,raw:string) => Object.hasOwn(map,raw)?map[raw]:raw;
  return {...chart,baseline:label(labels.columns,chart.baseline),current:label(labels.columns,chart.current),
    rows:chart.rows.map(row=>({...row,displayGroup:row.group===null?undefined:label(labels.groups,row.group)}))};
}
