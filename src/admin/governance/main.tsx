import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createIdentityClient,createIdentityRequest} from '../../identity/client';
import './style.css';
import {Metrics} from './metrics';
const request=createIdentityRequest(fetch,240000);
const object=<T,>(v:unknown):v is T=>v!==null&&typeof v==='object';
type Field={name:string;label?:string;meaning?:string;unit?:string;rules?:string;evidence?:string};
type Asset={source_id:string;kind:string;revision:string;updated_at:string;metadata:{title?:string;version?:number;dictionaryRevision?:number;dictionaryFingerprint?:string;dictionaryStatus?:string;tags?:string[];dictionary?:{tableMeaning?:string;usageRules?:string;fields?:Field[];relations?:{id?:string;name?:string;targetId?:string;evidence?:string;keys?:{local:string;foreign:string}[]}[];templates?:{id?:string;name?:string;question?:string;operation?:string;field?:string}[]};governance?:{sourceVersion?:number;policyVersion?:number;classification?:number;audience?:string;policyDigest?:string}}};
type State={tenantId:string;governance:{source_revision:string;policy_current:boolean;last_synced_at:string;governance_valid_until:string;collection_state?:string};assets:Asset[];runs:{id:string;operation:string;state:string;finished_at?:string;created_at:string}[]};
const names:Record<string,string>={SUCCEEDED:'已完成',RUNNING:'处理中',QUEUED:'等待处理',FAILED:'处理失败',INTERRUPTED:'处理已中断',SYNC_INPUTS:'同步治理成果','/scene-knowledge/sync':'整理知识',generated:'已生成',changed:'来源已变化',unconfirmed:'尚未生成',legacy:'历史口径',organization:'企业范围',department:'部门范围',private:'指定人员范围'};
const label=(value:string|undefined)=>value?names[value]??'其他处理状态':'尚无记录';
const time=(s?:string)=>s?new Date(s).toLocaleString('zh-CN'):'尚未同步';
const evidence=(s?:string)=>!s||s==='UNKNOWN'?'尚缺字段依据':s.includes('DEPLOYMENT_INFERRED')?'依据现有结构推断，尚待业务事实核实':s;
function App(){
 const platform=new URLSearchParams(location.search).get('surface')==='platform';
 const [tenants,setTenants]=useState<{id:string;name:string}[]>([]),[tenant,setTenant]=useState(''),[state,setState]=useState<State|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[filter,setFilter]=useState(''),[busy,setBusy]=useState(false);
 const prefix=platform?'/api/platform-admin/v1':'/api/tenant-admin/v1';
 useEffect(()=>{let active=true;(async()=>{
  const list=platform?(await request<{tenant_id:string;name:string}[]>('/api/platform-admin/v1/scene-enterprises','GET',object)).map(t=>({id:t.tenant_id,name:t.name})):(await createIdentityClient().me()).memberships.filter(m=>m.role==='TENANT_ADMIN').map(m=>({id:m.tenantId,name:m.tenantName}));
  if(active){setTenants(list);const desired=new URLSearchParams(location.search).get('tenant');setTenant(list.find(t=>t.id===desired)?.id??list[0]?.id??'');}
 })().catch(()=>active&&setError('无法读取企业列表，请先登录对应管理端。'));return()=>{active=false};},[platform]);
 useEffect(()=>{setState(null);setSelected('');setError('');if(!tenant)return;let active=true;const abort=new AbortController();const refresh=()=>request<State>(`${prefix}/tenants/${tenant}/scene/status`,'GET',object,undefined,abort.signal).then(s=>{if(active){setState(s);setError('');}}).catch(()=>active&&setError('治理同步状态暂不可用，请确认企业已接入且您有管理权限。'));void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;abort.abort();clearInterval(timer)};},[tenant,prefix]);
 async function sync(){if(!tenant)return;setBusy(true);setError('');try{setState(await request<State>(`${prefix}/tenants/${tenant}/scene/synchronize`,'POST',object,{}));}catch{setError('本次同步未完成，系统将自动重试。过期的权限副本不会继续用于分析。');}finally{setBusy(false);}}
 const assets=state?.assets.filter(a=>(a.metadata.title??a.source_id).toLowerCase().includes(filter.toLowerCase()))??[];
 const chosen=assets.find(a=>a.source_id===selected)??assets[0];const m=chosen?.metadata;
 return <main><header><div><p className="eyebrow">梦擎工作空间 · {platform?'总台':'企业管理端'}</p><h1>治理成果同步</h1></div><a href={platform?'/platform-admin/#admin=engine':'/tenant-admin/'}>返回管理端</a></header>
 <p>在两端查看同一份治理成果：数据口径、字段依据、关联、指标模板与权限版本。</p>
 <div className="toolbar"><select aria-label="企业" value={tenant} disabled={busy} onChange={e=>setTenant(e.target.value)}>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><button onClick={()=>void sync()} disabled={!tenant||busy}>{busy?'同步中…':'立即同步治理成果'}</button></div>
 {error&&<p role="alert">{error}</p>}
 {state&&<><section className="summary"><div><small>权限同步</small><strong>{state.governance.policy_current?'当前有效':'已过期或尚未完成'}</strong></div><div><small>最近完成</small><strong>{time(state.governance.last_synced_at)}</strong></div><div><small>数据快照采集</small><strong>{label(state.governance.collection_state)}</strong></div><div><small>治理资产</small><strong>{state.assets.length} 项</strong></div></section>
 <p className="notice">治理元信息通常每分钟同步；快照采集完成后数据才能用于分析。权限超过五分钟未成功核对时，暂停使用同步副本。通过管理端修改来源权限会先暂停副本，再同步新权限。同步不会扩大原有空间授权。</p>
 <div className="layout"><aside><input aria-label="搜索资产" placeholder="搜索治理资产" value={filter} onChange={e=>setFilter(e.target.value)}/>{assets.map(a=><button className={a===chosen?'selected':''} key={a.kind+a.source_id} onClick={()=>setSelected(a.source_id)}>{a.metadata.title??'未命名资产'}<small>来源 v{a.metadata.version??a.metadata.governance?.sourceVersion??'—'} · 权限 v{a.metadata.governance?.policyVersion??'—'}</small></button>)}</aside><article>{m?<>
 <h2>{m.title}</h2><p>{m.tags?.join(' · ')}</p><div className="versions"><span>源数据 v{m.version??m.governance?.sourceVersion??'—'}</span><span>口径 v{m.dictionaryRevision??'—'} · {label(m.dictionaryStatus)}</span><span>权限 v{m.governance?.policyVersion??'—'}</span></div>
 <h3>业务口径</h3><p>{m.dictionary?.tableMeaning??'该资产没有表级口径。'}</p><p>{m.dictionary?.usageRules}</p>
 <h3>来源权限</h3><p>{label(m.governance?.audience)} · {['公开','企业内部','机密','严格受限'][m.governance?.classification??3]}。实际读取还需满足目标空间权限；关联统计按全部来源权限的交集执行。</p>
 <h3>字段与依据</h3>{m.dictionary?.fields?.map(f=><details key={f.name}><summary>{f.label??f.name}{f.unit?`（${f.unit}）`:''}</summary><p>{f.meaning}</p><p>{f.rules}</p><p className="notice">{evidence(f.evidence)}</p></details>)}
 <h3>数据关联 · {m.dictionary?.relations?.length??0}</h3>{m.dictionary?.relations?.map((r,i)=><p key={r.id??i}>{r.name??'关联来源'}：{r.evidence??'关联定义已随口径同步。'}</p>)}
 <h3>指标模板 · {m.dictionary?.templates?.length??0}</h3><p>保留来源定义和版本，不因同步而升级为已核实业务指标。</p>{m.dictionary?.templates?.map((t,i)=><p key={t.id??i}>{t.name??'指标模板'}：{t.question??'按来源治理口径计算'}</p>)}
 <details><summary>同步版本</summary><p>平台接收时间：{time(chosen?.updated_at)}</p><p>源口径指纹：{m.dictionaryFingerprint??'未提供'}</p><p>源权限指纹：{m.governance?.policyDigest??'未提供'}</p><p>平台治理版本：{chosen?.revision}</p></details>
 </>:<p>暂无同步资产。</p>}</article></div><Metrics key={tenant+prefix} tenant={tenant} prefix={prefix} assets={state.assets} platform={platform}/><details><summary>最近处理记录</summary>{state.runs.map(r=><p key={r.id}>{time(r.finished_at??r.created_at)} · {label(r.operation)} · {label(r.state)}</p>)}</details></>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
