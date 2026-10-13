import type {Store} from './store.js';
import {readDataset,queryDataset,datasetUpdatedAt,beijingTime} from './foundation-query.js';
import {dictionaryFingerprint} from './dictionary-version.js';
import type {User} from './domain.js';
import type {FastifyInstance,FastifyRequest} from 'fastify';
const fail=(statusCode:number,message:string)=>Object.assign(Error(message),{statusCode});
export type Filter={field:string;operator:'eq'|'gte'|'lte';value:string};
export type Relation={id:string;name:string;targetId:string;keys:{local:string;foreign:string}[];evidence:string;targetFingerprint?:string};
export type QueryTemplate={id:string;name:string;question:string;operation:'records'|'count'|'sum'|'min'|'max';field?:string;groupBy?:string;filters:Filter[];related?:{relationId:string;mode:'exists'|'not_exists';filters:Filter[]};evidence:string};
export type Semantics={relations?:Relation[];templates?:QueryTemplate[]};
const text=(v:unknown,max=300)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateSemanticsShape(b:Semantics){
 for(const [key,max] of [['relations',8],['templates',12]] as const)if(b[key]!==undefined&&(!Array.isArray(b[key])||b[key]!.length>max))throw fail(400,'关联或查询模板数量无效');
 const ids=(a:{id:string}[])=>a.every(x=>x&&typeof x==='object'&&typeof x.id==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(x.id))&&new Set(a.map(x=>x.id)).size===a.length;
 if(!ids(b.relations||[])||!ids(b.templates||[]))throw fail(400,'关联和模板标识必须唯一，使用小写字母、数字及下划线');
 for(const r of b.relations||[])if(Object.keys(r).some(k=>!['id','name','targetId','keys','evidence','targetFingerprint'].includes(k))||!text(r.name,100)||!text(r.targetId,100)||!text(r.evidence,1000)||!Array.isArray(r.keys)||!r.keys.length||r.keys.length>3||r.keys.some(k=>!k||Object.keys(k).some(x=>!['local','foreign'].includes(x))||!text(k.local,40)||!text(k.foreign,40)))throw fail(400,'关联定义无效，请填写关联键和业务依据');
 const filters=(a:Filter[])=>Array.isArray(a)&&a.length<=8&&a.every(f=>f&&Object.keys(f).every(k=>['field','operator','value'].includes(k))&&text(f.field,40)&&['eq','gte','lte'].includes(f.operator)&&typeof f.value==='string'&&f.value.length<=2000);
 for(const t of b.templates||[])if(Object.keys(t).some(k=>!['id','name','question','operation','field','groupBy','filters','related','evidence'].includes(k))||!text(t.name,100)||!text(t.question,300)||!text(t.evidence,1000)||!['records','count','sum','min','max'].includes(t.operation)||!filters(t.filters)||t.related&&(!Object.keys(t.related).every(k=>['relationId','mode','filters'].includes(k))||!text(t.related.relationId,40)||!['exists','not_exists'].includes(t.related.mode)||!filters(t.related.filters)))throw fail(400,'查询模板无效，请检查规则和依据');
}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function resolveFilters(filters:Filter[],params:Record<string,string>,validation=false):Filter[]{return filters.map(f=>{if(!f.value.startsWith('$'))return f;if(!['$today','$dateFrom','$dateTo'].includes(f.value))throw fail(400,'仅支持 $today、$dateFrom、$dateTo 日期参数');const value=f.value==='$today'?today():params[f.value.slice(1)]||(validation?'2000-01-01':'');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw fail(400,'请填写有效的起止日期');return {...f,value};});}
function fieldGuard(def:any,name:string){const f=def.fields.find((f:any)=>f.name===name);if(!f||f.sensitive)throw fail(403,`关联与业务模板不能使用未定义或敏感字段（${name}）`);return f;}
export function validateSemantics(store:Store,u:User,id:string,b:Semantics,bind=false){
 validateSemanticsShape(b);const source=readDataset(store,u,id);
 for(const r of b.relations||[]){if(r.targetId===id)throw fail(400,'暂不支持自关联');const target=readDataset(store,u,r.targetId);for(const k of r.keys){const a=fieldGuard(source.definition,k.local),z=fieldGuard(target.definition,k.foreign);if(a.type!==z.type)throw fail(400,'关联字段类型必须一致');}const fp=dictionaryFingerprint(store,u.tenantId,target.definition);if(bind)r.targetFingerprint=fp;else if(r.targetFingerprint!==fp)throw fail(409,'关联目标结构发生变化，请重新确认口径');}
 for(const t of b.templates||[]){for(const f of t.filters){fieldGuard(source.definition,f.field);if(f.value.startsWith('$')&&fieldGuard(source.definition,f.field).type!=='date')throw fail(400,'日期参数只能用于日期字段');}queryDataset(store,u,id,{operation:t.operation,...(t.field?{field:t.field}:{}),...(t.groupBy?{groupBy:t.groupBy}:{}),filters:resolveFilters(t.filters,{},true),limit:1},true,undefined,true);
 if(t.related){const r=b.relations?.find(r=>r.id===t.related!.relationId);if(!r)throw fail(400,'模板引用的关联不存在');const target=readDataset(store,u,r.targetId);for(const f of t.related.filters)if(f.value.startsWith('$')&&fieldGuard(target.definition,f.field).type!=='date')throw fail(400,'日期参数只能用于日期字段');queryDataset(store,u,r.targetId,{operation:'count',filters:resolveFilters(t.related.filters,{},true)},true,undefined,true);}}
 return b;
}
// Equality keys are typed and compound; blank keys never match. Existence preserves base-table grain.
const decimal=(v:string)=>{if(!/^-?\d{1,15}(\.\d{1,6})?$/.test(v))throw fail(400,'数值关联字段格式无效');const sign=v.startsWith('-')?-1n:1n;const [a,b='']=v.replace(/^-/,'').split('.');return sign*(BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')));};
function key(values:Record<string,string>,names:string[],def:any){if(names.some(n=>!values[n]))return null;return JSON.stringify(names.map(n=>fieldGuard(def,n).type==='number'?decimal(values[n]).toString():values[n]));}
function matches(v:Record<string,string>,filters:Filter[],def:any){return filters.every(f=>{if(!v[f.field])return false;const numeric=fieldGuard(def,f.field).type==='number',a=numeric?decimal(v[f.field]):v[f.field],b=numeric?decimal(f.value):f.value;return f.operator==='eq'?a===b:f.operator==='gte'?a>=b:a<=b;});}
export function businessCatalog(store:Store,u:User,id:string){const s=readDataset(store,u,id),b=s.business as Semantics|null;const templates=(b?.templates||[]).map(t=>{try{validateSemantics(store,u,id,{relations:t.related?b?.relations?.filter(r=>r.id===t.related!.relationId):[],templates:[t]});return {...t,available:true};}catch{return {id:t.id,name:t.name,question:t.question,available:false,reason:'关联数据未授权或结构已变化，请负责人复核'};}});return {dictionaryStatus:s.dictionaryStatus,templates,timezone:'Asia/Shanghai'};}
export function runBusinessQuery(store:Store,u:User,id:string,templateId:string,params:Record<string,string>={},limit=20,model=false){
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!['dateFrom','dateTo'].includes(k))||Object.values(params).some(v=>typeof v!=='string'))throw fail(400,'模板参数无效');if(params.dateFrom&&params.dateTo&&params.dateFrom>params.dateTo)throw fail(400,'开始日期不能晚于结束日期');
 const base=readDataset(store,u,id),b=base.business as Semantics|null;if(!b)throw fail(409,'模型业务字典尚未生成或已失效');const t=b.templates?.find(t=>t.id===templateId);if(!t)throw fail(404,'模型生成的有效查询模板不存在');const relation=t.related?b.relations?.find(r=>r.id===t.related!.relationId):undefined;validateSemantics(store,u,id,{relations:relation?[relation]:[],templates:[t]});
 const dependencies=[base.document];let recordIds:Set<string>|undefined;
 const filters=resolveFilters(t.filters,params);const query={operation:t.operation,...(t.field?{field:t.field}:{}),...(t.groupBy?{groupBy:t.groupBy}:{}),filters,limit};
 let relatedRule:unknown=null;
 if(relation&&t.related){const target=readDataset(store,u,relation.targetId);dependencies.push(target.document);const targetFilters=resolveFilters(t.related.filters,params);queryDataset(store,u,relation.targetId,{operation:'count',filters:targetFilters},true);
 const rows=(datasetId:string)=>(store.db.prepare("SELECT data FROM data_rows WHERE dataset_id=? AND tenant_id=? AND status='ready'").all(datasetId,u.tenantId) as {data:string}[]).map(r=>JSON.parse(r.data));
 const keys=new Set(rows(relation.targetId).filter(r=>matches(r.values,targetFilters,target.definition)).map(r=>key(r.values,relation.keys.map(k=>k.foreign),target.definition)).filter(k=>k!==null));
 recordIds=new Set(rows(id).filter(r=>{const k=key(r.values,relation.keys.map(k=>k.local),base.definition);const exists=k!==null&&keys.has(k);return t.related!.mode==='exists'?exists:!exists;}).map(r=>r.id));relatedRule={relation:relation.name,mode:t.related.mode,targetId:relation.targetId,filters:targetFilters};}
 const out=queryDataset(store,u,id,query,model,recordIds);return {...out,dependencies,result:{...out.result,template:{id:t.id,name:t.name,evidence:t.evidence},relatedRule,timezone:'Asia/Shanghai',sources:dependencies.map(d=>({id:d.id,title:d.title,version:d.version,snapshotAt:datasetUpdatedAt(store,u.tenantId,d.id,d.createdAt),snapshotTime:beijingTime(datasetUpdatedAt(store,u.tenantId,d.id,d.createdAt))})),notice:'按模型生成的有效模板计算；快照不等于源系统实时状态，关联按基础表记录计数，缺少关联不自动代表未付款。'}};
}
export function registerBusinessQueries(app:FastifyInstance,store:Store,session:(r:FastifyRequest)=>User){
 app.get<{Params:{id:string}}>('/api/foundation/:id/business-queries',async req=>businessCatalog(store,session(req),req.params.id));
 app.post<{Params:{id:string};Body:{templateId:string;params?:Record<string,string>;limit?:number}}>('/api/foundation/:id/business-queries/run',async req=>{const u=session(req),b=req.body;if(!b||typeof b.templateId!=='string'||Object.keys(b).some(k=>!['templateId','params','limit'].includes(k)))throw fail(400,'请选择模型生成的有效查询模板');const {result}=runBusinessQuery(store,u,req.params.id,b.templateId,b.params,b.limit);store.audit(u,'dataset.business.queried',result.title,'执行模型生成的有效业务模板：'+result.template.name);return result;});
}
