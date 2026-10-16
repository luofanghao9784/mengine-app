import {createHash} from 'node:crypto';
import {canUseAI, chunks, retrieve, visibleText, type Doc, type Evidence, type User} from './domain.js';
import type {Store} from './store.js';

export type WeKnoraConfig = {baseUrl:string; apiKey:string; tenantLibraries:Record<string,string>};
type Binding = {tenant:string; document:string; fingerprint:string; knowledge:string; library:string};
const safeText=(text:string)=>visibleText({clearance:0} as User,text);
export const indexFingerprint=(d:Doc)=>createHash('sha256').update(JSON.stringify([
  d.tenantId,d.id,d.version,d.policyVersion,d.title,safeText(d.content),
])).digest('hex');

/** The original store remains the authority for identity, visibility and citations. */
export class WeKnoraRetrieval {
  constructor(private store:Store, private config:WeKnoraConfig, private request:typeof fetch=fetch) {
    const libraries=Object.values(config.tenantLibraries);
    if(new Set(libraries).size!==libraries.length) throw new Error('不同企业不能共享同一知识索引');
    const url=new URL(config.baseUrl);
    if(url.username||url.password||!['http:','https:'].includes(url.protocol)) throw new Error('知识检索服务地址无效');
    if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('远程知识检索服务必须使用 HTTPS');
    store.db.exec(`CREATE TABLE IF NOT EXISTS weknora_bindings (
      tenant TEXT NOT NULL, document TEXT NOT NULL, fingerprint TEXT NOT NULL,
      knowledge TEXT NOT NULL, library TEXT NOT NULL,
      PRIMARY KEY(tenant,document), UNIQUE(library,knowledge));`);
  }
  private async api(path:string, body?:unknown) {
    const response=await this.request(`${this.config.baseUrl.replace(/\/$/,'')}/api/v1/${path}`,{
      method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{'Content-Type':'application/json','X-API-Key':this.config.apiKey},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    if(!response.ok) throw new Error('知识检索服务暂时不可用');
    const result=await response.json() as {success?:boolean;data?:unknown};
    if(result.success!==true) throw new Error('知识检索服务未完成请求');
    return result.data;
  }
  private binding(d:Doc) {
    return this.store.db.prepare('SELECT * FROM weknora_bindings WHERE tenant=? AND document=? AND fingerprint=? AND library=?')
      .get(d.tenantId,d.id,indexFingerprint(d),this.config.tenantLibraries[d.tenantId]||'') as Binding|undefined;
  }
  /** Explicit single-document import; never triggered by a user's search. No automatic paid corpus sweep. */
  async index(u:User, id:string) {
    const d=this.store.doc(u.tenantId,id);
    const initialActor=this.store.user(u.id);
    if(!d||!initialActor||initialActor.tenantId!==u.tenantId||!canUseAI(initialActor,d)) throw new Error('资料当前不可用于 AI');
    const library=this.config.tenantLibraries[u.tenantId];
    if(!library) throw new Error('企业尚未接通知识索引');
    const existing=this.binding(d);
    if(existing) {
      const status=await this.api(`knowledge/${encodeURIComponent(existing.knowledge)}`) as {parse_status?:string};
      if(status?.parse_status==='failed') throw new Error('知识索引处理失败，需排查后在检索服务重试');
      return {state:status?.parse_status==='completed'?'indexed':'submitted',knowledgeId:existing.knowledge};
    }
    if(!d.content.trim()||d.content.length>180000) throw new Error('资料为空或超过当前索引批次长度');
    const fingerprint=indexFingerprint(d);
    const data=await this.api(`knowledge-bases/${encodeURIComponent(library)}/knowledge/manual`,{
      title:safeText(d.title),content:safeText(d.content),status:'publish',
    }) as {id?:string};
    if(typeof data?.id!=='string'||!data.id) throw new Error('知识索引未返回有效来源');
    const latest=this.store.doc(u.tenantId,id), actor=this.store.user(u.id);
    if(!latest||!actor||!canUseAI(actor,latest)||indexFingerprint(latest)!==fingerprint)
      throw new Error('资料或权限已变化，本次索引不会用于检索');
    // Binding is safe before async parsing completes: no hits until upstream finishes indexing.
    this.store.db.prepare('INSERT OR REPLACE INTO weknora_bindings VALUES(?,?,?,?,?)')
      .run(d.tenantId,d.id,fingerprint,data.id,library);
    return {state:'submitted',knowledgeId:data.id};
  }
  async search(u:User, docs:Doc[], question:string):Promise<Evidence[]> {
    // Refresh from the authority rather than relying on request-time document objects.
    const actor=this.store.user(u.id);
    if(!actor||actor.tenantId!==u.tenantId) return [];
    const allowed=docs.map(d=>this.store.doc(u.tenantId,d.id)).filter((d):d is Doc=>!!d&&canUseAI(actor,d));
    const bindings=allowed.flatMap(d=>{const b=this.binding(d);return b?[{d,b}]:[];});
    const local=()=>retrieve(actor,allowed.filter(d=>{
      const latest=this.store.doc(u.tenantId,d.id), current=this.store.user(u.id);
      return !!latest&&!!current&&canUseAI(current,latest)&&indexFingerprint(latest)===indexFingerprint(d);
    }),question);
    if(!bindings.length) return local();
    try {
      // IMPORTANT: upstream combines KB IDs and knowledge IDs as a UNION. Never send KB IDs.
      const data=await this.api('knowledge-search',{
        query:safeText(question),knowledge_ids:bindings.map(x=>x.b.knowledge),
        match_count:12,disable_keywords_match:true,rerank:{enabled:false},
      });
      if(!Array.isArray(data)) return local();
      const result:Evidence[]=[];
      for(const hit of data) {
        if(!hit||typeof hit.content!=='string'||!hit.content.trim()) continue;
        const match=bindings.find(x=>x.b.knowledge===hit.knowledge_id&&x.b.library===hit.knowledge_base_id);
        if(!match) continue;
        const current=this.store.doc(u.tenantId,match.d.id), currentActor=this.store.user(u.id);
        if(!current||!currentActor||!canUseAI(currentActor,current)||indexFingerprint(current)!==match.b.fingerprint) continue;
        // Only quote text verifiably present in the local source, with original source offsets.
        const chunk=chunks(current.content).find(c=>safeText(c.text).includes(hit.content.trim()));
        if(!chunk) continue;
        result.push({id:result.length+1,documentId:current.id,title:current.title,version:current.version,
          chunkId:`${current.id}:${current.version}:${chunk.id}`,start:chunk.start,end:chunk.end,
          snippet:safeText(chunk.text),score:Number.isFinite(hit.score)?hit.score:0});
      }
      return [...result,...local()].filter((e,i,a)=>a.findIndex(x=>x.chunkId===e.chunkId)===i)
        .slice(0,12).map((e,i)=>({...e,id:i+1}));
    } catch {return local();}
  }
}

export function configuredRetrieval(store:Store) {
  if(process.env.WEKNORA_ENABLED!=='true') return undefined;
  const {WEKNORA_BASE_URL,WEKNORA_API_KEY,WEKNORA_TENANT_LIBRARIES}=process.env;
  if(!WEKNORA_BASE_URL||!WEKNORA_API_KEY||!WEKNORA_TENANT_LIBRARIES) throw new Error('知识检索服务配置不完整');
  const mapping:unknown=JSON.parse(WEKNORA_TENANT_LIBRARIES);
  if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||Object.values(mapping).some(v=>typeof v!=='string'||!v))
    throw new Error('企业知识索引映射无效');
  const values=Object.values(mapping);
  if(new Set(values).size!==values.length) throw new Error('不同企业不能共享同一知识索引');
  return new WeKnoraRetrieval(store,{baseUrl:WEKNORA_BASE_URL,apiKey:WEKNORA_API_KEY,tenantLibraries:mapping as Record<string,string>});
}
