import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { SessionProvider } from '../../../src/identity/session';
import { IdentityError } from '../../../src/identity/client';
import { useInfiniteBriefing } from '../../../src/briefing-live/useInfiniteBriefing';
function Fixture() {
 const [query,setQuery]=useState('first');
 const feed=useInfiniteBriefing<{items:string[];hasMore:boolean}>(async (_offset,_previous,signal)=>{
  const r=await fetch('/api/fixture-feed?q='+query,{signal});
  if(!r.ok)throw new IdentityError('CAPABILITY_REQUIRED',r.status);
  return r.json();
 },[query],item=>item,true);
 return <><button onClick={()=>setQuery('next')}>切换</button><button onClick={()=>setQuery('denied')}>撤权</button><div aria-busy={feed.loading}>{feed.error?'无权限':feed.value?.items.map(item=><article key={item}>{item}</article>)}</div></>;
}
createRoot(document.getElementById('root')!).render(<SessionProvider><Fixture/></SessionProvider>);
