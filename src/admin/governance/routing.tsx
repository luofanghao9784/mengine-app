import {useEffect,useState} from 'react';
import {createIdentityRequest} from '../../identity/client';
const request=createIdentityRequest(fetch,240000);
type Route={sourceId:string;workspaceId:string;readers:string[]};
type Config={revision:number;routes:Route[];sources:{id:string;name:string}[];members:{id:string;name:string}[]};
const valid=(v:unknown):v is Config=>!!v&&typeof v==='object'&&Array.isArray((v as Config).routes)&&Array.isArray((v as Config).members);
export function Routing({tenant,workspaces,onSaved}:{tenant:string;workspaces:{id:string;name:string}[];onSaved:()=>void}){
 const [config,setConfig]=useState<Config|null>(null),[routes,setRoutes]=useState<Route[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const path=`/api/tenant-admin/v1/tenants/${tenant}/scene/routes`;
 useEffect(()=>{const controller=new AbortController();setConfig(null);setRoutes([]);setNotice('');setError('');void request<Config>(path,'GET',valid,undefined,controller.signal).then(c=>{if(!controller.signal.aborted){setConfig(c);setRoutes(c.routes);setSelected(c.sources[0]?.id??'');}}).catch(()=>{if(!controller.signal.aborted)setError('无法读取分空间配置，请核对数据服务及管理资格。');});return()=>controller.abort();},[path]);
 const row=routes.find(r=>r.sourceId===selected);
 function update(patch:Partial<Route>){setRoutes(old=>old.map(r=>r.sourceId===selected?{...r,...patch}:r));setNotice('');}
 async function save(){if(!config)return;setBusy(true);setError('');setNotice('');try{await request(path,'POST',(v):v is object=>!!v&&typeof v==='object',{revision:config.revision,routes});const next=await request(path,'GET',valid);setConfig(next);setRoutes(next.routes);setNotice('配置已保存；旧副本已暂停读取，请执行同步。');onSaved();}catch{setError('保存未完成。配置可能已被他人更新，或人员、空间资格已变化，请重新打开此页核对。');}finally{setBusy(false);}}
 return <details className="routing"><summary>按来源配置目标空间与读取人员</summary><p>保存的是完整同步清单：未列入的来源停止同步；知识沿其来源进入同一空间。读取人员还必须同时拥有源数据和目标空间权限。这里不提供源库凭据或任意查询。</p>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {config&&<><p>{config.revision===0?'尚未启用显式清单，仍使用原目标空间。':'当前使用显式清单。'} 已列入 {routes.length} 项。</p>
 <fieldset disabled={busy}><label>来源 <select aria-label="路由来源" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择来源</option>{config.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{routes.filter(r=>!config.sources.some(s=>s.id===r.sourceId)).map(r=><option key={r.sourceId} value={r.sourceId}>来源已撤下</option>)}</select></label>
 {selected&&!row&&<button onClick={()=>setRoutes(old=>[...old,{sourceId:selected,workspaceId:'',readers:[]}])}>列入同步清单</button>}
 {row&&<><label>目标空间 <select aria-label="来源目标空间" value={row.workspaceId} onChange={e=>update({workspaceId:e.target.value})}><option value="">请选择空间</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
 <fieldset><legend>允许读取的人员（可留空，表示无人可读）</legend>{config.members.map(m=><label className="route-person" key={m.id}><input type="checkbox" checked={row.readers.includes(m.id)} onChange={e=>update({readers:e.target.checked?[...row.readers,m.id]:row.readers.filter(id=>id!==m.id)})}/>{m.name}</label>)}</fieldset>
 <button onClick={()=>setRoutes(old=>old.filter(r=>r.sourceId!==selected))}>从同步清单移除</button></>}
 <button disabled={routes.some(r=>!r.workspaceId)} onClick={()=>void save()}>保存完整同步清单</button></fieldset></>}
 </details>;
}
