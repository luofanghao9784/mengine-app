import {createHash} from 'node:crypto';
import type {Store} from './store.js';
import {canRegenerateDictionary,canGovernResource,canUseAI,now,type User} from './domain.js';
import {readDataset} from './foundation-query.js';
import {validateDefinition} from './data-dictionary.js';
import {dictionaryFingerprint,dictionarySchemaFingerprint} from './dictionary-version.js';
import {inspectSemanticSuggestions} from './semantic-suggestions.js';
import {recordChecks,scanStructured} from './structured-governance.js';
import {redactForGovernance} from './governance-ai.js';
import {createBusinessKnowledge} from './business-knowledge.js';
import {Model} from './model.js';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(statusCode:number,message:string)=>Object.assign(Error(message),{statusCode});
export function initializeDeployment(s:Store){
 s.db.exec(`CREATE TABLE IF NOT EXISTS deployment_governance_receipts(tenant_id TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant_id,id));
 CREATE TABLE IF NOT EXISTS deployment_knowledge(tenant_id TEXT NOT NULL,dataset_id TEXT NOT NULL,schema_fingerprint TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(tenant_id,dataset_id));`);
}
function source(s:Store,u:User,id:string){
 const d=readDataset(s,u,id);
 if(!u.active||!canRegenerateDictionary(u,d.document)||!canGovernResource(u,d.document)||!canUseAI(u,d.document))throw fail(403,'需要来源读取、治理与口径职责');
 const rows=(s.db.prepare('SELECT data FROM data_rows WHERE tenant_id=? AND dataset_id=? ORDER BY id').all(u.tenantId,id) as {data:string}[]).map(r=>JSON.parse(r.data));
 return {...d,rows,token:hash([d.document.version,d.document.policyVersion,d.document.grants,d.document.classification,d.definition,rows])};
}
export function deploymentContext(s:Store,u:User,ids:string[]){
 if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>typeof id!=='string'))throw fail(400,'一次部署选择 1–20 张表');
 return {tenantId:u.tenantId,datasets:ids.map(id=>{const d=source(s,u,id);return {id,token:d.token,title:d.document.title,fields:d.definition.fields,rows:d.rows.length,isolated:d.rows.filter(r=>r.status!=='ready').length};})};
}
// Invoked only by operator CLI or signed internal bridge; never exposed to browser accounts.
export function importDeployment(s:Store,u:User,input:any,preview=false){
 initializeDeployment(s);
 if(!input||input.contractVersion!=='1.0'||input.tenantId!==u.tenantId||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.id)||typeof input.producer!=='string'||input.producer.length>100||!input.producer.trim()||!Array.isArray(input.datasets)||!input.datasets.length||input.datasets.length>20)throw fail(400,'部署包格式或企业不匹配');
 const digest=hash(input),old=s.db.prepare('SELECT hash,data FROM deployment_governance_receipts WHERE tenant_id=? AND id=?').get(u.tenantId,input.id) as {hash:string;data:string}|undefined;
 if(old){if(old.hash!==digest)throw fail(409,'部署编号已被不同内容使用');for(const item of input.datasets)source(s,u,item.id);return {...JSON.parse(old.data),replayed:true};}
 if(new Set(input.datasets.map((x:any)=>x.id)).size!==input.datasets.length)throw fail(400,'重复数据集');
 const business=createBusinessKnowledge(s,new Model({apiKey:'',baseUrl:'https://invalid.example',model:'disabled',enabled:false}));
 let receipt:any;
 const rollback=Symbol('preview');
 try{s.db.transaction(()=>{
  const items=input.datasets.map((x:any)=>{if(s.db.prepare("SELECT 1 FROM business_knowledge WHERE tenant_id=? AND dataset_id=? AND state='running'").get(u.tenantId,x.id))throw fail(409,'知识生成正在运行，稍后导入');const d=source(s,u,x.id);if(d.token!==x.token)throw fail(409,'来源版本或权限变化，请重新导出部署上下文');return {x,d};});
  const ids=new Set((s.db.prepare('SELECT id FROM data_sets WHERE tenant_id=?').all(u.tenantId) as {id:string}[]).map(x=>x.id));
  for(const {x,d} of items){
   const definition=validateDefinition(x.definition,d.definition.fields.map((f:any)=>f.name));
   const inspected=inspectSemanticSuggestions(s,u,x.id,definition,ids);
   if(inspected.warnings.length)throw fail(422,'部署关联或查询规则未通过：'+inspected.warnings.join('；'));
   if(!Array.isArray(x.fieldEvidence)||x.fieldEvidence.length!==definition.fields.length||new Set(x.fieldEvidence.map((e:any)=>e.column)).size!==definition.fields.length||x.fieldEvidence.some((e:any)=>!definition.fields.some(f=>f.name===e.column)||!['SOURCE_DOCUMENTED','DEPLOYMENT_INFERRED','UNKNOWN'].includes(e.status)||typeof e.reference!=='string'||!e.reference.trim()||e.reference.length>500))throw fail(422,'每个字段必须携带来源依据与确定性标注');
   if(x.analysisPolicy!==undefined&&(Object.keys(x.analysisPolicy).some(k=>!['excludeFields','noSumFields'].includes(k))||['excludeFields','noSumFields'].some(k=>!Array.isArray(x.analysisPolicy[k])||x.analysisPolicy[k].some((n:any)=>!definition.fields.some(f=>f.name===n)))))throw fail(422,'分析字段约束无效');
   if(!Array.isArray(x.knowledge)||!x.knowledge.length||x.knowledge.length>10)throw fail(422,'每个数据集需要 1–10 篇部署知识');
   for(const k of x.knowledge){for(const key of ['title','intro','content'])if(typeof k[key]!=='string'||!k[key].trim()||k[key].length>(key==='content'?6000:150)||redactForGovernance(k[key])!==k[key])throw fail(422,'部署知识格式或敏感信息检查失败');if(!Array.isArray(k.fields)||!k.fields.length||k.fields.some((f:any)=>!definition.fields.some(d=>d.name===f)))throw fail(422,'部署知识必须引用本次字段依据');}
   for(const f of definition.fields)for(const key of ['label','meaning','unit','rules','evidence'] as const)if(redactForGovernance(f[key])!==f[key])throw fail(422,'口径不得包含敏感信息');
   const names=new Set(d.definition.fields.map((f:any)=>f.name));
   if(x.checks!==undefined&&(!Array.isArray(x.checks)||x.checks.length>20||x.checks.some((check:any)=>!check||!/^[-a-z0-9_]{1,60}$/.test(check.id)||!names.has(check.requiredField)||typeof check.reason!=='string'||!check.reason.trim()||check.reason.length>300||!check.when||typeof check.when!=='object'||Array.isArray(check.when)||Object.keys(check.when).length>5||Object.entries(check.when).some(([k,v])=>!names.has(k)||typeof v!=='string')||check.positiveField&&!d.definition.fields.some((f:any)=>f.name===check.positiveField&&f.type==='number'))))throw fail(422,'部署业务检查规则无效');
   const checks=recordChecks(d.definition.fields,d.rows);
   // Full deterministic recheck, including previously quarantined records; never approve away failures.
   for(const {row,issues} of checks)if(issues.length&&row.status==='ready')throw fail(422,'存在未隔离的异常记录，请先修复源接入');
   const prior=s.db.prepare('SELECT data FROM data_dictionary WHERE tenant_id=? AND dataset_id=?').get(u.tenantId,x.id) as {data:string}|undefined;
   const previous=prior?JSON.parse(prior.data):{revision:0,confirmed:null,history:[]};
   const confirmed={origin:'deployment',analysisPolicy:x.analysisPolicy||{excludeFields:[],noSumFields:[]},provider:input.producer,packageId:input.id,schemaFingerprint:dictionarySchemaFingerprint(d.definition),fingerprint:dictionaryFingerprint(s,u.tenantId,d.definition),definition:{...definition,...inspected.rules},fieldEvidence:x.fieldEvidence,checks:x.checks||[],confirmedBy:'部署治理',confirmedById:u.id,at:now(),reason:'部署依据核验与全量记录检查；推断和未知保持标记',warnings:x.fieldEvidence.filter((e:any)=>e.status!=='SOURCE_DOCUMENTED').map((e:any)=>e.column+': '+e.status)};
   s.version(d.document);d.document.version++;d.document.updatedAt=now();s.saveDoc(d.document);
   s.db.prepare('INSERT INTO data_dictionary VALUES(?,?,?) ON CONFLICT(dataset_id) DO UPDATE SET data=excluded.data').run(x.id,u.tenantId,JSON.stringify({revision:previous.revision+1,confirmed,suggestion:null,history:previous.confirmed?[previous.confirmed,...previous.history].slice(0,20):previous.history}));
   s.db.prepare("UPDATE dictionary_jobs SET state='succeeded',error='',next_at='',updated_at=? WHERE tenant_id=? AND dataset_id=?").run(now(),u.tenantId,x.id);
   s.recordFlow(d.document,'dictionary-generated');
   s.db.prepare('INSERT INTO deployment_knowledge VALUES(?,?,?,?) ON CONFLICT(tenant_id,dataset_id) DO UPDATE SET schema_fingerprint=excluded.schema_fingerprint,data=excluded.data').run(u.tenantId,x.id,confirmed.schemaFingerprint,JSON.stringify(x.knowledge.map((k:any,i:number)=>({id:`deployment-${x.id}-${i}`,sourceId:x.id,sourceTitle:d.document.title,sourceVersion:d.document.version,department:d.document.department,title:k.title,intro:k.intro,content:k.content,evidence:k.fields.map((f:string)=>({id:f,quote:definition.fields.find(d=>d.name===f)!.evidence})),createdAt:now(),model:input.producer,origin:'deployment',revision:previous.revision+1,sourceKind:0}))));
   s.audit(u,'deployment.governance.applied',x.id,`部署 ${input.id}；全量检查 ${d.rows.length} 条；保留异常隔离`);
  }
  const scan=scanStructured(s,u,new Set(input.datasets.map((x:any)=>x.id)));
  const outputs=items.map(({x,d}:any)=>{let profile=null;try{const p=business.profile(u,x.id);profile={fingerprint:p.c.fingerprint,input:p.input};}catch(e){if((e as any).statusCode!==409)throw e;}
   if(x.analysis){if(!profile)throw fail(422,'无有效数据可发布分析');business.publish(u,x.id,x.analysis.content,x.analysis.fingerprint,input.producer,true,'deployment');}
   return {id:x.id,checkedRows:d.rows.length,isolatedRows:d.rows.filter((r:any)=>r.status!=='ready').length,profile};});
  receipt={id:input.id,hash:digest,tenantId:u.tenantId,producer:input.producer,at:now(),datasets:outputs,scan,preview};
  if(preview)throw rollback;
  s.db.prepare('INSERT INTO deployment_governance_receipts VALUES(?,?,?,?)').run(u.tenantId,input.id,digest,JSON.stringify(receipt));
 })();}catch(e){if(e!==rollback)throw e;}
 return receipt;
}
