import { useEffect, useState } from 'react';
import { createIdentityClient, createIdentityRequest } from '../identity/client';
import type { Membership, Workspace } from '../../contracts/public-api/identity';
import './native-conversation.css';
type Session = { id: string; workspaceId: string; state: string; legacyConversationId: string | null };
type Artifact = { id: string; filename: string; bytes: number; sha256: string };
type Old = { id: string; title: string; workspaceId: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const session = (v: unknown): v is Session => object(v) && typeof v.id === 'string' && typeof v.workspaceId === 'string' && ['ACTIVE','STOPPED'].includes(String(v.state));
const sessions = (v: unknown): v is Session[] => Array.isArray(v) && v.every(session);
const artifacts = (v: unknown): v is Artifact[] => Array.isArray(v) && v.every(x => object(x) && typeof x.id === 'string' && typeof x.filename === 'string' && typeof x.bytes === 'number' && typeof x.sha256 === 'string');
const request = createIdentityRequest(); const identity = createIdentityClient();
export function NativeConversations() {
 const [members,setMembers]=useState<Membership[]>([]),[tenant,setTenant]=useState(''),[spaces,setSpaces]=useState<Workspace[]>([]),[space,setSpace]=useState('');
 const [list,setList]=useState<Session[]>([]),[old,setOld]=useState<Old[]>([]),[legacy,setLegacy]=useState(''),[selected,setSelected]=useState<Session|null>(null),[files,setFiles]=useState<Artifact[]>([]);
 const [destination,setDestination]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const base=`/api/v1/tenants/${tenant}/native-conversations`;
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作未完成');}finally{setBusy(false);}};
 useEffect(()=>{let active=true;identity.me().then(me=>{if(active){setMembers(me.memberships);setTenant(me.memberships[0]?.tenantId??'');}}).catch(()=>setNotice('请先返回工作空间登录，再打开此入口。'));return()=>{active=false;};},[]);
 useEffect(()=>{setSpaces([]);setSpace('');setSelected(null);setFiles([]);if(!tenant)return;const c=new AbortController();identity.context(tenant,c.signal).then(x=>{setSpaces(x.workspaces);setSpace(x.workspaces[0]?.id??'');}).catch(()=>{});return()=>c.abort();},[tenant]);
 useEffect(()=>{setList([]);setOld([]);setLegacy('');setSelected(null);setFiles([]);if(!tenant||!space)return;const c=new AbortController();request(`${base}?workspaceId=${space}`,'GET',sessions,undefined,c.signal).then(setList).catch(()=>{});request(`/api/v1/tenants/${tenant}/conversations?limit=50`,'GET',(v):v is {items:Old[]}=>object(v)&&Array.isArray(v.items),undefined,c.signal).then(x=>setOld(x.items.filter(c=>c.workspaceId===space))).catch(()=>{});return()=>c.abort();},[tenant,space,base]);
 const choose=async(s:Session)=>{setSelected(s);setFiles(await request(`${base}/${s.id}/artifacts`,'GET',artifacts));};
 const launch=async(s:Session)=>{
  const grant=await request(`${base}/${s.id}/grant`,'POST',(v):v is {token:string;launchUrl:string}=>object(v)&&typeof v.token==='string'&&typeof v.launchUrl==='string');
  const url=new URL(grant.launchUrl);if(!['http:','https:'].includes(url.protocol))throw Error('运行入口配置无效');
  const form=document.createElement('form');form.method='POST';form.action=url.href;form.target='_blank';
  for(const [name,value] of Object.entries({id:s.id,token:grant.token})){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();form.remove();
  setNotice('已打开官方会话窗口。执行不依赖此管理页面保持连接。');
 };
 return <main className="native-conversations"><header><a href="/">返回工作空间</a><h1>企业原生会话</h1><p>官方 DH 会话在独立窗口运行；资料沿用企业权限，成果先保存在私人会话中。</p></header>
 <div role="status">{notice}</div><fieldset disabled={busy}><legend>工作范围</legend>
 <label>企业<select value={tenant} onChange={e=>setTenant(e.target.value)}>{members.map(x=><option key={x.tenantId} value={x.tenantId}>{x.tenantName}</option>)}</select></label>
 <label>空间<select value={space} onChange={e=>setSpace(e.target.value)}>{spaces.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 <label>接续旧会话<select value={legacy} onChange={e=>setLegacy(e.target.value)}><option value="">新会话</option>{old.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
 <p>旧会话原样保留。接续最多带入最近 50 条已结束且当前可读的历史，不恢复旧工具或外部进程。</p>
 <button disabled={!space} onClick={()=>act(async()=>{const s=await request(base,'POST',session,{requestId:crypto.randomUUID(),workspaceId:space,legacyConversationId:legacy||null});setList(x=>[s,...x]);await choose(s);await launch(s);})}>创建并打开</button></fieldset>
 <section><h2>我的原生会话</h2>{list.map((s,i)=><div className="native-session" key={s.id}><button disabled={busy} onClick={()=>act(()=>choose(s))}>{s.legacyConversationId?'历史接续':'新会话'} {i+1}</button><span>{s.state==='ACTIVE'?'可打开':'已停止'}</span><button disabled={busy||s.state!=='ACTIVE'} onClick={()=>act(()=>launch(s))}>打开官方会话</button><button disabled={busy||s.state!=='ACTIVE'} onClick={()=>act(async()=>{const stopped=await request(`${base}/${s.id}/stop`,'POST',session);setList(x=>x.map(a=>a.id===s.id?stopped:a));setNotice('已撤销执行授权，运行容器将在权限检查时停止。');})}>停止</button>{s.state==='STOPPED'&&<button disabled={busy} onClick={()=>act(async()=>{const active=await request(`${base}/${s.id}/resume`,'POST',session);setList(x=>x.map(a=>a.id===s.id?active:a));await launch(active);})}>继续原会话</button>}</div>)}</section>
 {selected&&<section><h2>私人成果</h2><button disabled={busy} onClick={()=>act(()=>choose(selected))}>刷新成果</button><p>只有保存成功并获得平台回执的文件会出现在这里。</p><label>发布到<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">选择共享空间</option>{spaces.filter(x=>x.kind==='SHARED').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我已核对成果内容和共享范围</label>{files.map(f=><div className="native-session" key={f.id}><a href={`${base}/${selected.id}/artifacts/${f.id}`}>{f.filename}</a><span>{f.bytes} 字节</span><button disabled={busy||!destination||!ack} onClick={()=>act(async()=>{const receipt=await request(`${base}/${selected.id}/publish`,'POST',(v):v is {materialId:string}=>object(v)&&typeof v.materialId==='string',{requestId:crypto.randomUUID(),artifactId:f.id,workspaceId:destination,acknowledged:ack});setNotice(`发布成功，资料回执：${receipt.materialId}`);setAck(false);})}>发布到共享空间</button></div>)}</section>}
 </main>;
}
