import { fieldLabel, recordLabel } from '../display-labels';
import {useEffect,useState} from 'react';
import {createIdentityRequest} from '../../identity/client';
const request=createIdentityRequest(fetch,30000);
type Catalog={stores:{id:string;name:string}[]};
type Result={receiptId:string;result:{amounts:Record<string,{cents:string;included:number;outside:number;unknown:number}>;issues:{table:string;id:string;category:string;reason:string}[]}};
const object=<T,>(v:unknown):v is T=>!!v&&typeof v==='object';
export function Reconciliation({tenant}:{tenant:string}){
 const [stores,setStores]=useState<Catalog['stores']>([]),[store,setStore]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const url=`/api/v1/tenants/${tenant}/onboarding-reconciliation`;
 useEffect(()=>{let live=true;setStores([]);setStore('');setResult(null);request(url,'GET',object<Catalog>).then(d=>{if(live)setStores(d.stores)}).catch(()=>{});return()=>{live=false}},[url]);
 if(!stores.length)return null;
 async function run(){setBusy(true);setResult(null);setError('');try{setResult(await request(url,'POST',object<Result>,{storeId:store,dateFrom:from,dateTo:to}))}catch{setError('核查未完成：请检查来源权限、快照或背景版本，以及日期范围。旧结果已清除。')}finally{setBusy(false)}}
 return <details><summary>首批三表金额与关联核查</summary><p>固定快照，按上海时区自然日统计。财务已核对是业务确认的子集，不相加；未知金额不补零，不计算净收入和利润。结果只代表执行时权限及版本。</p>
 <label>门店<select aria-label="门店" disabled={busy} value={store} onChange={e=>{setStore(e.target.value);setResult(null)}}><option value="">请选择</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>开始日期<input disabled={busy} type="date" value={from} onChange={e=>{setFrom(e.target.value);setResult(null)}}/></label><label>结束日期<input disabled={busy} type="date" value={to} onChange={e=>{setTo(e.target.value);setResult(null)}}/></label>
 <button disabled={busy||!store||!from||!to||from>to} onClick={()=>void run()}>{busy?'核查中…':'运行核查'}</button>{error&&<p role="alert">{error}</p>}
 {result&&<><p>金额保留源单位“分”；有未知项时仅为已知部分合计。核查回执已保存。</p><table><thead><tr><th>口径</th><th>已知金额（分）</th><th>纳入记录</th><th>期间外</th><th>金额或日期未知</th></tr></thead><tbody>{Object.entries(result.result.amounts).map(([key,a])=><tr key={key}><td>{recordLabel(key)}</td><td>{a.cents}</td><td>{a.included}</td><td>{a.outside}</td><td>{a.unknown}</td></tr>)}</tbody></table><p>跨表及流程核查（全快照，非仅所选期间）：{result.result.issues.length}项</p><ul>{result.result.issues.map((i,n)=><li key={n}>{i.category==='WORK_QUEUE'?'流程待办':i.category==='EXPLAINED_HISTORY'?'可解释历史':'待补证'} · {fieldLabel(i.table)} · {recordLabel(i.reason)}</li>)}</ul></>}
 </details>
}
