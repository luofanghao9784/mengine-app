import {useEffect,useState} from 'react';
import {createIdentityRequest} from '../../identity/client';
const request=createIdentityRequest(fetch,240000);
type Config={revision:number;workspaces:string[];choices:{id:string;name:string}[]};
const valid=(v:unknown):v is Config=>!!v&&typeof v==='object'&&Array.isArray((v as Config).workspaces)&&Array.isArray((v as Config).choices);
export function Publication({tenant,onSaved}:{tenant:string;onSaved:()=>void}){
 const [config,setConfig]=useState<Config|null>(null),[selected,setSelected]=useState<string[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const path=`/api/tenant-admin/v1/tenants/${tenant}/scene/publication`;
 useEffect(()=>{const c=new AbortController();void request<Config>(path,'GET',valid,undefined,c.signal).then(v=>{if(!c.signal.aborted){setConfig(v);setSelected(v.workspaces);}}).catch(()=>{if(!c.signal.aborted)setMessage('无法加载同步发布权限');});return()=>c.abort();},[path]);
 async function save(){if(!config)return;setBusy(true);try{const v=await request<Config>(path,'POST',valid,{revision:config.revision,workspaces:selected});setConfig(v);setSelected(v.workspaces);setMessage('发布范围已保存，请重新同步；日常资料权限未改变。');onSaved();}catch{setMessage('保存失败，请重新加载并核对权限或配置版本。');}finally{setBusy(false);}}
 return <details className="routing"><summary>同步发布权限（独立于资料维护）</summary><p>仅允许当前绑定的同步身份向所选空间发布已配置来源。不会授予手工上传、编辑、删除、阅读或成员授权权限。撤回后相关同步停止，旧副本暂停读取；需要更新来源清单后重新同步。</p>{message&&<p role="status">{message}</p>}{config&&<fieldset disabled={busy}>{config.revision===0&&<p>尚未启用独立范围；保存后以本清单为准。</p>}{config.choices.map(w=><label key={w.id} className="route-person"><input type="checkbox" checked={selected.includes(w.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,w.id]:v.filter(id=>id!==w.id))}/>{w.name}</label>)}<button onClick={()=>void save()}>保存同步发布权限</button></fieldset>}</details>;
}
