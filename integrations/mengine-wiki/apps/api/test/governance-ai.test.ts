import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { Store } from "../src/store.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { governanceInput, validateAssessment } from "../src/governance-ai.js";
type Context = Awaited<ReturnType<typeof buildServer>>;
const path = "/api/governance/doc-2/analysis";
function answer(input: string) {
  const data = JSON.parse(input), evidence = [{ source: data.sources[0].id, quote: data.sources[0].text.slice(0, 25) }];
  return { overview: "基于本次资料检查可执行性，建议人工复核流程细节。", findings: [{ title: "补充处理责任", severity: "medium", explanation: "复核流程可以进一步说明执行责任。", recommendation: "核对后补充处理责任人与完成条件。", evidence }], tags: { values: ["数据分级", "访问控制"], rationale: "围绕资料所述分级与授权主题。", evidence }, summary: { text: "资料说明数据分级和访问控制要求。", evidence } };
}
async function fixture(run: (ctx: Context, login: (name: string) => Promise<{ cookie: string }>, dbPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-ai-governance-")), dbPath = join(dir, "db.sqlite");
  const ctx = await buildServer({ demo: true, dbPath, storage: dir, model: { apiKey: "test-placeholder", model: "test-model", baseUrl: "https://example.invalid/v1" } });
  ctx.model.complete = async (_s, input) => ({ text: JSON.stringify(answer(input)), usage: {} });
  const login = async (name: string) => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } });
    assert.equal(r.statusCode, 200); return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
  };
  try { await run(ctx, login, dbPath); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
const analyze = (ctx: Context, headers: { cookie: string }, url = path) => ctx.app.inject({ method: "POST", url, headers, payload: { documentVersion: 1, policyVersion: 1 } });

test("AI 研判校验岗位、企业、正文权限和隔离状态，拒绝时不调用模型", async () => fixture(async (ctx, login) => {
  let calls = 0; ctx.model.complete = async () => { calls++; throw new Error("must not call"); };
  assert.equal((await ctx.app.inject({ url: path })).statusCode, 401);
  for (const name of ["engineer", "auditor", "hr", "external"]) assert.equal((await analyze(ctx, await login(name))).statusCode, 404);
  const admin = await login("steward");
  for (const id of ["doc-7", "doc-12"]) {
    const doc = ctx.store.doc("mengine-demo", id)!;
    if (id === "doc-12") { doc.status = "quarantined"; ctx.store.saveDoc(doc); }
    const url = `/api/governance/${id}/analysis`;
    assert.equal((await ctx.app.inject({ url, headers: admin })).json().state, "restricted");
    assert.equal((await analyze(ctx, admin, url)).statusCode, 403);
  }
  assert.equal(calls, 0);
}));

test("发送前对所有岗位脱敏个人信息和常见凭证，明确限制分析范围", async () => fixture(async (ctx, login) => {
  const doc = ctx.store.doc("mengine-demo", "doc-2")!;
  const secrets = ["13800138000", "110101199001011234", "person@example.com", "sk-abcdefghijklmnopqrst", "pass123", "abcdefghijklmnopqrstuv"];
  doc.content = `企业数据治理需要核对责任。 ${secrets.slice(0, 4).join(" ")} password=pass123 Bearer abcdefghijklmnopqrstuv\n` + "资料内容用于流程检查。".repeat(3000);
  doc.title = "person@example.com"; ctx.store.saveDoc(doc);
  const prepared = governanceInput(doc); assert.equal(prepared.coverage.analyzedCharacters, 18000); assert.equal(prepared.coverage.truncated, true);
  ctx.model.complete = async (_s, input) => { for (const secret of secrets) assert.ok(!input.includes(secret)); assert.ok(input.includes("已脱敏")); return { text: JSON.stringify(answer(input)), usage: {} }; };
  const result = await analyze(ctx, await login("steward")); assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().report.coverage.truncated, true);
  for (const secret of secrets) assert.ok(!result.body.includes(secret));
}));

test("拒绝伪造引用、未知动作、超长内容和恶意结构，不把模型结果当命令", () => {
  const sources = [{ id: "P1", text: "企业数据需要在授权范围内流转，资料内容供治理检查。" }], valid = answer(JSON.stringify({ sources }));
  assert.ok(validateAssessment(JSON.stringify(valid), sources));
  const variants = [ { ...valid, grants: [] }, { ...valid, summary: { ...valid.summary, evidence: [{ source: "P999", quote: "不在原文中的内容" }] } }, { ...valid, summary: { ...valid.summary, evidence: [{ source: "P1", quote: "不在原文中的内容" }] } }, { ...valid, tags: { ...valid.tags, values: ["x".repeat(31)] } }, { ...valid, summary: { text: "sk-abcdefghijklmnopqrst", evidence: valid.summary.evidence } } ];
  for (const item of variants) assert.throws(() => validateAssessment(JSON.stringify(item), sources));
  assert.throws(() => validateAssessment("not-json", sources));
});

test("研判持久化并按用户隔离，不修改规则分数、状态、权限或正文", async () => fixture(async (ctx, login, dbPath) => {
  const before = ctx.store.doc("mengine-demo", "doc-2")!, headers = await login("steward");
  const res = await analyze(ctx, headers); assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(ctx.store.doc("mengine-demo", "doc-2"), before);
  assert.equal(res.json().report.fingerprint, undefined); assert.equal(res.json().report.tenantId, undefined);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().report.id, res.json().report.id);
  assert.equal((await ctx.app.inject({ url: path, headers: await login("admin") })).json().report, null);
  const persisted = new Store(dbPath);
  assert.equal((persisted.db.prepare("SELECT COUNT(*) AS n FROM governance_ai_reports").get() as { n: number }).n, 1);
  assert.equal(persisted.db.pragma("user_version", { simple: true }), 10); persisted.close();
  assert.ok(ctx.store.auditValid("mengine-demo"));
}));

test("研判中正文、元数据或权限变化使结果作废；退出登录后不保存报告", async () => {
  for (const mutation of ["content", "quality", "permissions", "session"]) await fixture(async (ctx, login) => {
    const headers = await login("steward");
    ctx.model.complete = async (_s, input) => {
      if (mutation === "session") ctx.store.saveUser({ ...ctx.store.user("u-steward")!, active: false });
      else { const doc = ctx.store.doc("mengine-demo", "doc-2")!; if (mutation === "content") doc.content += "新的正文"; else if (mutation === "quality") doc.quality = 84; else { doc.audience = "private"; doc.ownerId = "u-admin"; doc.grants = []; } ctx.store.saveDoc(doc); }
      return { text: JSON.stringify(answer(input)), usage: {} };
    };
    const result = await analyze(ctx, headers); assert.ok([401, 403, 409].includes(result.statusCode), result.body);
    assert.equal((ctx.store.db.prepare("SELECT COUNT(*) AS n FROM governance_ai_reports").get() as { n: number }).n, 0);
  });
});

test("旧报告在资料变化后隐藏，权限撤回后禁止重用报告生成方案", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), report = (await analyze(ctx, headers)).json().report;
  const doc = ctx.store.doc("mengine-demo", "doc-2")!; doc.tags.push("新标签"); ctx.store.saveDoc(doc);
  const stale = (await ctx.app.inject({ url: path, headers })).json(); assert.equal(stale.state, "stale"); assert.equal(stale.report, null);
  assert.equal((await ctx.app.inject({ method: "POST", url: `${path}/${report.id}/proposals`, headers, payload: { action: "organize" } })).statusCode, 409);
  doc.status = "quarantined"; ctx.store.saveDoc(doc);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().state, "restricted");
  assert.equal((await ctx.app.inject({ method: "POST", url: `${path}/${report.id}/proposals`, headers, payload: { action: "organize" } })).statusCode, 403);
}));

test("标签建议复用现有审批，提交幂等且不直接写文档，审批后旧报告失效", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), before = ctx.store.doc("mengine-demo", "doc-2")!, report = (await analyze(ctx, headers)).json().report;
  const send = () => ctx.app.inject({ method: "POST", url: `${path}/${report.id}/proposals`, headers, payload: { action: "organize" } });
  const first = await send(); assert.equal(first.statusCode, 200, first.body); const p = first.json().proposal;
  assert.equal(p.status, "pending"); assert.equal((await send()).json().proposal.id, p.id);
  assert.deepEqual(ctx.store.doc("mengine-demo", "doc-2"), before);
  const apply = await ctx.app.inject({ method: "POST", url: `/api/proposals/${p.id}/resolve`, headers, payload: { decision: "approve" } });
  assert.equal(apply.statusCode, 200, apply.body);
  const after = ctx.store.doc("mengine-demo", "doc-2")!;
  assert.deepEqual(after.tags, report.tags.values); assert.equal(after.version, 2); assert.equal(after.quality, before.quality); assert.deepEqual(after.grants, before.grants); assert.equal(after.classification, before.classification);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().state, "stale");
  assert.ok(ctx.store.auditValid("mengine-demo"));
}));

test("摘要提案只采用已验证服务端建议，拒绝伪造 patch、权限动作和他人报告", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), report = (await analyze(ctx, headers)).json().report;
  const url = `${path}/${report.id}/proposals`;
  for (const payload of [{ action: "permissions" }, { action: "summary", patch: { summary: "tamper" } }]) assert.equal((await ctx.app.inject({ method: "POST", url, headers, payload })).statusCode, 400);
  const adminDoc = ctx.store.doc("mengine-demo", "doc-2")!; adminDoc.grants.push({ subjectType: "user", subjectId: "u-admin", level: "edit" }); ctx.store.saveDoc(adminDoc);
  assert.equal((await ctx.app.inject({ method: "POST", url, headers: await login("admin"), payload: { action: "summary" } })).statusCode, 404);
  const fresh = (await analyze(ctx, headers)).json().report;
  const proposal = (await ctx.app.inject({ method: "POST", url: `${path}/${fresh.id}/proposals`, headers, payload: { action: "summary" } })).json().proposal;
  assert.deepEqual(proposal.patch, { summary: fresh.summary.text });
}));

test("管理与阅读权限不等于编辑权限，管理员只能研判不能越权提交", async () => fixture(async (ctx, login) => {
  const headers = await login("admin"), result = await analyze(ctx, headers); assert.equal(result.statusCode, 200);
  assert.equal(result.json().canPropose, false);
  assert.equal((await ctx.app.inject({ method: "POST", url: `${path}/${result.json().report.id}/proposals`, headers, payload: { action: "summary" } })).statusCode, 403);
}));

test("模型失败、结构无效与服务暂停不会伪造成功；失败后释放并发占用", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  ctx.model.complete = async () => { throw new Error("private provider details"); };
  const failure = await analyze(ctx, headers); assert.equal(failure.statusCode, 502); assert.ok(!failure.body.includes("private provider"));
  ctx.model.complete = async () => ({ text: "invalid", usage: {} }); assert.equal((await analyze(ctx, headers)).statusCode, 502);
  ctx.model.complete = async (_s, input) => ({ text: JSON.stringify(answer(input)), usage: {} }); assert.equal((await analyze(ctx, headers)).statusCode, 200);
  ctx.model.config.enabled = false; assert.equal((await analyze(ctx, headers)).statusCode, 503);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().available, false);
}));

test("同一用户不能并发研判，限流阻止重复模型消耗", async () => fixture(async (ctx, login) => {
  const headers = await login("admin"); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { started = r; });
  ctx.model.complete = async (_s, input) => { started(); await gate; return { text: JSON.stringify(answer(input)), usage: {} }; };
  const pending = analyze(ctx, headers).then(r => r);
  try {
    await Promise.race([entered, pending.then(r => { throw new Error(`请求在调用模型前结束：${r.statusCode}`); })]);
    assert.equal((await analyze(ctx, headers)).statusCode, 429);
  } finally { release(); }
  assert.equal((await pending).statusCode, 200);
  for (let i = 0; i < 4; i++) assert.equal((await analyze(ctx, headers)).statusCode, 200);
  assert.equal((await analyze(ctx, headers)).statusCode, 429);
  assert.equal((ctx.store.db.prepare("SELECT COUNT(*) AS n FROM governance_ai_reports").get() as { n: number }).n, 5);
}));
