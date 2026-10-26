import { createRoot } from 'react-dom/client';
import { GovernanceProgress } from './GovernanceProgress';
// Narrow deployment entry; the normal SceneShell includes the same component on its next build.
let host:HTMLElement|null=null;let unmount:(()=>void)|undefined;
function mount(){const home=document.querySelector<HTMLElement>('section.cards.home');if(host&&!host.isConnected){unmount?.();host=null;unmount=undefined;}if(!home||home.querySelector('[aria-label="首期治理真实进度"]')||host)return;host=document.createElement('div');host.style.cssText='grid-column:1/-1;display:contents';home.prepend(host);const root=createRoot(host);unmount=()=>root.unmount();root.render(<GovernanceProgress/>);}
new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});mount();
