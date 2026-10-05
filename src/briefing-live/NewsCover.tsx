import { useState } from 'react';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import './news-cover.css';
export function NewsCover({cover,compact=false}:{cover?:BriefingDocument['cover'];compact?:boolean}) {
 const [failed,setFailed]=useState(false);
 if(failed)cover=null;
 return <figure className={'news-cover'+(compact?' is-compact':'')}>
  <img src={cover?.dataUrl || '/news-cover.svg'} alt={cover?'资讯原文配图':'资讯主题插画'} loading="lazy" decoding="async" onError={()=>setFailed(true)} />
  {!compact&&cover&&<figcaption>图片来自<a href={cover.sourceUrl} target="_blank" rel="noopener noreferrer">{cover.sourceTitle||'资讯原文'}</a></figcaption>}
  {!compact&&!cover&&<figcaption>主题插画 · 非新闻现场图片</figcaption>}
 </figure>;
}
