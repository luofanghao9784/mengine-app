import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/auth/csrf',r=>r.fulfill({json:{headerName:'X-CSRF-TOKEN',token:'synthetic-token',parameterName:'_csrf'}}));await page.route('**/scene/metrics/generation',r=>r.fulfill({json:{enabled:true,created_count:0}}));});
test('platform governance view distinguishes policy freshness, data readiness and inferred evidence',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成测试企业'}]}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
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
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[{id:'metric',source_id:'source',head_version:2,published_version:1,current:true,published_current:false,definition:{name:'合成统计',meaning:'测试业务口径',unit:'件',grain:'每条记录',scope:'合成数据',exclusions:'无',evidence:'合成规则',aggregation:'COUNT',valueField:''},history:[{version:2,action:'DRAFT',created_at:'2026-10-16T00:00:00Z'}]}]}}));
 await page.goto('/tenant-admin/governance/?surface=platform');
 await expect(page.getByRole('heading',{name:'业务指标目录'})).toBeVisible();
 await expect(page.getByText('发布口径已暂停用于 AI，需复核后发布新版本。',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'保存草稿'})).toHaveCount(0);
 await page.getByText('版本记录',{exact:true}).click();
 await expect(page.getByText('v2 · 保存草稿',{exact:false})).toBeVisible();
});

test('tenant generated drafts require explicit review before publication and preserve the execution plan',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';let saved:any=null;
 const item={id:'22222222-2222-4222-8222-222222222222',source_id:'source',head_version:1,published_version:null,current:true,published_current:false,generation:{origin:'RULE_BASED'},definition:{name:'合成记录数',meaning:'每行一条记录',unit:'条',grain:'源记录',scope:'当前快照全部记录',exclusions:'无',evidence:'合成来源规则',aggregation:'COUNT',valueField:'',execution:{groupColumns:[],dateColumn:'',dateFrom:'',dateTo:'',timeZone:'Asia/Shanghai',reviewed:false}},history:[]};
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'synthetic@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[{source_id:'source',kind:'TABLE',metadata:{title:'合成记录'}}],runs:[]}}));
 await page.route('**/scene/metrics/generation',r=>r.fulfill({json:r.request().method()==='POST'?{created:1,paused:false}:{enabled:true,created_count:1}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,async r=>{if(r.request().method()==='POST'){saved=r.request().postDataJSON();item.head_version=2;item.definition=saved.definition;}await r.fulfill({json:{items:[item]}})});
 await page.goto('/tenant-admin/governance/?surface=tenant');
 await expect(page.getByRole('button',{name:'确认并发布 v1'})).toBeDisabled();
 await page.getByRole('button',{name:'生成指标草稿'}).click();
 await expect(page.getByRole('status')).toContainText('新增 1 项待核实草稿');
 await page.getByRole('button',{name:'编辑新版本'}).click();
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'保存草稿'}).click();
 await expect(page.getByRole('button',{name:'确认并发布 v2'})).toBeEnabled();
 expect(saved.definition.execution).toEqual({groupColumns:[],dateColumn:'',dateFrom:'',dateTo:'',timeZone:'Asia/Shanghai',reviewed:true});
});


test('metric catalog pages and searches the complete server catalog',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成企业'}]}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[],runs:[]}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>{const u=new URL(r.request().url());const query=u.searchParams.get('query');const offset=Number(u.searchParams.get('offset'));return r.fulfill({json:{total:query?1:145,hasMore:!query&&offset<132,items:[{id:'metric-'+offset,head_version:1,published_version:null,current:true,definition:{name:query?'目录末尾指标':'第'+(offset+1)+'项',meaning:'合成',unit:'条',grain:'记录',scope:'合成',exclusions:'无',evidence:'合成',aggregation:'COUNT',valueField:''},history:[]}]}})});
 await page.goto('/tenant-admin/governance/?surface=platform');await expect(page.getByText('共 145 项 · 第 1 页')).toBeVisible();
 await page.getByRole('button',{name:'下一页指标'}).click();await expect(page.getByRole('heading',{name:'第13项',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'搜索指标'}).fill('目录末尾');await expect(page.getByRole('heading',{name:'目录末尾指标',exact:true})).toBeVisible();await expect(page.getByText('共 1 项 · 第 1 页')).toBeVisible();await expect(page.getByRole('button',{name:'下一页指标'})).toBeDisabled();
});
