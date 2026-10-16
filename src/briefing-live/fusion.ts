import type { FusionEvidence } from '../../contracts/public-api/briefing-content';
import { record, uuid } from '../identity/client.ts';
const text=(x:unknown,max=500):x is string=>typeof x==='string'&&x.length>0&&x.length<=max;
const count=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const decimal=(x:unknown):x is string=>typeof x==='string'&&/^-?\d{1,64}(?:\.\d{1,12})?$/.test(x);
export function isFusionEvidence(x:unknown):x is FusionEvidence {
 return record(x)&&x.version==='governed-graph-v1'&&Array.isArray(x.sources)&&x.sources.length>=2
  &&x.sources.every(s=>record(s)&&text(s.alias,10)&&text(s.name)&&uuid(s.datasetId)&&uuid(s.snapshotId)&&typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256)&&count(s.rowCount))
  &&new Set(x.sources.map(s=>s.datasetId)).size===x.sources.length
  &&Array.isArray(x.relations)&&x.relations.length>=1&&x.relations.every(r=>record(r)&&text(r.from,10)&&text(r.to,10)&&text(r.id)&&text(r.name)&&Array.isArray(r.local)&&Array.isArray(r.foreign)&&r.local.length===r.foreign.length&&r.local.length>0&&r.local.length<=3&&r.local.every(k=>text(k,160))&&r.foreign.every(k=>text(k,160))&&text(r.targetFingerprint))
  &&Array.isArray(x.results)&&x.results.length>=2&&x.results.every(r=>record(r)&&uuid(r.metricId)&&text(r.label)&&text(r.unit,160)&&decimal(r.total)&&count(r.baseRecords)&&count(r.includedRecords)&&Number(r.includedRecords)<=Number(r.baseRecords)&&Array.isArray(r.dimensions)&&r.dimensions.length>0&&r.dimensions.length<=3&&r.dimensions.every(k=>text(k,160))&&Array.isArray(r.groups)&&r.groups.every(g=>record(g)&&Array.isArray(g.dimensions)&&g.dimensions.length===(r.dimensions as unknown[]).length&&g.dimensions.every(v=>v===null||text(v,160))&&decimal(g.value)&&count(g.records))&&record(r.unmatched)&&Object.values(r.unmatched).every(count)&&Array.isArray(r.datasets)&&r.datasets.every(uuid))
  &&new Set(x.results.map(r=>r.metricId)).size===x.results.length&&text(x.dimensionName)&&record(x.dimensionLabels)&&Object.values(x.dimensionLabels).every(v=>text(v,100))&&text(x.boundary,1500);
}
/** Display the exact decimal string supplied by the calculation service. */
export function fusionNumber(raw:string){const [integer,fraction]=raw.split('.');return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);}
export function fusionRows(e: FusionEvidence){
 const keys=[...new Set(e.results.flatMap(r=>r.groups.map(g=>JSON.stringify(g.dimensions))))];
 return keys.map(key=>({key,label:e.dimensionLabels[key]??(JSON.parse(key).some((x:unknown)=>x===null)?'未匹配对象':JSON.parse(key).join(' / ')),values:e.results.map(r=>r.groups.find(g=>JSON.stringify(g.dimensions)===key)?.value??null)}));
}
