import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Store} from './store.js';
import {canGovern,canManage,canRead,canGovernResource,now,type User} from './domain.js';
import {dictionaryFingerprint,currentDictionary} from './dictionary-version.js';
// Internal governance inspection does not confer ordinary read or AI access.
function readDataset(s:Store,u:User,id:string){const document=s.doc(u.tenantId,id);const row=s.db.prepare('SELECT data FROM data_sets WHERE tenant_id=? AND id=?').get(u.tenantId,id) as {data:string}|undefined;if(!document||!row||!canGovernResource(u,document))throw fail(404,'数据集不存在或无治理权限');const definition=JSON.parse(row.data);const dict=s.db.prepare('SELECT data FROM data_dictionary WHERE tenant_id=? AND dataset_id=?').get(u.tenantId,id) as {data:string}|undefined;const confirmed=dict?JSON.parse(dict.data).confirmed:null;const valid=currentDictionary(s,u.tenantId,definition,confirmed);return {document,definition:definition as {fields:Field[]},business:valid?confirmed.definition:null,businessChecks:valid&&confirmed.origin==='deployment'?confirmed.checks||[]:[],dictionaryStatus:valid?'generated':'changed'};}
import {validateSemantics,type Semantics} from './business-queries.js';
import type {Field} from './foundation.js';
const fail=(statusCode:number,message:string)=>Object.assign(Error(message),{statusCode});
type RecordRow={id:string;version:number;values:Record<string,string>;issues:string[];status:string;updatedAt:string;actor:string};
type Finding={id:string;datasetId:string;targetId?:string;kind:string;title:string;detail:string;field?:string;count:number;status:'open'|'handling'|'resolved';firstAt:string;lastAt:string;resolvedAt?:string;manualApproval?:string;checkedFingerprint?:string;history:{at:string;actor:string;action:string;note:string}[]};
function records(s:Store,t:string,id:string){return (s.db.prepare('SELECT data FROM data_rows WHERE tenant_id=? AND dataset_id=?').all(t,id) as {data:string}[]).map(r=>JSON.parse(r.data) as RecordRow);}
export function recordChecks(fields:Field[],rows:RecordRow[]){
 const counts=new Map<string,Map<string,number>>();for(const f of fields.filter(f=>f.unique)){const m=new Map<string,number>();for(const r of rows){const v=r.values[f.name];if(v)m.set(v,(m.get(v)||0)+1);}counts.set(f.name,m);}
 return rows.map(r=>({row:r,issues:fields.flatMap(f=>{const v=r.values[f.name]||'';let msg='';if(!v)msg=f.required?'必填值缺失':'';else if(f.type==='number'&&!/^-?\d{1,15}(\.\d{1,6})?$/.test(v))msg='数值格式无效';else if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))msg='日期格式无效';else if(f.type==='boolean'&&!['true','false'].includes(v))msg='布尔值无效';else if(f.unique&&(counts.get(f.name)?.get(v)||0)>1)msg='唯一值重复';return msg?[{field:f.name,message:`${f.label}：${msg}`}]:[];})}));
}
export function contradictoryFilters(filters:{field:string;operator:string;value:string}[],fields:Field[]){
 for(const f of fields){const rules=filters.filter(x=>x.field===f.name&&!x.value.startsWith('$'));const equals=rules.filter(x=>x.operator==='eq');
  const normalize=(v:string)=>f.type==='number'?BigInt(v.split('.')[0]||'0')*1000000n+(v.startsWith('-')?-1n:1n)*BigInt((v.split('.')[1]||'').padEnd(6,'0')):v;
  try{const eq=equals.map(x=>normalize(x.value));if(eq.some(v=>v!==eq[0]))return true;
   const lower=rules.filter(x=>x.operator==='gte').map(x=>normalize(x.value)),upper=rules.filter(x=>x.operator==='lte').map(x=>normalize(x.value));
   if(lower.some(a=>upper.some(b=>a>b))||eq.some(v=>lower.some(a=>v<a)||upper.some(b=>v>b)))return true;
  }catch{ /* Invalid numeric literals are reported by the normal template validator. */ }
 }return false;
}
function visible(s:Store,u:User,id:string){const d=s.doc(u.tenantId,id);return !!d&&d.status!=='archived'&&canGovernResource(u,d);}
// Approval covers the inspected issue and its source/related snapshots only.
function approvalFingerprint(s:Store,u:User,f:Pick<Finding,'id'|'datasetId'|'targetId'|'kind'|'detail'|'count'>){
 const snapshots=[f.datasetId,...(f.targetId?[f.targetId]:[])].map(id=>({
  document:s.doc(u.tenantId,id),
  definition:s.db.prepare('SELECT data FROM data_sets WHERE tenant_id=? AND id=?').get(u.tenantId,id),
  dictionary:s.db.prepare('SELECT data FROM data_dictionary WHERE tenant_id=? AND dataset_id=?').get(u.tenantId,id),
  sync:['sync','freshness'].includes(f.kind)?(s.db.prepare('SELECT id,data FROM database_sync_jobs WHERE tenant_id=? ORDER BY id').all(u.tenantId) as {id:string;data:string}[]).map(r=>JSON.parse(r.data)).filter(j=>j.datasetId===id):undefined,
  rows:s.db.prepare('SELECT data FROM data_rows WHERE tenant_id=? AND dataset_id=? ORDER BY id').all(u.tenantId,id),
 }));
 return createHash('sha256').update(JSON.stringify({id:f.id,kind:f.kind,detail:f.detail,count:f.count,snapshots})).digest('hex');
}
export function scanStructured(s:Store,u:User,selected?:Set<string>){
 const at=now(),fresh:Omit<Finding,'status'|'firstAt'|'lastAt'|'history'>[]=[],tables:any[]=[],scope=new Set<string>(),blocked=new Set<string>();
 const add=(datasetId:string,kind:string,key:string,title:string,detail:string,count=1,field?:string,targetId?:string)=>fresh.push({id:createHash('sha256').update([u.tenantId,datasetId,kind,key].join(':')).digest('hex'),datasetId,kind,title,detail,count,field,targetId});
 for(const entry of s.db.prepare('SELECT id FROM data_sets WHERE tenant_id=?').all(u.tenantId) as {id:string}[]){
  if(selected&&!selected.has(entry.id)||!visible(s,u,entry.id))continue;const id=entry.id,{document:d,definition:def,business,businessChecks,dictionaryStatus}=readDataset(s,u,id);scope.add(id);const semantics=business as Semantics|null;
  const rows=records(s,u.tenantId,id),checked=recordChecks(def.fields,rows);const relationReports:any[]=[];
  for(const f of def.fields){if(f.sensitive&&u.clearance<2)continue;const bad=checked.filter(x=>x.issues.some(i=>i.field===f.name));if(bad.length)add(id,'field',f.name,'字段质量异常',`${f.label}存在必填、格式或唯一性问题；请在来源系统修正并同步后重新校验。`,bad.length,f.name);}
  const isolated=rows.filter(r=>r.status==='quarantined').length;if(isolated)add(id,'isolated','rows','隔离记录待处理','隔离记录不进入 Agent 受控查询；更正后重新校验，符合规则才恢复使用。',isolated);
  for(const check of businessChecks){
   const matching=rows.filter(r=>Object.entries(check.when).every(([k,v])=>r.values[k]===v)&&(!check.positiveField||Number(r.values[check.positiveField])>0));
   const missing=matching.filter(r=>!r.values[check.requiredField]).length;
   if(missing)add(id,'field','deployment:'+check.id,'部署业务核对未通过',check.reason,missing,check.requiredField);
  }
  if(dictionaryStatus!=='generated')add(id,'semantics','dictionary','模型口径尚未生效','后台生成或更新中；模型解释不等于已核实的业务事实。');
  for(const r of semantics?.relations||[]){
   if(!visible(s,u,r.targetId)){blocked.add(id+':'+r.targetId);continue;}
   const target=readDataset(s,u,r.targetId);
   try{validateSemantics(s,u,id,{relations:[r],templates:[]});}catch{add(id,'rule',r.id,'关联规则失效','源字段、目标结构或关联规则已变化，需要重新生成口径。',1,undefined,r.targetId);continue;}
   const key=(row:RecordRow,side:'local'|'foreign')=>JSON.stringify(r.keys.map(k=>{const name=k[side],v=row.values[name]||'',f=(side==='local'?def:target.definition).fields.find(f=>f.name===name);return f?.type==='number'?v.replace(/^(-?)0+(?=\d)/,'$1').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'').replace(/^-0$/,'0'):v;}));
   const targetRows=records(s,u.tenantId,r.targetId).filter(x=>x.status==='ready'),keys=new Map<string,number>();for(const row of targetRows){if(r.keys.some(k=>!row.values[k.foreign]))continue;const k=key(row,'foreign');keys.set(k,(keys.get(k)||0)+1);}
   const eligible=rows.filter(x=>x.status==='ready'&&r.keys.every(k=>!!x.values[k.local]));const missing=eligible.filter(x=>!keys.has(key(x,'local'))).length,ambiguous=eligible.filter(x=>(keys.get(key(x,'local'))||0)>1).length;
   relationReports.push({name:r.name,target:target.document.title,targetId:r.targetId,eligible:eligible.length,missing,ambiguous,matchRate:eligible.length?Math.round((eligible.length-missing)/eligible.length*10000)/100:null,evidence:r.evidence});
   if(missing)add(id,'relation',r.id,'关联未匹配记录',`${r.name}：${missing}/${eligible.length} 条非空关联键在目标可用快照中未匹配。可能是快照时间差或模型关系不成立，不自动隔离。`,missing,undefined,r.targetId);
   if(ambiguous)add(id,'rule','duplicate:'+r.id,'关联多重匹配风险',`${r.name}：${ambiguous} 条记录匹配多个目标。直接展开连表可能重复计数；需结合实际业务判断。`,ambiguous,undefined,r.targetId);
  }
  for(const t of semantics?.templates||[]){const rel=t.related?semantics?.relations?.find(r=>r.id===t.related!.relationId):undefined;if(rel&&!visible(s,u,rel.targetId))continue;try{validateSemantics(s,u,id,{relations:rel?[rel]:[],templates:[t]});if(contradictoryFilters(t.filters,def.fields)||rel&&t.related&&contradictoryFilters(t.related.filters,readDataset(s,u,rel.targetId).definition.fields))throw Error('筛选条件互相冲突');}catch{add(id,'rule','template:'+t.id,'业务查询规则冲突','模型查询模板与当前字段或关联规则不兼容，需更新模型口径。',1,undefined,rel?.targetId);}}
  const jobs=(s.db.prepare('SELECT data FROM database_sync_jobs WHERE tenant_id=?').all(u.tenantId) as {data:string}[]).map(r=>JSON.parse(r.data)).filter(j=>j.datasetId===id);
  for(const j of jobs){if(j.state==='failed')add(id,'sync',j.id,'源库同步失败','本次同步失败，保留上次快照。请检查连接、来源结构和任务账号权限。');if(j.enabled&&Date.now()-Date.parse(j.lastSuccess||d.createdAt)>j.intervalMinutes*60000*2)add(id,'freshness',j.id,'数据新鲜度超期',`超过两个同步周期未成功检查源库，当前快照可能滞后；周期 ${j.intervalMinutes} 分钟。`);}
  tables.push({id,title:d.title,version:d.version,fields:def.fields.length,total:rows.length,isolated,invalid:checked.filter(x=>x.issues.length).length,canRepair:canGovernResource(u,d)&&u.clearance>=2,relations:relationReports,freshness:jobs.some(j=>j.enabled)?'按同步周期检查':'未启用同步，无法判断源库新鲜度'});
 }
 const old=(s.db.prepare('SELECT data FROM structured_findings WHERE tenant_id=?').all(u.tenantId) as {data:string}[]).map(r=>JSON.parse(r.data) as Finding);
 const accessible=(f:Finding)=>scope.has(f.datasetId)&&(!f.targetId||visible(s,u,f.targetId))&&(!f.field||u.clearance>=2||!readDataset(s,u,f.datasetId).definition.fields.find(x=>x.name===f.field)?.sensitive);
 s.db.transaction(()=>{
  const save=(f:Finding)=>s.db.prepare('INSERT INTO structured_findings VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(f.id,u.tenantId,JSON.stringify(f));
  for(const f of fresh){f.checkedFingerprint=approvalFingerprint(s,u,f);const prev=old.find(x=>x.id===f.id);if(prev?.status==='resolved'&&prev.manualApproval===f.checkedFingerprint){save({...prev,checkedFingerprint:f.checkedFingerprint,lastAt:at});continue;}const changed=!prev||prev.status==='resolved';const item:Finding={...prev,...f,status:prev&&prev.status!=='resolved'?prev.status:'open',firstAt:prev?.firstAt||at,lastAt:at,resolvedAt:undefined,manualApproval:undefined,history:changed?[...(prev?.history||[]),{at,actor:u.name,action:prev?'重新发现':'发现问题',note:f.title}].slice(-50):prev.history};save(item);if(changed)s.audit(u,'structured.issue.detected',f.datasetId,f.title);}
  for(const f of old){if(f.status==='resolved'||!accessible(f)||blocked.has(f.datasetId+':'+f.targetId)||(['relation','rule'].includes(f.kind)&&readDataset(s,u,f.datasetId).dictionaryStatus!=='generated')||fresh.some(x=>x.id===f.id))continue;f.status='resolved';f.resolvedAt=at;f.lastAt=at;f.history.push({at,actor:u.name,action:'复检通过',note:'当前快照中该问题已消失'});f.history=f.history.slice(-50);save(f);s.audit(u,'structured.issue.resolved',f.datasetId,f.title);}
 })();
 const findings=(s.db.prepare('SELECT data FROM structured_findings WHERE tenant_id=?').all(u.tenantId) as {data:string}[]).map(r=>JSON.parse(r.data) as Finding).filter(accessible);
 return {at,tables,findings,intervalSeconds:60};
}
export function registerStructuredGovernance(app:FastifyInstance,s:Store,session:(r:FastifyRequest)=>User){
 s.db.exec('CREATE TABLE IF NOT EXISTS structured_findings(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,data TEXT NOT NULL)');
 const auth=(req:FastifyRequest)=>{const u=session(req);if(!canGovern(u))throw fail(403,'没有治理权限');return u;};
 app.get('/api/governance/structured',async req=>scanStructured(s,auth(req)));
 app.post('/api/governance/structured/scan',async req=>{const u=auth(req);const result=scanStructured(s,u);s.audit(u,'structured.scan','结构化数据',`检查 ${result.tables.length} 张授权表`);return result;});
 app.post<{Params:{id:string};Body:{reason:string}}>('/api/governance/structured/issues/:id/handle',{schema:{body:{type:'object',additionalProperties:false,required:['reason'],properties:{reason:{type:'string',minLength:1,maxLength:300}}}}},async req=>{
  const u=auth(req),r=s.db.prepare('SELECT data FROM structured_findings WHERE id=? AND tenant_id=?').get(req.params.id,u.tenantId) as {data:string}|undefined;if(!r)throw fail(404,'问题不存在');const f=JSON.parse(r.data) as Finding;
  if(f.field&&u.clearance<2&&readDataset(s,u,f.datasetId).definition.fields.find(x=>x.name===f.field)?.sensitive)throw fail(403,'无权处理受限字段');
  if(!visible(s,u,f.datasetId)||f.targetId&&!visible(s,u,f.targetId)||!canGovernResource(u,s.doc(u.tenantId,f.datasetId)!))throw fail(403,'无权处理此问题');if(f.status==='resolved')throw fail(409,'问题已经复检关闭');if(!req.body.reason.trim())throw fail(400,'请填写处理说明');f.status='handling';f.history.push({at:now(),actor:u.name,action:'开始处理',note:req.body.reason.trim()});f.history=f.history.slice(-50);s.db.transaction(()=>{s.db.prepare('UPDATE structured_findings SET data=? WHERE id=? AND tenant_id=?').run(JSON.stringify(f),f.id,u.tenantId);s.audit(u,'structured.issue.handling',f.datasetId,req.body.reason);})();return {ok:true};
 });
 app.post<{Params:{id:string};Body:{expectedVersion:number;reason:string}}>('/api/governance/structured/issues/:id/approve',{schema:{body:{type:'object',additionalProperties:false,required:['expectedVersion','reason'],properties:{expectedVersion:{type:'integer',minimum:1},reason:{type:'string',minLength:1,maxLength:300}}}}},async req=>{
  const u=auth(req),r=s.db.prepare('SELECT data FROM structured_findings WHERE id=? AND tenant_id=?').get(req.params.id,u.tenantId) as {data:string}|undefined;
  if(!r)throw fail(404,'问题不存在');const f=JSON.parse(r.data) as Finding,d=s.doc(u.tenantId,f.datasetId);
  if(!d||!visible(s,u,f.datasetId)||f.targetId&&!visible(s,u,f.targetId)||!canGovernResource(u,d)||u.clearance<2)throw fail(403,'人工校验需要治理职责及 L2 以上密级');
  if(d.status!=='ready'||d.version!==req.body.expectedVersion||f.status==='resolved')throw fail(409,'数据版本或问题状态已变化，请刷新');
  if(!f.checkedFingerprint||f.checkedFingerprint!==approvalFingerprint(s,u,f))throw fail(409,'数据、关联表或业务规则已变化，请重新检查后校验');
  const note=req.body.reason.trim();if(!note)throw fail(400,'请填写校验说明');
  const at=now();f.status='resolved';f.resolvedAt=at;f.lastAt=at;f.manualApproval=approvalFingerprint(s,u,f);f.history.push({at,actor:u.name,action:'人工校验通过',note});f.history=f.history.slice(-50);
  s.db.transaction(()=>{s.db.prepare('UPDATE structured_findings SET data=? WHERE id=? AND tenant_id=?').run(JSON.stringify(f),f.id,u.tenantId);s.audit(u,'structured.issue.approved',f.datasetId,`${f.title}；${note}`);})();
  return {ok:true};
 });
 app.post<{Params:{id:string};Body:{expectedVersion:number;reason:string}}>('/api/governance/structured/:id/recheck',{schema:{body:{type:'object',additionalProperties:false,required:['expectedVersion','reason'],properties:{expectedVersion:{type:'integer',minimum:1},reason:{type:'string',minLength:1,maxLength:300}}}}},async req=>{
  const u=auth(req),{document:d,definition:def}=readDataset(s,u,req.params.id);if(!canGovernResource(u,d)||u.clearance<2)throw fail(403,'复检恢复需要治理职责及 L2 以上密级');if(d.status!=='ready'||d.version!==req.body.expectedVersion)throw fail(409,'数据状态或版本已变化，请刷新');if(!req.body.reason.trim())throw fail(400,'请填写复检依据');const checked=recordChecks(def.fields,records(s,u.tenantId,d.id));let recovered=0,isolated=0;
  s.db.transaction(()=>{s.version(d);for(const x of checked){const issues=x.issues.map(i=>i.message),state=issues.length?'quarantined':'ready';if(state===x.row.status&&JSON.stringify(issues)===JSON.stringify(x.row.issues))continue;
   s.db.prepare('INSERT INTO data_row_versions VALUES(?,?,?,?,?)').run(d.id,u.tenantId,x.row.id,x.row.version,JSON.stringify(x.row));if(state==='ready'&&x.row.status==='quarantined')recovered++;if(state==='quarantined'&&x.row.status==='ready')isolated++;
   Object.assign(x.row,{issues,status:state,version:x.row.version+1,updatedAt:now(),actor:u.name});s.db.prepare('UPDATE data_rows SET status=?,updated_at=?,data=? WHERE id=? AND tenant_id=?').run(state,x.row.updatedAt,JSON.stringify(x.row),x.row.id,u.tenantId);
  }d.version++;d.updatedAt=now();s.saveDoc(d);s.recordFlow(d,'records-checked');s.db.prepare('INSERT INTO data_batches(dataset_id,tenant_id,data) VALUES(?,?,?)').run(d.id,u.tenantId,JSON.stringify({id:randomUUID(),at:now(),actor:u.name,version:d.version,operation:'治理复检',reason:req.body.reason,recovered,isolated}));s.audit(u,'structured.rechecked',d.title,`${req.body.reason}；恢复 ${recovered} 条，新增隔离 ${isolated} 条`);})();return {recovered,isolated,...scanStructured(s,u)};
 });
 const timer=setInterval(()=>{for(const row of s.db.prepare('SELECT id FROM tenants').all() as {id:string}[]){const u=s.users(row.id).find(u=>u.active&&u.role==='admin');if(u){try{scanStructured(s,u);}catch{/* One tenant must not interrupt other tenants. */}}}},60000);timer.unref();return ()=>clearInterval(timer);
}
