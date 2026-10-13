import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { Store } from "../src/store.js";
import { canManage, canRead, type Doc } from "../src/domain.js";
import { realWorkflow } from "../../web/src/components/flow-stages.js";

async function fixture(run: (ctx: Awaited<ReturnType<typeof buildServer>>, login: (name: string) => Promise<{ cookie: string }>, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-flow-"));
  const ctx = await buildServer({ demo: true, storage: dir });
  const login = async (name: string) => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } });
    assert.equal(r.statusCode, 200);
    return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
  };
  try { await run(ctx, login, dir); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
async function upload(ctx: Awaited<ReturnType<typeof buildServer>>, headers: { cookie: string }, filename: string, text: string) {
  const boundary = "mengine-orbit-test";
  return ctx.app.inject({ method: "POST", url: "/api/documents", headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`) });
}
test("流转接口要求会话，跨企业的任务、数量和记录均不可见", async () => fixture(async ({ app }, login) => {
  assert.equal((await app.inject({ url: "/api/flow", headers: { "x-user-id": "u-admin" } })).statusCode, 401);
  const r = await app.inject({ url: "/api/flow?tenantId=mengine-demo", headers: await login("external") });
  assert.equal(r.statusCode, 200); assert.match(String(r.headers["cache-control"]), /no-store/);
  assert.equal(r.json().total, 0); assert.deepEqual(r.json().items, []);
  assert.deepEqual(r.json().counts, { processing: 0, quarantined: 0, failed: 0, published: 0, pending: 0 });
}));
test("统计与任务使用同一权限范围，管理元数据不包含正文、摘要或原件路径", async () => fixture(async ({ app, store }, login) => {
  for (const name of ["admin", "steward", "engineer", "hr", "auditor"]) {
    const user = store.user(`u-${name}`)!, headers = await login(name);
    const snapshot = (await app.inject({ url: "/api/flow", headers })).json();
    const visible = store.documents(user.tenantId).filter(d => canRead(user, d) || canManage(user, d));
    assert.equal(snapshot.total, visible.length);
    assert.deepEqual(new Set(snapshot.items.map((d: Doc) => d.id)), new Set(visible.map(d => d.id)));
    assert.equal(snapshot.counts.published, visible.filter(d => d.status === "ready").length);
    const overview = (await app.inject({ url: "/api/overview", headers })).json();
    for (const key of ["visible", "departments", "quality", "pending"]) assert.equal(snapshot.stats[key], overview.stats[key]);
    for (const item of snapshot.items) for (const key of ["content", "summary", "originalPath", "sha", "error", "grants"])
      assert.equal(item[key], undefined);
    if (name === "admin") { const restricted = snapshot.items.find((d: Doc) => d.id === "doc-7"); assert.equal(restricted.canRead, true); assert.equal(restricted.canManage, true); }
  }
}));
test("每次同步重新检查文档 ACL、密级和账号会话，撤权后移除事件与统计", async () => fixture(async ({ app, store }, login) => {
  const headers = await login("engineer"), doc = store.doc("mengine-demo", "doc-2")!;
  const initial = (await app.inject({ url: "/api/flow", headers })).json();
  assert.ok(initial.items.some((d: Doc) => d.id === doc.id));
  doc.audience = "private"; doc.ownerId = "u-admin"; doc.grants = []; store.saveDoc(doc);
  const after = (await app.inject({ url: "/api/flow", headers })).json();
  assert.ok(after.items.every((d: Doc) => d.id !== doc.id)); assert.equal(after.total, initial.total - 1);
  const user = store.user("u-engineer")!; user.active = false; store.saveUser(user);
  assert.equal((await app.inject({ url: "/api/flow", headers })).statusCode, 401);
}));
test("真实上传留下接收、解析、治理、发布记录，去重不会虚构第二次流转", async () => fixture(async (ctx, login) => {
  const headers = await login("engineer"), text = "这是一份星环流程验收资料，内容经过授权和数据治理，发布后只在技术研发部门内检索。".repeat(3);
  const r = await upload(ctx, headers, "orbit.txt", text); assert.equal(r.statusCode, 201);
  await ctx.processor.close(); const id = r.json().document.id;
  assert.deepEqual(ctx.store.flowEvents("mengine-demo", id).map(e => e.event).reverse(), ["received", "parsing", "scanning", "published"]);
  const result = (await ctx.app.inject({ url: "/api/flow", headers })).json().items.find((d: Doc) => d.id === id);
  assert.equal(result.phase, "ready"); assert.equal(result.canRead, true);
  assert.equal((await upload(ctx, headers, "duplicate.txt", text)).json().duplicate, true);
  assert.equal(ctx.store.flowEvents("mengine-demo", id).length, 4);
}));
test("敏感资料停止发布，只有授权治理人员可处理，复核成功后记录恢复发布", async () => fixture(async (ctx, login) => {
  const member = await login("engineer"), steward = await login("steward");
  const r = await upload(ctx, member, "sensitive.txt", "星环隔离验收，联系人手机号 13800138000。");
  await ctx.processor.close(); const id = r.json().document.id;
  const task = (await ctx.app.inject({ url: "/api/flow", headers: member })).json().items.find((d: Doc) => d.id === id);
  assert.equal(task.phase, "quarantined"); assert.equal(task.classification, 2); assert.equal(task.canRead, false); assert.equal(task.canRemediate, false);
  assert.ok(task.events.every((e: { event: string }) => e.event !== "published"));
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/governance/${id}/remediate`, headers: member })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/governance/${id}/remediate`, headers: steward })).statusCode, 200);
  assert.equal(ctx.store.flowEvents("mengine-demo", id)[0].event, "remediated");
  assert.equal(ctx.store.doc("mengine-demo", id)!.status, "ready");
  assert.equal(ctx.store.doc("mengine-demo", id)!.classification, 2);
}));
test("失败重试有真实记录，归档中的异步解析失败不能恢复任务", async () => fixture(async (ctx, login) => {
  const headers = await login("engineer"), r = await upload(ctx, headers, "empty.txt", "   ");
  await ctx.processor.close(); const id = r.json().document.id;
  assert.equal(ctx.store.doc("mengine-demo", id)!.status, "failed");
  await writeFile(ctx.store.doc("mengine-demo", id)!.originalPath, "修复后的可解析文件，验证重试流程。");
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/documents/${id}/retry`, headers })).statusCode, 200);
  await ctx.processor.close();
  assert.equal(ctx.store.doc("mengine-demo", id)!.status, "ready");
  assert.deepEqual(ctx.store.flowEvents("mengine-demo", id).slice(0, 4).map(e => e.event).reverse(), ["retry", "parsing", "scanning", "published"]);
  const doc = ctx.store.doc("mengine-demo", id)!; doc.status = "queued"; doc.originalPath += ".missing"; ctx.store.saveDoc(doc);
  const pending = ctx.processor.process(doc);
  doc.status = "archived"; ctx.store.saveDoc(doc); await pending;
  assert.equal(ctx.store.doc("mengine-demo", id)!.status, "archived"); assert.equal(ctx.store.flowEvents("mengine-demo", id)[0].event, "archived");
}));
test("权限提案等待审批不会阻断已发布资料，只向有权查看提案的人显示", async () => fixture(async ({ app, store }, login) => {
  const steward = await login("steward"), admin = await login("admin"), member = await login("engineer");
  const p = (await app.inject({ method: "POST", url: "/api/proposals", headers: steward, payload: { documentId: "doc-1", action: "permissions", patch: { audience: "organization" }, reason: "星环审批验收" } })).json();
  const snapshot = (await app.inject({ url: "/api/flow", headers: admin })).json();
  const task = snapshot.items.find((d: Doc) => d.id === "doc-1"); assert.equal(task.phase, "ready"); assert.equal(task.pending[0].id, p.id);
  assert.equal((await app.inject({ url: "/api/flow", headers: member })).json().items.find((d: Doc) => d.id === "doc-1").pending.length, 0);
  assert.equal((await app.inject({ method: "POST", url: `/api/proposals/${p.id}/resolve`, headers: admin, payload: { decision: "approve" } })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/flow", headers: admin })).json().items.find((d: Doc) => d.id === "doc-1").pending.length, 0);
  assert.equal(store.flowEvents("mengine-demo", "doc-1")[0].event, "permissions-applied");
}));
test("列表截取前统计完整范围，优先展示进行中任务", async () => fixture(async ({ app, store }, login) => {
  const template = store.doc("mengine-demo", "doc-1")!;
  for (let i = 0; i < 45; i++) store.saveDoc({ ...template, id: `bulk-${i}`, sha: `bulk-${i}`, status: i === 44 ? "queued" : "ready" });
  const snapshot = (await app.inject({ url: "/api/flow", headers: await login("admin") })).json();
  assert.equal(snapshot.items.length, 40); assert.equal(snapshot.total, store.documents("mengine-demo").length); assert.equal(snapshot.items[0].id, "bulk-44");
  assert.equal(snapshot.counts.published, store.documents("mengine-demo").filter(d => d.status === "ready").length);
}));
test("事件随资料事务回滚并持久化，升级前资料不补造历史步骤", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mengine-flow-disk-")), path = join(dir, "flow.db");
  const ctx = await buildServer({ demo: true, dbPath: path, storage: dir });
  const d = ctx.store.doc("mengine-demo", "doc-1")!;
  ctx.store.db.prepare("DELETE FROM document_flow_events WHERE document_id=?").run(d.id);
  ctx.store.saveDoc({ ...d }); assert.equal(ctx.store.flowEvents(d.tenantId, d.id).length, 0);
  assert.throws(() => ctx.store.db.transaction(() => { ctx.store.saveDoc({ ...d, status: "archived" }); throw new Error("rollback"); })());
  assert.equal(ctx.store.doc(d.tenantId, d.id)!.status, "ready"); assert.equal(ctx.store.flowEvents(d.tenantId, d.id).length, 0);
  ctx.store.saveDoc({ ...d, status: "archived" }); await ctx.app.close();
  const restored = new Store(path);
  try { assert.equal(restored.flowEvents(d.tenantId, d.id)[0].event, "archived"); assert.equal(restored.db.pragma("user_version", { simple: true }), 10); }
  finally { restored.close(); await rm(dir, { recursive: true, force: true }); }
});

test("真实发布主线兼容隔离脱敏与独立审批，保持原有指标与授权", async () => fixture(async (ctx, login) => {
  const owner = await login("steward"), steward = owner, admin = await login("admin");
  const uploaded = await upload(ctx, owner, "workflow.txt", "发布主线业务流程验收，联系方式为 13800138000。".repeat(4));
  await ctx.processor.close(); const id = uploaded.json().document.id;
  const snapshot = async (headers = admin) => (await ctx.app.inject({ url: "/api/flow", headers })).json();
  const current = async (headers = admin) => (await snapshot(headers)).items.find((d: Doc) => d.id === id);
  const before = await snapshot();
  assert.equal(realWorkflow(await current()).current, "scanning");
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/governance/${id}/remediate`, headers: steward })).statusCode, 200);
  const recovered = await current();
  assert.equal(realWorkflow(recovered).stages.find(s => s.id === "scanning")?.state, "done");
  assert.equal(realWorkflow(recovered).current, "published");
  assert.equal((await snapshot()).stats.visible, before.stats.visible + 1); // Admin can read the newly published enterprise document.
  const submitted = await ctx.app.inject({ method: "POST", url: "/api/proposals", headers: owner,
    payload: { documentId: id, action: "permissions", patch: { audience: "organization" }, reason: "发布主线与独立审批" } });
  assert.equal(submitted.statusCode, 200); const p = submitted.json();
  assert.equal((await current()).permissionReview.state, "pending");
  assert.equal(realWorkflow(await current()).current, "published");
  assert.equal((await current()).phase, "ready");
  assert.equal((await ctx.app.inject({ method: "POST", url: `/api/proposals/${p.id}/resolve`, headers: admin, payload: { decision: "approve" } })).statusCode, 200);
  assert.equal((await current()).permissionReview.state, "applied");
  assert.equal(realWorkflow(await current()).current, "published");
  assert.equal((await snapshot()).stats.visible, before.stats.visible + 1);
  assert.equal((await snapshot()).stats.pending, before.stats.pending);
  // Many later edits cannot erase the proven isolation/remediation history.
  for (let i = 0; i < 12; i++) ctx.store.saveDoc(ctx.store.doc("mengine-demo", id)!, "edited");
  const edited = await current();
  assert.ok(edited.events.every((e: {event: string}) => e.event === "edited"));
  assert.equal(realWorkflow(edited).stages.find(s => s.id === "scanning")?.state, "done");
  ctx.store.saveDoc({ ...ctx.store.doc("mengine-demo", id)!, status: "queued" }, "retry");
  assert.deepEqual(ctx.store.flowMilestones("mengine-demo", id).map(e => e.event), ["retry"]);
}));

test("独立权限提案保留可见性、失效和驳回规则，不改变发布主线", async () => fixture(async ({ app, store }, login) => {
  const admin = await login("admin"), steward = await login("steward"), member = await login("engineer");
  const current = async (headers = admin) => (await app.inject({ url: "/api/flow", headers })).json().items.find((d: Doc) => d.id === "doc-1");
  const propose = async (action: string, patch: object) => (await app.inject({ method: "POST", url: "/api/proposals", headers: steward, payload: { documentId: "doc-1", action, patch, reason: "权限流程边界验收" } })).json();
  await propose("organize", { tags: ["测试"] });
  assert.equal((await current()).permissionReview.state, "none");
  const request = await propose("permissions", { audience: "organization" });
  assert.equal((await current(member)).permissionReview.state, "none");
  const d = store.doc("mengine-demo", "doc-1")!; d.version++; store.saveDoc(d, "edited");
  assert.equal((await current()).permissionReview.state, "stale");
  assert.equal((await app.inject({ method: "POST", url: `/api/proposals/${request.id}/resolve`, headers: admin, payload: { decision: "approve" } })).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: `/api/proposals/${request.id}/resolve`, headers: admin, payload: { decision: "reject" } })).statusCode, 200);
  assert.equal((await current()).permissionReview.state, "rejected");
  assert.equal(realWorkflow(await current()).stages.find(s => s.id === "published")?.state, "done");
  assert.equal((await current(member)).permissionReview.state, "none");
}));
test('结构化星环依据真实结构、行状态和模型任务事件展示，不伪造已学习状态', async()=>fixture(async({app,store,model},login)=>{
 const headers=await login('admin');
 const r=await app.inject({method:'POST',url:'/api/foundation',headers,payload:{title:'星环结构化验收',department:'企业管理',purpose:'合成测试',source:'合成',updatePolicy:'按需',fields:[{name:'id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:''}]}});
 assert.equal(r.statusCode,201,r.body);const id=r.json().id;
 const state=async()=> (await app.inject({url:'/api/flow',headers})).json();
 let item=(await state()).items.find((x:any)=>x.id===id);
 assert.equal(item.structured.total,0);assert.equal(item.structured.dictionary,'waiting');assert.equal(realWorkflow(item).stages[2].state,'waiting');assert.ok(item.events.some((e:any)=>e.event==='structure-stored'));
 await app.inject({method:'POST',url:`/api/foundation/${id}/records`,headers,payload:{values:{id:''},expectedVersion:1,reason:'验收隔离'}});
 item=(await state()).items.find((x:any)=>x.id===id);assert.equal(item.structured.isolated,1);assert.equal(realWorkflow(item).stages[1].state,'blocked');assert.ok(item.events.some((e:any)=>e.event==='records-checked'));
 model.config.apiKey='test-only';let release!:()=>void;const hold=new Promise<void>(r=>release=r);
 model.complete=async()=>{await hold;return {text:JSON.stringify({tableMeaning:'合成测试表',usageRules:'仅验收',fields:[{name:'id',label:'编号',meaning:'记录编号',unit:'无',rules:'必填',evidence:'源结构'}],relations:[],templates:[]}),usage:null};};
 const pending=app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers,payload:{}}).then(r=>r);
 for(let i=0;i<100;i++){item=(await state()).items.find((x:any)=>x.id===id);if(item.structured.run==='dictionary-generating')break;await new Promise(r=>setTimeout(r,5));}
 try{assert.equal(item.structured.run,'dictionary-generating');assert.equal(realWorkflow(item).stages[2].state,'current');assert.ok((await state()).counts.processing>0);}finally{release();}
 assert.equal((await pending).statusCode,200);
 item=(await state()).items.find((x:any)=>x.id===id);assert.equal(item.structured.dictionary,'generated');assert.equal(realWorkflow(item).stages[2].state,'done');assert.ok(item.structured.generatedAt);
 model.complete=async()=>{throw Error('test failure');};await app.inject({method:'POST',url:`/api/foundation/${id}/dictionary/generate`,headers,payload:{}});
 item=(await state()).items.find((x:any)=>x.id===id);assert.equal(item.structured.run,'dictionary-failed');assert.equal(realWorkflow(item).stages[2].state,'failed');assert.equal(item.structured.dictionary,'generated');
 assert.ok(!(await app.inject({url:'/api/flow',headers:await login('external')})).json().items.some((x:any)=>x.id===id));
 const raw=JSON.parse((store.db.prepare('SELECT data FROM data_sets WHERE id=?').get(id) as any).data);raw.fields[0].description='结构变更';store.db.prepare('UPDATE data_sets SET data=? WHERE id=?').run(JSON.stringify(raw),id);
 item=(await state()).items.find((x:any)=>x.id===id);assert.equal(item.structured.dictionary,'changed');
}));
test('星环分类与搜索在授权过滤后、40项截断前执行，概览指标不随筛选改变',async()=>fixture(async({app,store},login)=>{
 const headers=await login('admin');const source=store.documents('mengine-demo')[0];
 for(let i=0;i<45;i++)store.saveDoc({...source,id:`filter-doc-${i}`,sha:`filter-sha-${i}`,title:`搜索验收文档 ${i}`,updatedAt:'2000-01-01T00:00:00.000Z'});
 const created=await app.inject({method:'POST',url:'/api/foundation',headers,payload:{title:'搜索验收数据表',department:'企业管理',purpose:'合成',source:'合成',updatePolicy:'按需',fields:[{name:'id',label:'编号',type:'text',required:true,unique:true,sensitive:false,description:''}]}});assert.equal(created.statusCode,201,created.body);
 const get=async(q:string)=>(await app.inject({url:'/api/flow'+q,headers})).json();const all=await get('');assert.equal(all.items.length,40);
 const doc=await get('?kind=document&q='+encodeURIComponent('搜索验收文档 44'));assert.equal(doc.matched,1);assert.equal(doc.items[0].id,'filter-doc-44');assert.deepEqual(doc.stats,all.stats);assert.deepEqual(doc.counts,all.counts);
 const table=await get('?kind=table&q='+encodeURIComponent('搜索验收'));assert.equal(table.matched,1);assert.equal(table.items[0].id,created.json().id);assert.equal(table.categories.table,1);
 const none=await get('?kind=table&q='+encodeURIComponent('搜索验收文档'));assert.equal(none.matched,0);assert.deepEqual(none.items,[]);
 const foreign=(await app.inject({url:'/api/flow?q='+encodeURIComponent('搜索验收'),headers:await login('external')})).json();assert.equal(foreign.matched,0);assert.equal(foreign.categories.all,0);
 assert.equal((await app.inject({url:'/api/flow?kind=secret',headers})).statusCode,400);
}));
