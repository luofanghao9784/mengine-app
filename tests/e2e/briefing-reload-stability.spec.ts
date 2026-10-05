import {test,expect} from '@playwright/test';
test('筛选等待时保留卡片节点，成功替换；撤权响应清空',async({page})=>{
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:'00000000-0000-4000-8000-000000000002',phone:'+8619900009001',displayName:'合成成员'},platformAdmin:false,memberships:[]}}));
 let release:()=>void=()=>{}; let waiting="";
 await page.route('**/api/fixture-feed?*',async r=>{
  const q=new URL(r.request().url()).searchParams.get('q');
  if(q!=='first')await new Promise<void>(resolve=>{release=resolve;waiting=q!;});
  if(q==='denied')await r.fulfill({status:403,json:{code:'CAPABILITY_REQUIRED'}});
  else await r.fulfill({json:{items:[q==='first'?'原卡片':'新卡片'],hasMore:false}});
 });
 await page.goto('/tests/fixtures/briefing-reload/');
 await expect(page.getByRole('article')).toHaveText('原卡片');
 const card=await page.getByRole('article').elementHandle();
 await page.getByRole('button',{name:'切换',exact:true}).click();
 await expect(page.locator('[aria-busy=true]')).toBeVisible();
 expect(await card!.evaluate(e=>e.isConnected)).toBe(true);
 await expect(page.getByRole('article')).toHaveText('原卡片');
 await expect.poll(()=>waiting).toBe('next');release();
 await expect(page.getByRole('article')).toHaveText('新卡片');
 await page.getByRole('button',{name:'撤权',exact:true}).click();
 await expect(page.locator('[aria-busy=true]')).toBeVisible();await expect.poll(()=>waiting).toBe('denied');release();
 await expect(page.getByRole('article')).toHaveCount(0);
 await expect(page.getByText('无权限', {exact:true})).toBeVisible();
});
