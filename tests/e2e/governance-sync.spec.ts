import {test,expect} from '@playwright/test';
test('platform governance view distinguishes policy freshness, data readiness and inferred evidence',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成测试企业'}]}));
 await page.route('**/scene/metrics',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true,last_synced_at:'2026-10-15T12:00:00Z',collection_state:'QUEUED'},assets:[{source_id:'a',kind:'TABLE',revision:'r1',updated_at:'2026-10-15T12:00:00Z',metadata:{title:'合成订单',version:2,dictionaryRevision:3,dictionaryStatus:'generated',governance:{policyVersion:4,audience:'private',classification:1},dictionary:{tableMeaning:'订单口径',fields:[{name:'amount',label:'金额',meaning:'源金额',evidence:'DEPLOYMENT_INFERRED'}],relations:[],templates:[{id:'total',name:'金额汇总',question:'按有效订单计算金额'}]}}}],runs:[]}}));
 await page.goto('/tenant-admin/governance/?surface=platform');
 await expect(page.getByRole('heading',{name:'治理成果同步'})).toBeVisible();
 await expect(page.getByText('当前有效',{exact:true})).toBeVisible();await expect(page.getByText('等待处理',{exact:true})).toBeVisible();
 await page.getByText('金额',{exact:true}).click();
 await expect(page.getByText('依据现有结构推断，尚待业务事实核实',{exact:true})).toBeVisible();
 await expect(page.getByText('DEPLOYMENT_INFERRED')).toHaveCount(0);
 await expect(page.getByText('金额汇总：按有效订单计算金额')).toBeVisible();
});

test('published metric versions and paused sources are readable at headquarters',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成企业'}]}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[],runs:[]}}));
 await page.route('**/scene/metrics',r=>r.fulfill({json:{items:[{id:'metric',source_id:'source',head_version:2,published_version:1,current:true,published_current:false,definition:{name:'合成统计',meaning:'测试业务口径',unit:'件',grain:'每条记录',scope:'合成数据',exclusions:'无',evidence:'合成规则',aggregation:'COUNT',valueField:''},history:[{version:2,action:'DRAFT',created_at:'2026-10-16T00:00:00Z'}]}]}}));
 await page.goto('/tenant-admin/governance/?surface=platform');
 await expect(page.getByRole('heading',{name:'业务指标目录'})).toBeVisible();
 await expect(page.getByText('发布口径已暂停用于 AI，需复核后发布新版本。',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'保存草稿'})).toHaveCount(0);
 await page.getByText('版本记录',{exact:true}).click();
 await expect(page.getByText('v2 · 保存草稿',{exact:false})).toBeVisible();
});
