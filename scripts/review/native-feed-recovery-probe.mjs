import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {writeFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
// Run from repository root. Synthetic HTTP only; never connects to an application backend.
await mkdir('.local/native-review-20261027', {recursive:true});
await writeFile('.local/native-review-20261027/index.html', '<div id="root"></div><script type="module" src="/.local/native-review-20261027/probe.tsx"></script>');
await writeFile('.local/native-review-20261027/probe.tsx', "import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {useNativeFeed} from '../../src/native-conversation/chat/useNativeFeed';\nfunction Probe(){const feed=useNativeFeed('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',{enabled:true,active:true});return <><p>{feed?.notice || 'connected'}</p><button onClick={()=>feed?.actions.send?.('synthetic retry probe').catch(()=>{})}>Send</button></>}\ncreateRoot(document.getElementById('root')!).render(<Probe/>);\n");
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5199','--strictPort'],{stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.on('data', b=>{if(b.toString().includes('Local:'))resolve();});server.on('error',reject);server.on('exit',code=>reject(Error('Vite exited: '+code)));});
let browser;
try {
browser=await chromium.launch({headless:true});
const page=await browser.newPage();
let history=0,streams=0,offline=true; const ids=[];
await page.route('**/api/**',async r=>{
 const url=r.request().url();
 if(url.includes('/history')){history++;return offline?r.abort('failed'):r.fulfill({json:{items:[],hasMore:false}});}
 if(url.includes('/events')){streams++;return r.fulfill({contentType:'text/event-stream',body:': keepalive\n\n'});}
 if(url.endsWith('/csrf'))return r.fulfill({json:{token:'synthetic',headerName:'X-CSRF-TOKEN'}});
 if(url.endsWith('/messages')){ids.push(r.request().postDataJSON().requestId);return r.abort('failed');}
 return r.fulfill({json:[]});
});
await page.goto('http://127.0.0.1:5199/.local/native-review-20261027/index.html');
await page.getByText('会话记录读取失败',{exact:false}).waitFor();
offline=false;
await page.evaluate(()=>window.dispatchEvent(new Event('online')));
await page.waitForTimeout(6500);
const historyRecovery={historyRequests:history,sseConnections:streams,notice:await page.locator('p').innerText()};
await page.screenshot({path:'.local/native-review-20261027/history-recovery.png'});
await page.getByRole('button',{name:'Send'}).click();await page.waitForTimeout(150);
await page.getByRole('button',{name:'Send'}).click();await page.waitForTimeout(150);
await page.reload();await page.getByRole('button',{name:'Send'}).click();await page.waitForTimeout(150);
const result={historyRecovery,requestIds:ids,sameMountRetains:ids[0]===ids[1],refreshRetains:ids[1]===ids[2],scope:'Real React hook in Chromium, intercepted synthetic API; no SDK execution'};
console.log(JSON.stringify(result,null,2));
await writeFile('.local/native-review-20261027/result.json',JSON.stringify(result,null,2));
assert.equal(result.refreshRetains,true);
assert.equal(result.sameMountRetains,true);
assert.ok(historyRecovery.historyRequests > 1);
assert.ok(historyRecovery.sseConnections > 0);
assert.equal(historyRecovery.notice,'connected');
} finally {
 await browser?.close();
 server.kill('SIGTERM');
}

