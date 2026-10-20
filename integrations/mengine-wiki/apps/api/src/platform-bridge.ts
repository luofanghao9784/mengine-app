import {ninepopBusinessChains} from './ninepop-business-chains.js';
import {deploymentContext,importDeployment} from './deployment-governance.js';
import {canUseCurrentData} from './data-availability.js';
import { createHmac, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Store } from './store.js';
import { digest } from './store.js';
import { canUseAI } from './domain.js';
import { readDataset } from './foundation-query.js';
import { redactForGovernance } from './governance-ai.js';
import { exportGovernance, governDerivedAssets } from './platform-governance.js';
import {dictionaryFingerprint,dictionarySchemaFingerprint} from './dictionary-version.js';

// Operator-owned bindings. Browser requests never choose a source tenant or service identity.
export function registerPlatformBridge(app: FastifyInstance, store: Store, secret: string) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS platform_tenant_bindings(platform_tenant TEXT PRIMARY KEY,source_tenant TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_actor_bindings(platform_tenant TEXT NOT NULL,actor_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(platform_tenant,actor_id),UNIQUE(platform_tenant,user_id));
    CREATE TABLE IF NOT EXISTS platform_bridge_nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  app.post<{Body:{payload:string;signature:string}}>('/api/internal/platform-scene', {
    schema:{body:{type:'object',additionalProperties:false,required:['payload','signature'],properties:{payload:{type:'string',maxLength:1048576},signature:{type:'string',pattern:'^[a-f0-9]{64}$'}}}},
  }, async (req,reply) => {
    if(secret.length<32)return reply.code(503).send({message:'总台接口未配置'});
    const expected=createHmac('sha256',secret).update(req.body.payload).digest();
    if(!timingSafeEqual(expected,Buffer.from(req.body.signature,'hex')))return reply.code(401).send({message:'接口签名无效'});
    let p:any; try{p=JSON.parse(Buffer.from(req.body.payload,'base64url').toString('utf8'));}catch{return reply.code(400).send({message:'接口格式无效'});}
    if(!p || typeof p !== 'object' || typeof p.tenant!=='string'||typeof p.actor!=='string'||typeof p.nonce!=='string'||p.nonce.length>100||!Number.isSafeInteger(p.at)||Math.abs(Date.now()-p.at)>60000)return reply.code(401).send({message:'接口请求已过期'});
    store.db.prepare('DELETE FROM platform_bridge_nonces WHERE expires<?').run(Date.now());
    if(store.db.prepare('SELECT nonce FROM platform_bridge_nonces WHERE nonce=?').get(p.nonce))return reply.code(409).send({message:'重复接口请求'});
    store.db.prepare('INSERT INTO platform_bridge_nonces VALUES(?,?)').run(p.nonce,Date.now()+120000);
    const binding=store.db.prepare('SELECT source_tenant,user_id FROM platform_tenant_bindings WHERE platform_tenant=?').get(p.tenant) as {source_tenant:string;user_id:string}|undefined;
    let mapped=p.actor.startsWith('customer:') ? store.db.prepare('SELECT user_id FROM platform_actor_bindings WHERE platform_tenant=? AND actor_id=?').get(p.tenant,p.actor.slice(9)) as {user_id:string}|undefined : binding;
    if(binding&&!mapped&&p.actor.startsWith('customer:')){
      const actor=p.actor.slice(9);
      if(!p.identity||p.identity.id!==actor||typeof p.identity.name!=='string'||p.identity.name.length>160)return reply.code(403).send({message:'企业身份未验证'});
      const created={id:randomUUID(),tenantId:binding.source_tenant,name:p.identity.name,email:randomUUID()+'@platform.internal.invalid',department:'未分配',role:'member' as const,clearance:0,active:true,duties:{}};
      store.db.transaction(()=>{store.addUser(created,randomBytes(48).toString('hex'));store.db.prepare('INSERT INTO platform_actor_bindings VALUES(?,?,?)').run(p.tenant,actor,created.id);store.audit(created,'identity.linked',created.id,'企业接口验证身份，初始化为 L0 岗位成员；未继承服务管理员权限');})();
      mapped={user_id:created.id};
    }
    const u=binding&&mapped&&store.user(mapped.user_id);
    if(!u?.active||u.tenantId!==binding?.source_tenant||(!p.actor.startsWith('customer:')&&!['admin','steward'].includes(u.role)))return reply.code(404).send({message:'该企业尚未绑定数据来源'});
    if(p.path?.startsWith('/deployment-governance/')){
      if(p.actor.startsWith('customer:'))return reply.code(403).send({message:'仅部署维护服务可导入治理成果'});
      if(p.method!=='POST')return reply.code(405).send({message:'仅支持签名部署请求'});
      if(p.path==='/deployment-governance/source'){
        const b=p.body??{},operation=b.operation;
        const path=operation==='create'?'/api/database-connections':
          ['scan','pull','sync'].includes(operation)&&typeof b.connectionId==='string'&&/^[a-zA-Z0-9-]+$/.test(b.connectionId)?`/api/database-connections/${b.connectionId}/${operation}`:null;
        if(!path)return reply.code(400).send({message:'非法来源部署操作'});
        const token=randomBytes(32).toString('hex');store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,new Date(Date.now()+300000).toISOString());
        try{const result=await app.inject({method:'POST',url:path,headers:{cookie:'mengine_session='+token},payload:b.payload??{}});return reply.code(result.statusCode).send(result.json());}
        finally{store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));}
      }
      if(p.path==='/deployment-governance/context')return deploymentContext(store,u,p.body?.ids);
      if(p.path==='/deployment-governance/preview')return importDeployment(store,u,p.body,true);
      if(p.path==='/deployment-governance/apply')return importDeployment(store,u,p.body);
      return reply.code(404).send({message:'未知部署操作'});
    }
    const requested=p.body?.restrictedSourceIds;
    if(requested!==undefined&&(!Array.isArray(requested)||requested.length>100||requested.some((id:unknown)=>typeof id!=='string'||id.length>160)))return reply.code(400).send({message:'受限来源清单无效'});
    const scoped=new Set<string>(!p.actor.startsWith('customer:')?(requested||[]):[]);
    const get=p.method==='GET'&&/^\/scene-(foundation(?:\/[^/?]+)?|knowledge(?:\/[^/?]+\/source)?)$/.test(p.path);
    const post=p.method==='POST'&&/^\/scene-(foundation(?:\/scan|\/[^/?]+\/actions)|knowledge\/sync)$/.test(p.path);
    if(p.method==='GET'&&p.path==='/scene-export'&&!p.actor.startsWith('customer:')){
      const assets=store.documents(u.tenantId).filter(d=>(!d.restrictedContent||scoped.has(d.id))&&canUseCurrentData(store,u,d)).map(d=>{
        const base={id:d.id,title:d.title,kind:d.kind,version:d.version,policyVersion:d.policyVersion,tags:d.tags,department:d.department,updatedAt:d.updatedAt,governance:exportGovernance(store,p.tenant,p.actor,u,d)};
        if(d.kind!=='数据表')return {...base,content:redactForGovernance(d.content)};
        const set=readDataset(store,u,d.id);if((set.definition as any).provenance?.governanceMode==='deployment'&&set.dictionaryStatus!=='generated')return null;const fields=set.definition.fields.filter(f=>!f.sensitive);
        const rows=(store.db.prepare("SELECT data FROM data_rows WHERE tenant_id=? AND dataset_id=? AND status='ready' ORDER BY id").all(u.tenantId,d.id) as {data:string}[]).map(r=>{const raw=JSON.parse(r.data),v=raw.values;return fields.map(f=>raw.sourceNullFields?.includes(f.name)?null:redactForGovernance(String(v[f.name]??'')));});
        const dictionaryRow=store.db.prepare('SELECT data FROM data_dictionary WHERE dataset_id=? AND tenant_id=?').get(d.id,u.tenantId) as {data:string}|undefined;
        const batch=store.db.prepare('SELECT data FROM data_batches WHERE tenant_id=? AND dataset_id=? ORDER BY rowid DESC LIMIT 1').get(u.tenantId,d.id) as {data:string}|undefined;
        const receipt=batch?JSON.parse(batch.data).sourceReceipt:null;
        return {...base,sourceReadAt:receipt?.snapshot?.readAt??null,coverageThrough:receipt?.snapshot?.coverageThrough??null,fields,analysisPolicy:set.analysisPolicy,fieldEvidence:set.fieldEvidence,dictionary:set.dictionaryStatus==='generated'?set.business:null,dictionaryStatus:set.dictionaryStatus,dictionaryRevision:dictionaryRow?JSON.parse(dictionaryRow.data).revision:0,dictionaryFingerprint:dictionaryFingerprint(store,u.tenantId,set.definition),dictionarySchemaFingerprint:'schema:'+dictionarySchemaFingerprint(set.definition),rows};
      }).filter(Boolean);
      if(process.env.NINEPOP_CHAIN_EXPORT_ENABLED==='true')assets.push(...ninepopBusinessChains(assets as any));
      governDerivedAssets(assets);
      const revision=digest(JSON.stringify(assets));
      return {contractVersion:'1.1',tenantId:p.tenant,revision,assets};
    }
    const access=(p.method==='GET'&&/^\/scene-access(?:\/audit)?$/.test(p.path)) || (p.method==='POST'&&/^\/scene-access\/(?:policy|departments|members\/[^/?]+|proposals\/[^/?]+\/(?:resolve|withdraw)|resources\/[^/?]+\/inspect)$/.test(p.path));
    if(!get&&!post&&!access)return reply.code(404).send({message:'接口未开放'});
    const token=randomBytes(32).toString('hex');
    store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),u.id,new Date(Date.now()+300000).toISOString());
    try{
      if(p.method==='POST')store.audit(u,'platform.scene.dispatch',p.path,`总台企业 ${p.tenant}；发起人 ${p.actor}`);
      const result=await app.inject({method:p.method,url:'/api'+p.path+(p.method==='GET'&&p.path==='/scene-knowledge'&&!p.actor.startsWith('customer:')?'?view=sources':''),headers:{cookie:'mengine_session='+token},...(p.method==='POST'?{payload:p.body??{}}:{})});
      const body=result.json();
      // Central export currently targets a shared scene workspace. Restricted
      // source-derived knowledge must not be flattened into that workspace.
      if(p.method==='GET'&&p.path==='/scene-knowledge'&&!p.actor.startsWith('customer:')&&!p.actor.startsWith('deployment:')){
        const restricted=store.documents(u.tenantId).filter(d=>d.restrictedContent&&!scoped.has(d.id)).map(d=>d.id);
        body.items=(body.items||[]).filter((k:any)=>!restricted.some(id=>k.id.startsWith('business-'+id+'-')||k.id.startsWith('deployment-'+id+'-')));
        const visible=new Set(body.items.map((k:any)=>k.id));body.sourceKind=Object.fromEntries(Object.entries(body.sourceKind||{}).filter(([id])=>visible.has(id)));
        body.relations=(body.relations||[]).filter((r:any)=>visible.has(r[0])&&visible.has(r[1]));
      }
      return reply.code(result.statusCode).send(body);
    }finally{store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));}
  });
}
