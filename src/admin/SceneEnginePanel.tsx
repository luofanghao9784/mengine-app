import {useEffect,useState} from 'react';
import './scene-engine-panel.css';
import {createIdentityRequest} from '../identity/client';
const request=createIdentityRequest(fetch,240000);
const valid=<T,>(v:unknown):v is T=>v!==null&&typeof v==='object';
type Enterprise={tenant_id:string;name:string;datasets:number;materials:number};
type State={tenantId:string;assets:{source_id:string;kind:string;metadata:{title?:string;tags?:string[];dictionary?:{tableMeaning?:string;fields?:{name:string;meaning?:string;unit?:string}[]}}}[];runs:{id:string;operation:string;state:string}[]};
export function SceneEnginePanel(){
 const [enterprises,setEnterprises]=useState<Enterprise[]>([]),[tenant,setTenant]=useState(''),[state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;request<Enterprise[]>('/api/platform-admin/v1/scene-enterprises','GET',valid).then(r=>{if(active){setEnterprises(r);setTenant(r[0]?.tenant_id||'');}}).catch(e=>active&&setError(e.message));return()=>{active=false};},[]);
 useEffect(()=>{setState(null);if(!tenant)return;const controller=new AbortController();request<State>(`/api/platform-admin/v1/tenants/${tenant}/scene/status`,'GET',valid,undefined,controller.signal).then(setState).catch(e=>!controller.signal.aborted&&setError(e.message));return()=>controller.abort();},[tenant]);
 async function run(process:boolean){setBusy(true);setError('');const id=tenant;try{
  if(process)await request(`/api/platform-admin/v1/tenants/${id}/scene/dispatch?path=${encodeURIComponent('/scene-knowledge/sync')}`,'POST',valid,{retry:true});
  const next=await request<State>(`/api/platform-admin/v1/tenants/${id}/scene/synchronize`,'POST',valid,{});setState(next);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="scene-engine-panel">
  <h2>企业数据底座接入</h2><p>按企业接收数据表、资料、标签与业务口径，交由引擎处理。</p>
  {error&&<p role="alert">{error}</p>}
  <label>企业 <select aria-label="引擎接入企业" value={tenant} disabled={busy} onChange={e=>setTenant(e.target.value)}>{enterprises.map(e=><option key={e.tenant_id} value={e.tenant_id}>{e.name}</option>)}</select></label>
  <button disabled={!tenant||busy} onClick={()=>void run(false)}>{busy?'正在处理…':'同步企业输入'}</button>
  <button disabled={!tenant||busy} onClick={()=>void run(true)}>处理知识并收纳输出</button>
  {!enterprises.length&&<p>尚未绑定企业数据来源。</p>}
  {state&&<><p>数据库 {state.assets.filter(a=>a.kind==='TABLE').length} 项 · 资料与知识 {state.assets.filter(a=>a.kind!=='TABLE').length} 项</p>
   <details><summary>标签与口径</summary>{[...state.assets].sort((a,b)=>Number(b.kind==='TABLE')-Number(a.kind==='TABLE')).map(a=><article key={a.kind+a.source_id}><h3>{a.metadata.title||a.source_id}</h3><p>{a.metadata.tags?.join(' · ')||'未设置标签'}</p><p>{a.metadata.dictionary?.tableMeaning}</p>{a.metadata.dictionary?.fields?.map(f=><p key={f.name}>{f.name}：{f.meaning} {f.unit}</p>)}</article>)}</details>
   <details><summary>处理记录</summary>{state.runs.map(r=><p key={r.id}>{r.operation} · {r.state}</p>)}</details></>}
 </section>;
}
