import {test,expect} from '@playwright/test';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(2),space=id(3),material=id(4),version=id(5);
test('governance AI draft is explicitly proposed then maintained without sharing the private task',async({page,context})=>{
 let proposed:any=null,revoked=false;const posts:any[]=[];
 await context.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;const json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path.endsWith('/phone/configuration'))return json({delivery:'DISABLED',localPreview:false});if(path.endsWith('/csrf'))return json({token:'synthetic',headerName:'X-CSRF-TOKEN'});
  if(path==='/api/v1/me')return json({account:{id:actor,email:'synthetic@example.test',displayName:'合成维护者'},platformAdmin:false,memberships:[{tenantId:tenant,tenantName:'合成企业',role:'TENANT_ADMIN'}]});
  if(path.endsWith('/governance'))return json({tenantId:tenant,ownerId:actor,revision:0,owner:true,canConfigure:true,canEnterManagement:true,canAcceptInitialResponsibility:false,pendingHandover:null,capabilities:[]});
  if(path.endsWith('/context'))return json({tenant:{id:tenant,name:'合成企业',status:'ACTIVE'},role:'TENANT_ADMIN',workspaces:[{id:space,name:'合成共享空间',kind:'SHARED'}]});
  const item={id:material,workspaceId:space,workspaceName:'合成共享空间',name:'合成交付资料',version:1,revision:0,canEdit:true,canRedact:false,source:'NOT_CHECKED',quality:null,issues:[],tags:[],reviewAt:null,checkedAt:null};
  if(path.includes('/material-governance'))return path.endsWith(material)?json(item):json({tenantId:tenant,summary:{total:1,checked:0,attention:0,sensitive:0,average:null},filteredTotal:1,items:[item],hasMore:false});
  if(path.includes('/wiki-learning'))return json({id:id(10),tenantId:tenant,materialId:material,versionId:version,conversationId:id(11),taskId:id(12),sourceName:'合成交付资料',sourceVersion:1,status:'SUCCEEDED',executionClass:'verification',modelName:'fixture',article:{title:'交付规范',intro:'交付摘要',content:'交付必须核对真实原件。',evidence:[{chunkId:id(13),quote:'交付必须核对真实原件'}]}});
  if(path.includes('/governance-proposals')){
   if(revoked)return json({contractVersion:'1.0',code:'MATERIAL_NOT_FOUND'},404);
   if(path.includes('/prepare/'))return json({versionId:version,version:1,generation:1,tagsRevision:0,summaryRevision:proposed?.status==='APPLIED'?1:0,tags:[],summary:proposed?.status==='APPLIED'?proposed.patch.summary:null,summaryExecutionClass:proposed?.status==='APPLIED'?'verification':null,canMaintain:true});
   if(route.request().method()==='POST'){
    const b=route.request().postDataJSON();posts.push(b);
    if(path.endsWith('/resolve'))proposed={...proposed,status:b.decision==='APPROVE'?'APPLIED':'REJECTED',resolvedBy:actor,resolvedAt:'2026-10-12T00:01:00Z'};
    else proposed={id:id(20),tenantId:tenant,materialId:material,sourceName:'合成交付资料',kind:b.kind,status:'PENDING',stale:false,patch:{tags:b.tags,summary:b.summary,evidence:[{chunkId:id(13),quote:'交付必须核对真实原件'}],executionClass:'verification',modelName:'fixture'},reason:b.reason,actorId:actor,resolvedBy:null,createdAt:'2026-10-12T00:00:00Z',resolvedAt:null};
    return json(proposed);
   }
   if(path.endsWith('/governance-proposals'))return json({items:proposed&&(url.searchParams.get('status')==='ALL'||url.searchParams.get('status')===proposed.status)?[proposed]:[],hasMore:false});
   return json(proposed);
  }
  return json({contractVersion:'1.0',code:'NOT_FOUND'},404);
 });
 await page.goto(`/tenant-admin/#tenant=${tenant}&admin=materials`);await page.getByRole('button',{name:'查看诊断',exact:true}).click();
 await page.getByRole('button',{name:'AI 生成摘要草稿',exact:true}).click();
 const form=page.locator('form').filter({has:page.getByRole('textbox',{name:'建议摘要',exact:true})});await expect(form).toBeVisible();await form.getByLabel('提案理由',{exact:true}).fill('已核对原文，补充资料摘要');await form.getByRole('button',{name:'提交业务提案',exact:true}).click();
 await expect(page.getByText('提案已提交，尚未采用。请到“业务提案”核对和确认。',{exact:true})).toBeVisible();expect(posts[0].draftId).toBe(id(10));expect(posts[0].expectedRevision).toBe(0);expect(proposed.status).toBe('PENDING');
 await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await page.getByRole('link',{name:'业务提案',exact:true}).click();await page.getByRole('button',{name:/合成交付资料 · 摘要建议/}).click();
 await expect(page.getByText('当前值：未填写',{exact:true})).toBeVisible();await expect(page.getByText('模拟验证生成，需核对真实资料。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'确认采用',exact:true}).click();await expect(page.getByText('已采用，处理结果已记录。',{exact:true})).toBeVisible();expect(posts[1].decision).toBe('APPROVE');
 await page.screenshot({path:'test-results/governance-proposal.png',fullPage:true});revoked=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('已采用，处理结果已记录。',{exact:true})).toHaveCount(0);await expect(page.getByText('交付摘要\n交付必须核对真实原件。',{exact:true})).toHaveCount(0);
});
