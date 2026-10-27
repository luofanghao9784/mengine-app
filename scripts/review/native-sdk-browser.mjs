import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const dir='.local/native-sdk-browser',f=JSON.parse(await readFile(dir+'/ready.json','utf8'));
const url='http://127.0.0.1:5217',base=`/api/v1/tenants/${f.tenant}/native-conversations`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5217','--strictPort'],{env:{...process.env,DREAMCORE_DEV_API_URL:`http://127.0.0.1:${f.port}`},stdio:['ignore','pipe','pipe']});
await new Promise((r,j)=>{server.stdout.on('data',b=>{if(b.toString().includes('Local:'))r();});server.on('exit',c=>j(Error('Vite exited '+c)));});
let browser,page;const passed=[];
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(40000);
 const csrf=await context.request.get(url+'/api/v1/auth/csrf').then(r=>r.json());
 const login=await context.request.post(url+'/api/v1/auth/login',{headers:{[csrf.headerName]:csrf.token},data:{username:'sdkbrowser',password:'Synthetic-browser-12345'}});expect(login.ok()).toBeTruthy();
 await page.goto(url+`/workspace/#tenant=${f.tenant}&view=conversations&native=new`);
 await page.locator('.native-section select').first().selectOption(f.space);
 await page.getByRole('button',{name:'开始',exact:true}).click();
 await expect(page.locator('.native-chat')).toBeVisible();expect(context.pages().length).toBe(1);console.log('step',passed.length);passed.push('create-no-official-window');
 let id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('native');
 const send=async text=>{const count=await page.locator('.conversation-user').count();const input=page.getByRole('textbox',{name:'工作要求',exact:true});await input.fill(text);const receipt=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST',{timeout:75000});await page.getByRole('button',{name:'发送',exact:true}).click();const response=await receipt;expect(response.status(),await response.text()).toBe(200);await expect(input).toHaveValue('');await expect(page.locator('.conversation-user')).toHaveCount(count+1,{timeout:15000});await expect(page.locator('.conversation-user').last()).toContainText(text,{timeout:15000});};
 const idle=async()=>{await expect(page.locator('.native-turn').last().locator('.native-now')).toHaveCount(0,{timeout:60000});await expect(page.getByRole('button',{name:'发送',exact:true})).toBeVisible({timeout:15000});};
 await send('BROWSER_HELLO');await expect(page.locator('.native-chat')).toContainText('browser-completed',{timeout:60000});await idle();console.log('step',passed.length);passed.push('real-sdk-reply');
 for(const choice of ['允许','拒绝']){await send('BROWSER_APPROVAL '+choice);await page.getByRole('button',{name:choice,exact:true}).click();await expect(page.locator('.native-chat')).toContainText(choice==='允许'?'已允许':'已拒绝');await idle();console.log('step',passed.length);passed.push('approval-'+choice);}
 await send('BROWSER_QUESTION');await page.getByRole('button',{name:'Yes',exact:true}).click();await page.getByRole('button',{name:'提交回答',exact:true}).click();await idle();console.log('step',passed.length);passed.push('question-answer');
 await send('BROWSER_QUESTION SKIP');await page.getByRole('button',{name:'跳过',exact:true}).click();await idle();console.log('step',passed.length);passed.push('question-skip');
 await send('BROWSER_QUESTION TIMEOUT');await expect(page.getByText('等待已超时，AI 先按自己的判断继续了；现在回答仍会送达，AI 会据此调整。')).toBeVisible();await page.getByRole('button',{name:'Yes',exact:true}).click();await page.getByRole('button',{name:'提交回答',exact:true}).click();await idle();console.log('step',passed.length);passed.push('question-late');
 for(const choice of ['Proceed','退回修改']){await send('BROWSER_PLAN '+choice);if(choice==='退回修改')await page.getByRole('textbox',{name:'需要调整的地方'}).fill('Adjust the synthetic plan');await page.getByRole('button',{name:choice,exact:true}).click();await idle();console.log('step',passed.length);passed.push('plan-'+choice);}
 for(const mode of ['button','escape']){await send('BROWSER_QUESTION STOP');await page.getByRole('button',{name:'跳过',exact:true}).waitFor();if(mode==='button')await page.getByRole('button',{name:'停止本轮',exact:true}).click();else{await page.getByRole('textbox',{name:'工作要求',exact:true}).focus();await page.keyboard.press('Escape');await expect(page.locator('.native-chat')).toBeVisible();}await idle();console.log('step',passed.length);passed.push('stop-'+mode);}
 await send('BROWSER_RATING');await idle();await page.getByRole('button',{name:'有用',exact:true}).click();await expect(page.getByRole('button',{name:'有用',exact:true})).toHaveAttribute('aria-pressed','true');await page.reload();await expect(page.getByRole('button',{name:'有用',exact:true})).toHaveAttribute('aria-pressed','true');console.log('step',passed.length);passed.push('rating-refresh');
 const before=await page.locator('.conversation-user').count();await context.setOffline(true);await page.waitForTimeout(1000);await context.setOffline(false);await page.waitForTimeout(6000);expect(await page.locator('.conversation-user').count()).toBe(before);console.log('step',passed.length);passed.push('offline-reconnect-no-duplicate');
 // Real file picker; only the platform API determines which versions can be read.
 await page.getByRole('button',{name:'添加资料',exact:true}).click();
 await expect(page.getByRole('button',{name:'从电脑上传',exact:true})).toBeDisabled();
 await expect(page.locator('.native-picker')).toContainText('上传');
 await page.getByRole('textbox',{name:'搜索资料',exact:true}).fill('browser-source-');
 for(let i=1;i<=2;i++)await page.getByRole('checkbox',{name:new RegExp('browser-source-'+i+'\\.txt')}).check();
 await page.getByRole('combobox',{name:'browser-source-1.txt 的版本',exact:true}).selectOption(f.refs[0].versionId);
 await page.screenshot({path:dir+'/picker-old-version.png',fullPage:true});
 await page.getByRole('button',{name:'添加 2 份',exact:true}).click();
 await send('BROWSER_READ');await idle();await expect(page.locator('.native-chat')).toContainText('BROWSER_EVIDENCE_1');await expect(page.locator('.native-chat')).toContainText('BROWSER_EVIDENCE_2');await expect(page.locator('.native-chat')).not.toContainText('NEW_VERSION_MUST_NOT_BE_READ');console.log('step',passed.length);passed.push('cross-space-two-materials-old-version-read');
 await send('BROWSER_CHILD');await page.getByRole('tab',{name:'进展',exact:true}).click();
 await expect(page.locator('.native-work')).toContainText('正在',{timeout:15000});await page.screenshot({path:dir+'/child-running.png',fullPage:true});
 await expect(page.locator('.native-work .native-row-state.is-done')).toContainText('完成',{timeout:45000});
 await page.locator('.native-row-expandable summary').last().click();await expect(page.locator('.native-subtask')).toContainText('CHILD_ONLY_OUTPUT');await expect(page.locator('.native-subtask')).toContainText('已做 1 步');await page.screenshot({path:dir+'/child-finished.png',fullPage:true});
 await idle();await expect(page.locator('.native-chat')).toContainText('ROOT_CHILD_COMPLETED');expect((await page.locator('.conversation-reply').allTextContents()).join('\n')).not.toContain('CHILD_ONLY_OUTPUT');
 const childHistory=await page.evaluate(async({base,id})=>fetch(`${base}/${id}/history?limit=500`).then(r=>r.json()),{base,id});const started=childHistory.items.find(e=>e.type==='subagent.started');expect(started.data.parentSessionId).toBe(id);expect(childHistory.items.some(e=>e.sessionId===started.data.childSessionId&&e.type==='assistant/message')).toBeTruthy();expect(childHistory.items.some(e=>e.type==='subagent.finished'&&e.data.childSessionId===started.data.childSessionId&&e.data.status==='ok')).toBeTruthy();await writeFile(dir+'/subtask-events.json',JSON.stringify(childHistory.items.filter(e=>e.type.startsWith('subagent')||e.sessionId===started.data.childSessionId),null,2));
 console.log('step',passed.length);passed.push('real-child-progress-output-root-isolation');

 const denied=await page.evaluate(async({base,id,ref})=>{const c=await fetch('/api/v1/auth/csrf').then(r=>r.json());return (await fetch(`${base}/${id}/messages`,{method:'POST',headers:{'content-type':'application/json',[c.headerName]:c.token},body:JSON.stringify({requestId:crypto.randomUUID(),text:'BROWSER_READ',materials:[ref]})})).status;},{base,id,ref:f.forbidden});expect([403,404]).toContain(denied);console.log('step',passed.length);passed.push('forbidden-material-rejected');
 await send('BROWSER_SAVE');await idle();await page.getByRole('tab',{name:'成果',exact:true}).click();await page.getByRole('button',{name:'刷新私人成果'}).click();await page.getByRole('link',{name:'browser-result.txt',exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'browser-result.txt',exact:true}).click();await(await download).saveAs(dir+'/browser-result.txt');expect(await readFile(dir+'/browser-result.txt','utf8')).toBe('Synthetic browser artifact');console.log('step',passed.length);passed.push('artifact-download');
 await page.getByRole('button',{name:'发布',exact:true}).click();await page.locator('.native-publish select').selectOption(f.space);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.locator('.native-publish')).toContainText('已发布到');console.log('step',passed.length);passed.push('publish');
 await expect(page.locator('.native-results')).toContainText('本次费用');console.log('step',passed.length);passed.push('budget-display');
 await page.getByRole('button',{name:'停止会话',exact:true}).click();await page.getByRole('button',{name:'恢复会话',exact:true}).click();await page.waitForTimeout(2500);await send('BROWSER_RESUME');await idle();console.log('step',passed.length);passed.push('resume');
 await page.screenshot({path:dir+'/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('.native-chat').waitFor();await expect(page.locator('.conversation-user').last()).toContainText('BROWSER_RESUME',{timeout:15000});await send('BROWSER_MOBILE');await idle();await page.screenshot({path:dir+'/mobile.png',fullPage:true});console.log('step',passed.length);passed.push('mobile-send');
 console.log(JSON.stringify({passed}));await writeFile(dir+'/result.json',JSON.stringify({passed},null,2));
}catch(error){await page?.screenshot({path:dir+'/failure.png',fullPage:true});await writeFile(dir+'/failure.txt',String(error)+'\n'+await page?.locator('body').innerText()+'\nPassed: '+passed.join(','));throw error;}
finally{await browser?.close();server.kill('SIGTERM');}
