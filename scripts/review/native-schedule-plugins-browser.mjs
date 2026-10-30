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
 await send('BROWSER_CAPABILITIES');await idle();await expect(page.locator('.conversation-reply').last()).toContainText('enterprise_read');
 await page.getByRole('tab',{name:'定时',exact:true}).click();await page.locator('.native-schedules').getByRole('button',{name:'新建',exact:true}).click();
 await page.getByLabel('名称',{exact:true}).fill('AT_REAL_UI');await page.getByLabel('每次要 AI 做什么',{exact:true}).fill('BROWSER_HELLO');await page.locator('.native-schedule-form select').selectOption('once');
 const due=new Date(Math.ceil((Date.now()+20000)/60000)*60000);const pad=n=>String(n).padStart(2,'0');
 await page.getByLabel('日期',{exact:true}).fill(`${due.getFullYear()}-${pad(due.getMonth()+1)}-${pad(due.getDate())}`);await page.getByLabel(/^时间（/).fill(`${pad(due.getHours())}:${pad(due.getMinutes())}`);
 await page.getByRole('button',{name:'创建',exact:true}).click();await expect(page.locator('.native-schedule')).toContainText('AT_REAL_UI');
 await page.screenshot({path:dir+'/schedule-created.png',fullPage:true});console.log('created at schedule; waiting for real due time');
 const row=page.locator('.native-schedule').filter({hasText:'AT_REAL_UI'});await row.locator('summary').filter({hasText:'执行记录'}).click();
 for(let i=0;i<70;i++){await page.waitForTimeout(1000);if(await row.locator('.native-runs .is-done').count())break;await row.locator('summary').filter({hasText:'执行记录'}).click();await page.waitForTimeout(2000);await row.locator('summary').filter({hasText:'执行记录'}).click();}
 await expect(row.locator('.native-runs')).toContainText('完成');await page.screenshot({path:dir+'/schedule-succeeded.png',fullPage:true});passed.push('ui-at-schedule-real-success');
 const admin=await context.newPage();await admin.goto(url+`/tenant-admin/#tenant=${f.tenant}&admin=abilities`);await admin.waitForTimeout(1000);if(await admin.getByRole('region',{name:'选择进入哪一端',exact:true}).count())await admin.getByRole('button',{name:/企业管理端/}).click();try{await expect(admin.locator('.native-plugins').getByRole('heading',{name:'服务设置',exact:true})).toBeVisible({timeout:20000});}catch(e){await admin.screenshot({path:dir+'/admin-failure.png',fullPage:true});await writeFile(dir+'/admin-failure.txt',await admin.locator('body').innerText());throw e;}
 await admin.getByRole('switch',{name:'企业资料工具：已开启',exact:true}).click();await expect(admin.locator('.native-plugin-confirm')).toContainText('进行中的一轮会被中断');await admin.screenshot({path:dir+'/plugin-interruption-warning.png',fullPage:true});
 await admin.getByRole('button',{name:'确认关闭',exact:true}).click();await expect(admin.getByRole('switch',{name:'企业资料工具：已关闭',exact:true})).toBeVisible();
 await send('BROWSER_CAPABILITIES');await idle();await expect(page.locator('.conversation-reply').last()).not.toContainText('enterprise_read');await expect(page.locator('.conversation-reply').last()).not.toContainText('enterprise_save');await page.screenshot({path:dir+'/plugin-tools-disabled.png',fullPage:true});passed.push('ui-plugin-toggle-runtime-tools-removed');
 await admin.getByRole('switch',{name:'企业资料工具：已关闭',exact:true}).click();await admin.getByRole('button',{name:'确认开启',exact:true}).click();await expect(admin.getByRole('switch',{name:'企业资料工具：已开启',exact:true})).toBeVisible();
 await send('BROWSER_CAPABILITIES');await idle();await expect(page.locator('.conversation-reply').last()).toContainText('enterprise_read');passed.push('ui-plugin-toggle-runtime-tools-restored');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'/schedule-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();passed.push('mobile-no-horizontal-overflow');
 await page.setViewportSize({width:1440,height:1000});await page.locator('.native-schedules').getByRole('button',{name:'新建',exact:true}).click();const errors=[];page.on('pageerror',e=>errors.push(e.message));const expiry=page.getByLabel('有效期到',{exact:true});const originalExpiry=await expiry.inputValue();await page.getByLabel('名称',{exact:true}).fill('Expiry recovery');await page.getByLabel('每次要 AI 做什么',{exact:true}).fill('BROWSER_HELLO');await expiry.fill('');await expect(page.locator('.native-schedule-form')).toContainText('填写有效的截止日期');await expect(page.getByRole('button',{name:'创建',exact:true})).toBeDisabled();await page.screenshot({path:dir+'/expiry-cleared-fixed.png',fullPage:true});await expiry.fill(originalExpiry);await expect(page.getByRole('button',{name:'创建',exact:true})).toBeEnabled();expect(errors).toEqual([]);await page.getByRole('button',{name:'取消',exact:true}).click();passed.push('expiry-clear-recover-no-crash');
 const exactAt=new Date(Date.now()+86400000).toISOString();
 for(const [name,rule] of [['AFTER_EDIT',{kind:'after',afterSeconds:3661}],['UTC_EDIT',{kind:'at',at:exactAt}]]){
   const plan=await page.evaluate(async({base,id,name,rule})=>{const csrf=await fetch('/api/v1/auth/csrf').then(r=>r.json());const headers={'content-type':'application/json',[csrf.headerName]:csrf.token};const configuration={title:name,prompt:'BROWSER_HELLO',rule,materialEvents:false,minIntervalSeconds:60,maxRunsPerDay:2,maxTotalRuns:2,expiresAt:new Date(Date.now()+172800000).toISOString()};const response=await fetch(`${base}/${id}/schedules`,{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),configuration})});if(!response.ok)throw Error(await response.text());const plan=await response.json();const pause=await fetch(`${base}/${id}/schedules/${plan.id}`,{method:'PATCH',headers,body:JSON.stringify({state:'PAUSED'})});if(!pause.ok)throw Error(await pause.text());return plan;},{base,id,name,rule});
   await page.reload();await page.getByRole('tab',{name:/^定时/}).click();const item=page.locator('.native-schedule').filter({hasText:name});await item.getByRole('button',{name:'编辑',exact:true}).click();
   if(name==='AFTER_EDIT')await expect(page.getByLabel('延迟秒数（只运行一次）',{exact:true})).toHaveValue('3661');
   await page.getByLabel('名称',{exact:true}).fill(name+'_RENAMED');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.native-schedule').filter({hasText:name+'_RENAMED'})).toBeVisible();
   const stored=await page.evaluate(async({base,id})=>fetch(`${base}/${id}/schedules`).then(r=>r.json()),{base,id});expect(stored.find(x=>x.id===plan.id).configuration.rule).toEqual(rule);passed.push(name.toLowerCase()+'-preserves-rule');
 }
 await page.screenshot({path:dir+'/schedule-edit-fixed.png',fullPage:true});expect(errors).toEqual([]);
 console.log(JSON.stringify({passed,frontendErrors:errors}));await writeFile(dir+'/admin-ui-result.json',JSON.stringify({passed,frontendErrors:errors},null,2));
}catch(error){await page?.screenshot({path:dir+'/failure.png',fullPage:true});await writeFile(dir+'/failure.txt',String(error)+'\n'+await page?.locator('body').innerText()+'\nPassed: '+passed.join(','));throw error;}
finally{await browser?.close();server.kill('SIGTERM');}
