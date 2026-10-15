import {datasetAvailability,canUseCurrentData} from './data-availability.js';
import {dictionaryFingerprint,currentDictionary} from './dictionary-version.js';
import { Store } from './store.js';
import { canRead, canUseAI, type User, visibleText } from './domain.js';
import type { Field } from './foundation.js';
const fail=(code:number,message:string)=>Object.assign(new Error(message),{statusCode:code});
type Query={operation:'records'|'count'|'sum'|'min'|'max';field?:string;groupBy?:string;filters?:{field:string;operator:'eq'|'gte'|'lte';value:string}[];limit?:number};
const decimal=(v:string)=>{const sign=v.startsWith('-')?-1n:1n;const [a,b='']=v.replace(/^-/,'').split('.');return sign*(BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')));};
const format=(v:bigint)=>{const sign=v<0n?'-':'';v=v<0n?-v:v;const fraction=String(v%1000000n).padStart(6,'0').replace(/0+$/,'');return sign+String(v/1000000n)+(fraction?'.'+fraction:'');};
export const beijingTime=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(value))+' 北京时间';
export function datasetUpdatedAt(store:Store,tenant:string,id:string,fallback:string){const r=store.db.prepare('SELECT data FROM data_batches WHERE dataset_id=? AND tenant_id=? ORDER BY seq DESC LIMIT 1').get(id,tenant) as {data:string}|undefined;return r?JSON.parse(r.data).at||fallback:fallback;}
export function readDataset(store:Store,u:User,id:string){
 const d=store.doc(u.tenantId,id),row=store.db.prepare('SELECT data FROM data_sets WHERE id=? AND tenant_id=?').get(id,u.tenantId) as {data:string}|undefined;
 if(!d||!row||!canRead(u,d))throw fail(404,'数据集不存在或无权访问');
 const raw=JSON.parse(row.data);const dict=store.db.prepare('SELECT data FROM data_dictionary WHERE dataset_id=? AND tenant_id=?').get(id,u.tenantId) as {data:string}|undefined;const confirmed=dict?JSON.parse(dict.data).confirmed:null;const valid=currentDictionary(store,u.tenantId,raw,confirmed);
 return {document:d,analysisPolicy:valid?confirmed.analysisPolicy||{excludeFields:[],noSumFields:[]}:{excludeFields:[],noSumFields:[]},fieldEvidence:valid?confirmed.fieldEvidence||[]:[],business:valid?confirmed.definition:null,dictionaryStatus:confirmed?(valid?'generated':'changed'):'unconfirmed',definition:raw as {fields:Field[];source:string;purpose:string;updatePolicy:string}};
}
export function listDatasets(store:Store,u:User,selected?:string,search?:string){
 return (store.db.prepare('SELECT id FROM data_sets WHERE tenant_id=? ORDER BY id').all(u.tenantId) as {id:string}[]).filter(r=>!selected||r.id===selected).flatMap(r=>{const d=store.doc(u.tenantId,r.id);if(!d||!canUseCurrentData(store,u,d)||(search&&!`${d.title} ${d.summary}`.toLowerCase().includes(search.toLowerCase())))return [];const {definition,business,dictionaryStatus}=readDataset(store,u,r.id);return [{document:d,definition,business,dictionaryStatus}];}).slice(0,20);
}
// A constrained query language, never executable SQL. Model queries always exclude sensitive columns.
export function queryDataset(store:Store,u:User,id:string,input:unknown,model=false,recordIds?:Set<string>,validateOnly=false,preparedRows?:{id:string;values:Record<string,string>}[]){
 const {document,definition,business,dictionaryStatus,analysisPolicy,fieldEvidence}=readDataset(store,u,id);
 if(model&&!validateOnly&&!canUseAI(u,document))throw fail(403,"此数据集已暂停提供给 AI");
 const sourceFreshness=datasetAvailability(store,u.tenantId,id);
 if(model&&!validateOnly&&!sourceFreshness.allowed)throw fail(409,sourceFreshness.reason);
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'查询格式无效');
 const q=input as Query;if(Object.keys(q).some(k=>!['operation','field','groupBy','filters','limit'].includes(k))||!['records','count','sum','min','max'].includes(q.operation))throw fail(400,'不支持的查询操作');
 const limit=q.limit??(model?10:20);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail(400,'结果上限应为 1–100');
 const unknown=new Set(fieldEvidence.filter((e:any)=>e.status==='UNKNOWN').map((e:any)=>e.column));
 const allowed=(f:Field)=>(!f.sensitive||(!model&&u.clearance>=2))&&(!model||!unknown.has(f.name)&&!analysisPolicy.excludeFields.includes(f.name));
 if(model&&q.operation==='sum'&&analysisPolicy.noSumFields.includes(q.field))throw fail(409,'此字段不能无条件累加，请使用已核验的业务口径');
 const getField=(name:unknown)=>{const f=definition.fields.find(f=>f.name===name);if(!f)throw fail(400,'字段不存在');if(!allowed(f))throw fail(403,'不可查询受限字段');return f;};
 if(['records','count'].includes(q.operation)&&q.field!==undefined)throw fail(400,'该操作不需要统计字段');if(q.field!==undefined)getField(q.field);if(q.groupBy!==undefined)getField(q.groupBy);
 if(['sum','min','max'].includes(q.operation)&&getField(q.field).type!=='number')throw fail(400,'数值统计需要数值字段');
 if(q.operation==='records'&&q.groupBy!==undefined)throw fail(400,'明细查询不支持分组');
 const filters=q.filters??[];if(!Array.isArray(filters)||filters.length>8)throw fail(400,'最多 8 个筛选条件');
 for(const f of filters){if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['field','operator','value'].includes(k))||!['eq','gte','lte'].includes(f.operator)||typeof f.value!=='string'||f.value.length>2000)throw fail(400,'筛选条件无效');const field=getField(f.field);if(f.operator!=='eq'&&!['number','date'].includes(field.type))throw fail(400,'范围筛选仅支持数值与日期');if(field.type==='number'&&!/^-?\d{1,15}(\.\d{1,6})?$/.test(f.value))throw fail(400,'数值筛选格式无效');if(field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(f.value)||!Number.isFinite(Date.parse(f.value))||new Date(f.value).toISOString().slice(0,10)!==f.value))throw fail(400,'日期筛选格式无效');}
 const visibleFields=definition.fields.filter(allowed);
 const needed=q.operation==='records'?visibleFields:visibleFields.filter(f=>f.name===q.field||f.name===q.groupBy||filters.some(x=>x.field===f.name));
 const source=preparedRows?[]:store.db.prepare("SELECT data FROM data_rows WHERE dataset_id=? AND tenant_id=? AND status='ready' ORDER BY updated_at DESC,id").all(id,u.tenantId) as {data:string}[];
 const records=(preparedRows??source.map(r=>JSON.parse(r.data) as {id:string;values:Record<string,string>})).filter(r=>!recordIds||recordIds.has(r.id)).map(r=>({...r,values:Object.fromEntries(needed.map(f=>[f.name,visibleText(model?{...u,clearance:0}:u,r.values[f.name]||'')]))})).filter(r=>filters.every(f=>{const value=r.values[f.field];if(!value)return false;const field=getField(f.field);if(field.type==='number'&&!/^-?\d{1,15}(\.\d{1,6})?$/.test(value))return false;const left=field.type==='number'?decimal(value):value,right=field.type==='number'?decimal(f.value):f.value;return f.operator==='eq'?left===right:f.operator==='gte'?left>=right:left<=right;}));
 const common={sourceFreshness,dataUpdatedAt:datasetUpdatedAt(store,u.tenantId,id,document.createdAt),datasetId:id,title:document.title,version:document.version,source:definition.source,purpose:definition.purpose,query:q,matchedRecords:records.length,scope:'仅质量检查通过且当前岗位可读的记录',dictionaryStatus,business,calculatedAt:new Date().toISOString()};
 if(q.operation==='records')return {document,result:{...common,fields:visibleFields,records:records.slice(0,limit),truncated:records.length>limit}};
 const groups=new Map<string,typeof records>();for(const r of records){const key=q.groupBy?r.values[q.groupBy]:'';const group=groups.get(key)||[];group.push(r);groups.set(key,group);}if(!q.groupBy&&!groups.size)groups.set('',[]);
 if(q.field&&records.some(r=>r.values[q.field!]&&!/^-?\d{1,15}(\.\d{1,6})?$/.test(r.values[q.field!])))throw fail(403,'统计字段含受限值，无法计算');
 const totals=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([group,rows])=>{const values=q.field?rows.map(r=>r.values[q.field!]).filter(Boolean).map(decimal):[];const value=q.operation==='count'?String(rows.length):!values.length?null:format(q.operation==='sum'?values.reduce((a,b)=>a+b,0n):values.reduce((a,b)=>q.operation==='min'?(a<b?a:b):(a>b?a:b)));return {group:q.groupBy?group:null,value,records:rows.length,nonEmptyValues:q.operation==='count'?rows.length:values.length};});
 return {document,result:{...common,groups:totals.slice(0,limit),totalGroups:totals.length,truncated:totals.length>limit}};
}
