import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/auth/csrf',r=>r.fulfill({json:{headerName:'X-CSRF-TOKEN',token:'synthetic-token',parameterName:'_csrf'}}));await page.route('**/scene/metrics/generation',r=>r.fulfill({json:{enabled:true,created_count:0}}));});
test('platform governance view distinguishes policy freshness, data readiness and inferred evidence',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成测试企业'}]}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true,last_synced_at:'2026-10-15T12:00:00Z',collection_state:'QUEUED'},assets:[{source_id:'a',kind:'TABLE',revision:'r1',updated_at:'2026-10-15T12:00:00Z',metadata:{title:'合成订单',version:2,dictionaryRevision:3,dictionaryStatus:'generated',governance:{policyVersion:4,audience:'private',classification:1},dictionary:{tableMeaning:'订单口径',fields:[{name:'amount',label:'金额',meaning:'源金额',evidence:'DEPLOYMENT_INFERRED'}],relations:[],templates:[{id:'total',name:'金额汇总',question:'按有效订单计算金额'}]}}}],runs:[]}}));
 await page.goto('/tenant-admin/governance/?surface=platform');
 await expect(page.getByRole('heading',{name:'数据口径同步'})).toBeVisible();
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
 await expect(page.getByText('第 2 版 · 保存草稿',{exact:false})).toBeVisible();
});

test('tenant generated drafts require explicit review before publication and preserve the execution plan',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';let saved:any=null;
 const item={id:'22222222-2222-4222-8222-222222222222',source_id:'source',head_version:1,published_version:null,current:true,published_current:false,generation:{origin:'RULE_BASED'},definition:{name:'合成记录数',meaning:'每行一条记录',unit:'条',grain:'源记录',scope:'当前快照全部记录',exclusions:'无',evidence:'合成来源规则',aggregation:'COUNT',valueField:'',execution:{groupColumns:[],dateColumn:'',dateFrom:'',dateTo:'',timeZone:'Asia/Shanghai',reviewed:false}},history:[]};
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'synthetic@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[{source_id:'source',kind:'TABLE',metadata:{title:'合成记录'}}],runs:[]}}));
 await page.route('**/scene/metrics/generation',r=>r.fulfill({json:r.request().method()==='POST'?{created:1,paused:false}:{enabled:true,created_count:1}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,async r=>{if(r.request().method()==='POST'){saved=r.request().postDataJSON();item.head_version=2;item.definition=saved.definition;}await r.fulfill({json:{items:[item]}})});
 await page.goto('/tenant-admin/governance/?surface=tenant');
 await expect(page.getByRole('button',{name:'确认并发布 第 1 版'})).toBeDisabled();
 await page.route('**/company-information/source',r=>r.fulfill({json:{tenantId:tenant,sourceId:`company-background:${tenant}`,type:'COMPANY_BACKGROUND',state:'AVAILABLE',version:'a'.repeat(64),knowledgeIntegration:'REFERENCE_READY',entries:[{id:tenant,versionId:tenant,revision:1,field:'TERM',label:'合成到账口径',meaning:'银行确认',origin:'HUMAN',humanProtected:true,provenance:'合成测试',updatedAt:'2026-10-18T00:00:00Z'}]}}));
 await page.reload();
 await page.getByRole('button',{name:'生成指标草稿'}).click();
 await expect(page.getByRole('status')).toContainText('新增 1 项待核实草稿');
 await page.getByRole('button',{name:'编辑新版本'}).click();
 await page.getByLabel('合成到账口径 · 第 1 版',{exact:false}).check();
 await page.getByRole('checkbox',{name:/我已核对业务依据/}).check();
 await page.getByRole('button',{name:'保存草稿'}).click();
 await expect.poll(()=>saved?.definition?.backgroundVersionIds).toEqual([tenant]);
 await expect(page.getByRole('button',{name:'确认并发布 第 2 版'})).toBeEnabled();
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

test('unbound tenant selects a maintained workspace before synchronization',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111',space='22222222-2222-4222-8222-222222222222';let bound=false;
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'synthetic@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/binding',r=>{if(r.request().method()==='POST'){expect(r.request().postDataJSON()).toEqual({workspaceId:space});bound=true;}return r.fulfill({json:{bindings:bound?[{workspace_id:space,maintainer_id:tenant}]:[],workspaces:[{id:space,name:'财务核对'}]}})});
 await page.route('**/scene/status',r=>r.fulfill(bound?{json:{tenantId:tenant,governance:{policy_current:false},assets:[],runs:[]}}:{status:404,json:{code:'SCENE_TENANT_NOT_BOUND'}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.goto('/tenant-admin/governance/?surface=tenant');
 await expect(page.getByRole('button',{name:'立即同步'})).toBeDisabled();
 await page.getByLabel('治理目标空间').selectOption(space);
 await page.getByRole('button',{name:'建立来源映射'}).click();
 await expect(page.getByText('治理目标空间：',{exact:false})).toContainText('财务核对');
 await expect(page.getByRole('button',{name:'立即同步'})).toBeEnabled();
});

test('metric form sends explicit equalities and monetary conversion and resets review after changes',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';let saved:any;
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'synthetic@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/binding',r=>r.fulfill({json:{bindings:[{workspace_id:tenant}],workspaces:[{id:tenant,name:'财务核对'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[{source_id:'source',kind:'TABLE',metadata:{title:'合成收款',dictionary:{fields:[{name:'amount_cents',label:'收款金额'},{name:'status',label:'收款状态'}]}}}],runs:[]}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>{if(r.request().method()==='POST')saved=r.request().postDataJSON();return r.fulfill({json:{items:[]}})});
 await page.goto('/tenant-admin/governance/?surface=tenant');await page.getByLabel('指标来源').selectOption('source');
 for(const [label,value] of [['指标名称','成功收款'],['业务含义','成功记录求和'],['输出单位（分转元时填写元）','元'],['统计粒度（每行代表什么）','收款事件'],['适用范围与时间口径','合成演示'],['排除项（没有则填写“无”）','无'],['业务依据与来源说明','合成源字典']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByLabel('统计方式',{exact:true}).selectOption('SUM');await page.getByLabel('数值字段').selectOption('amount_cents');
 await page.getByRole('button',{name:'添加筛选条件'}).click();await page.getByLabel('筛选字段1').selectOption('status');await page.getByLabel('筛选值1').fill('SUCCESS');
 await page.getByLabel('金额单位换算').selectOption('CENTS_TO_YUAN');await page.getByRole('checkbox',{name:/我已核对/}).check();
 await page.getByLabel('筛选值1').fill('COMPLETED');await expect(page.getByRole('checkbox',{name:/我已核对/})).not.toBeChecked();
 await page.getByRole('checkbox',{name:/我已核对/}).check();await page.getByRole('button',{name:'保存草稿'}).click();
 await expect.poll(()=>saved?.definition?.execution?.equalsFilters).toEqual({status:'COMPLETED'});expect(saved.definition.execution.conversion).toBe('CENTS_TO_YUAN');
});

test('resource routing requires a target and saves an explicit reader list without automatic sync',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111',space='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';let saved:any;let syncCalls=0;
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:actor,email:'test@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/binding',r=>r.fulfill({json:{bindings:[{workspace_id:space}],workspaces:[{id:space,name:'样例店'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[],runs:[]}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.route('**/scene/synchronize',r=>{syncCalls++;return r.fulfill({json:{}})});
 await page.route('**/scene/routes',r=>{
  if(r.request().method()==='POST'){saved=r.request().postDataJSON();return r.fulfill({json:{revision:1,routes:saved.routes}});}
  return r.fulfill({json:{revision:saved?1:0,routes:saved?.routes??[],sources:[{id:'salary-a',name:'本店薪酬'}],members:[{id:actor,name:'店长甲'}]}});
 });
 await page.goto('/tenant-admin/governance/?surface=tenant');
 await page.getByText('按来源配置目标空间与读取人员',{exact:true}).click();
 await page.getByRole('button',{name:'列入同步清单'}).click();
 await expect(page.getByRole('button',{name:'保存完整同步清单'})).toBeDisabled();
 await page.getByLabel('来源目标空间').selectOption(space);await page.getByRole('checkbox',{name:'店长甲'}).check();
 await page.getByRole('button',{name:'保存完整同步清单'}).click();
 await expect(page.getByRole('status')).toContainText('旧副本已暂停读取');
 expect(saved).toEqual({revision:0,routes:[{sourceId:'salary-a',workspaceId:space,readers:[actor]}]});expect(syncCalls).toBe(0);
 await expect(page.getByText('已过期或尚未完成',{exact:true})).toBeVisible();
});

test('independent publication saves only selected spaces and does not start synchronization',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111',space='22222222-2222-4222-8222-222222222222';let saved:any;let synchronized=0;
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'test@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/binding',r=>r.fulfill({json:{bindings:[{workspace_id:space}],workspaces:[{id:space,name:'样例店'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[],runs:[]}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.route('**/scene/routes',r=>r.fulfill({json:{revision:1,routes:[],sources:[],members:[]}}));
 await page.route('**/scene/synchronize',r=>{synchronized++;return r.fulfill({json:{}})});
 await page.route('**/scene/publication',r=>{if(r.request().method()==='POST')saved=r.request().postDataJSON();return r.fulfill({json:{revision:saved?2:1,workspaces:saved?.workspaces??[],choices:[{id:space,name:'样例店'}]}})});
 await page.goto('/tenant-admin/governance/?surface=tenant');await page.getByText('同步发布权限（独立于资料维护）',{exact:true}).click();
 await page.getByRole('checkbox',{name:'样例店',exact:true}).check();await page.getByRole('button',{name:'保存同步发布权限'}).click();
 await expect(page.getByRole('status')).toContainText('日常资料权限未改变');expect(saved).toEqual({revision:1,workspaces:[space]});expect(synchronized).toBe(0);
});

test('fixed reconciliation shows unknown coverage and clears results after input changes',async({page})=>{
 const tenant='11111111-1111-4111-8111-111111111111';let calls=0;
 await page.route('**/api/v1/me',r=>r.fulfill({json:{account:{id:tenant,email:'synthetic@example.invalid',displayName:'合成管理员'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[],runs:[]}}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.route('**/onboarding-reconciliation',r=>{if(r.request().method()==='GET')return r.fulfill({json:{stores:[{id:'store-synthetic',name:'合成门店'}]}});calls++;expect(r.request().postDataJSON()).toEqual({storeId:'store-synthetic',dateFrom:'2026-10-01',dateTo:'2026-10-02'});return r.fulfill({json:{receiptId:'synthetic-receipt',result:{amounts:{cashRefund:{cents:'100',included:1,outside:0,unknown:1}},issues:[]}}})});
 await page.goto('/tenant-admin/governance/?surface=tenant');await page.getByText('首批三表金额与关联核查',{exact:true}).click();
 await page.getByLabel('门店',{exact:true}).selectOption('store-synthetic');await page.getByLabel('开始日期',{exact:true}).fill('2026-10-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-10-02');await page.getByRole('button',{name:'运行核查',exact:true}).click();
 await expect(page.getByText(/核查回执已保存/)).toBeVisible();expect(calls).toBe(1);await page.getByLabel('结束日期',{exact:true}).fill('2026-10-03');await expect(page.getByText(/核查回执已保存/)).toHaveCount(0);
});

test('governance metadata title wins and all version and unknown code labels stay Chinese', async ({page}) => {
 const tenant='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/platform-admin/v1/scene-enterprises',r=>r.fulfill({json:[{tenant_id:tenant,name:'合成企业'}]}));
 await page.route(/\/scene\/metrics(?:\?.*)?$/,r=>r.fulfill({json:{items:[]}}));
 await page.route('**/scene/status',r=>r.fulfill({json:{tenantId:tenant,governance:{policy_current:true},assets:[{source_id:'a',kind:'FUTURE_KIND',revision:'opaque-hash',metadata:{title:'优先显示业务标题',version:2,dictionaryRevision:1,tags:['internal_material','FUTURE_CATEGORY'],governance:{policyVersion:3,audience:'private',classification:1},dictionary:{fields:[{name:'funnel_stage',evidence:'synth_demo.sqlite 字段说明 v1'},{name:'future_field'}]}}}],runs:[{id:'r',operation:'FUTURE_ACTION',state:'SUCCEEDED'}]}}));
 await page.goto('/tenant-admin/governance/?surface=platform');
 await expect(page.getByRole('heading',{name:'优先显示业务标题'})).toBeVisible();
 await expect(page.getByText('来源第 2 版 · 权限第 3 版')).toBeVisible();
 await expect(page.getByText('源数据第 2 版',{exact:true})).toBeVisible();
 await expect(page.getByText('线索漏斗阶段',{exact:true})).toBeVisible();
 await expect(page.locator('body')).toContainText('内部资料 · 其他记录');
 await page.getByText('最近处理记录',{exact:true}).click();
 await expect(page.locator('body')).toContainText('其他操作');
 await expect(page.locator('body')).not.toContainText(/FUTURE_KIND|FUTURE_CATEGORY|FUTURE_ACTION|future_field|funnel_stage|opaque-hash/);
 await page.screenshot({path:'test-results/data-copy-governance.png',fullPage:true});
});
