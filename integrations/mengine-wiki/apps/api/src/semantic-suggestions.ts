import type {Store} from './store.js';
import type {User} from './domain.js';
import {validateSemantics,type Semantics,type QueryTemplate} from './business-queries.js';
const invalid=(message:string)=>Object.assign(Error(message),{statusCode:502});
/** Normalize representation only; never invent fields, links, predicates or evidence. */
export function parseSemanticSuggestions(raw:string):Semantics{
 let b:any;try{b=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw invalid('模型未返回完整 JSON');}
 if(!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).some(k=>!['relations','templates'].includes(k))||!Array.isArray(b.relations)||!Array.isArray(b.templates)||b.relations.length>8||b.templates.length>12)throw invalid('模型需返回 relations、templates 数组，最多 8 项关联和 12 项模板');
 for(const t of b.templates){if(!t||typeof t!=='object'||Array.isArray(t))continue;for(const key of ['field','groupBy','related'])if(t[key]===null||t[key]==='')delete t[key];if(Array.isArray(t.groupBy)&&t.groupBy.length===1&&typeof t.groupBy[0]==='string')t.groupBy=t.groupBy[0];}
 return b;
}
/** Validate each proposal independently, keeping dependent templates out when a link is rejected. */
export function inspectSemanticSuggestions(store:Store,u:User,id:string,b:Semantics,allowedTargets:Set<string>){
 const rules:Required<Semantics>={relations:[],templates:[]},warnings:string[]=[];
 const seenRelations=new Set<string>(),seenTemplates=new Set<string>();
 for(const [i,r] of (b.relations||[]).entries())try{
  if(!r||seenRelations.has(r.id))throw Error('关联标识重复或无效');seenRelations.add(r.id);
  if(!allowedTargets.has(r.targetId))throw Error('关联目标不在本次授权候选目录中');
  validateSemantics(store,u,id,{relations:[r],templates:[]},true);rules.relations.push(r);
 }catch(e){warnings.push(`关联第 ${i+1} 项：${(e as Error).message}`);}
 for(const [i,t] of (b.templates||[]).entries())try{
  if(!t||seenTemplates.has(t.id))throw Error('模板标识重复或无效');seenTemplates.add(t.id);
  const candidate=t as QueryTemplate;
  if(candidate.field&&['count','records'].includes(candidate.operation))throw Error('计数与明细查询不应填写统计字段');
  if(candidate.operation==='records'&&candidate.groupBy)throw Error('明细查询不支持分组');
  validateSemantics(store,u,id,{relations:rules.relations,templates:[candidate]},true);rules.templates.push(candidate);
 }catch(e){warnings.push(`查询第 ${i+1} 项：${(e as Error).message}`);}
 return {rules,warnings};
}
