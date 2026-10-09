import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.SITE_BASE_URL||'http://127.0.0.1:5186';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[],api=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 context.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))api.push(u.pathname);if(/^https?:/.test(u.protocol)&&u.origin!==new URL(base).origin)external.push(u.origin);});
 await page.goto(base+'/',{waitUntil:'networkidle'});
 await page.evaluate(()=>{sessionStorage.setItem('dreamcore:document:real-synthetic-user:tenant:draft','must-survive');localStorage.setItem('dreamcore:synthetic-guard','must-survive');});
 await page.goto(base+'/demo/index.html',{waitUntil:'networkidle'});
 await page.locator('button.live-briefing-body').first().waitFor();
 assert.equal(await page.locator('button.live-briefing-body').count(),5);
 assert.deepEqual(await page.evaluate(()=>window.__unmocked||[]),[]);
 await page.goto(base+'/',{waitUntil:'networkidle'});
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('dreamcore:document:real-synthetic-user:tenant:draft')),'must-survive');
 assert.equal(await page.evaluate(()=>localStorage.getItem('dreamcore:synthetic-guard')),'must-survive');
 const figures=page.locator('figure.client-frame');const count=await figures.count();
 for(let i=0;i<count;i++){await figures.nth(i).scrollIntoViewIfNeeded();await figures.nth(i).locator('iframe').waitFor();}
 await page.waitForLoadState('networkidle');
 const missing=[];for(const frame of page.frames().slice(1))missing.push(...await frame.evaluate(()=>window.__unmocked||[]));
 assert.deepEqual(missing,[]);assert.deepEqual(errors,[]);assert.deepEqual(api,[]);assert.deepEqual(external,[]);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(base+'/login/index.html',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'登录',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 }
 console.log(JSON.stringify({status:'SITE_SMOKE_VERIFIED',demoCards:5,homeFrames:count,storagePreserved:true,missingMocks:0,apiRequests:0,externalRequests:0,loginWidths:[1440,390]}));
}finally{await browser.close();}
