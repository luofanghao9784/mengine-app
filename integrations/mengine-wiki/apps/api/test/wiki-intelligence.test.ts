import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { knowledgeInput, validateKnowledge, knowledgeLimiter } from "../src/wiki-intelligence.js";
import { knowledgePositions, scopeMatches, type KnowledgeReport } from "../../web/src/components/knowledge-intelligence.js";
const path = "/api/wiki/intelligence";
type Context = Awaited<ReturnType<typeof buildServer>>;
function answer(raw: string) {
  const input = JSON.parse(raw) as ReturnType<typeof knowledgeInput>;
  const cite = (key: string) => { const s = input.sources.find(s => s.document === key)!; return { source: s.id, quote: s.text.slice(0, 24) }; };
  return { nodes: input.documents.map(d => ({ document: d.key, summary: { text: "该资料介绍当前知识主题与处理边界。", evidence: [cite(d.key)] }, takeaways: [{ text: "处理流程需要遵循授权范围。", evidence: [cite(d.key)] }] })), synthesis: { text: "所选资料涉及知识处理与授权边界，需要结合原文理解。", evidence: input.documents.map(d => cite(d.key)) }, relations: input.documents.length > 1 ? [{ from: "K1", to: "K2", kind: "topic", reason: "两份资料均描述授权条件，可结合阅读。", evidence: [cite("K1"), cite("K2")] }] : [] };
}
async function fixture(run: (ctx: Context, login: (name: string) => Promise<{ cookie: string }>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-wiki-ai-"));
  const ctx = await buildServer({ demo: true, dbPath: join(dir, "wiki.db"), storage: dir, model: { apiKey: "test-placeholder", model: "test-model", baseUrl: "https://example.invalid/v1" } });
  ctx.model.complete = async (_s, input) => ({ text: JSON.stringify(answer(input)), usage: {} });
  const login = async (name: string) => { const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } }); assert.equal(r.statusCode, 200); return { cookie: String(r.headers["set-cookie"]).split(";")[0] }; };
  try { await run(ctx, login); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
const analyze = (ctx: Context, headers: { cookie: string }, ids = ["doc-1", "doc-2"]) => ctx.app.inject({ method: "POST", url: path, headers, payload: { documents: ids.map(id => ({ id, version: 1, policyVersion: 1 })) } });

test("知识分析对普通成员开放，但只读取已授权正文，企业与隔离边界不被绕过", async () => fixture(async (ctx, login) => {
  assert.equal((await ctx.app.inject({ url: path })).statusCode, 401);
  const member = await login("engineer"); assert.equal((await analyze(ctx, member, ["doc-1", "doc-3"])).statusCode, 200);
  let calls = 0; ctx.model.complete = async () => { calls++; throw new Error("unexpected"); };
  for (const [name, ids] of [["hr", ["doc-1"]], ["engineer", ["doc-7"]], ["external", ["doc-2"]], ["steward", ["doc-10"]]] as const) assert.equal((await analyze(ctx, await login(name), [...ids])).statusCode, 404);
  assert.equal(calls, 0);
  const visible = (await ctx.app.inject({ url: path, headers: member })).json().documents;
  assert.ok(visible.every((d: { id: string; content?: string }) => !["doc-7", "doc-10"].includes(d.id) && !d.content));
}));

test("一次分析生成要点、摘要、综合总结与有双边证据的关联，不改动资料", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), before = ctx.store.documents("mengine-demo");
  const result = await analyze(ctx, headers); assert.equal(result.statusCode, 200, result.body);
  const report = result.json().report;
  assert.equal(report.nodes.length, 2); assert.equal(report.relations.length, 1); assert.equal(report.synthesis.evidence.length, 2);
  assert.equal(report.userId, undefined); assert.equal(report.documents[0].fingerprint, undefined);
  assert.deepEqual(ctx.store.documents("mengine-demo"), before);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().report.id, report.id);
  assert.equal((await ctx.app.inject({ url: path, headers: await login("admin") })).json().report, null);
  assert.equal((await ctx.app.inject({ url: path, headers: await login("external") })).json().report, null);
  assert.ok(ctx.store.auditValid("mengine-demo"));
}));

test("关联必须引用两端，禁止自连接、重复边、外部节点或跨文档伪引用", async () => fixture(async ({ store }) => {
  const input = knowledgeInput([store.doc("mengine-demo", "doc-1")!, store.doc("mengine-demo", "doc-2")!]), raw = answer(JSON.stringify(input));
  assert.ok(validateKnowledge(JSON.stringify(raw), input));
  const mutate = (fn: (r: typeof raw) => void) => { const r = structuredClone(raw); fn(r); assert.throws(() => validateKnowledge(JSON.stringify(r), input)); };
  mutate(r => { r.relations[0].evidence.pop(); });
  mutate(r => { r.relations[0].to = "K1"; });
  mutate(r => { r.relations[0].to = "K9"; });
  mutate(r => { r.relations.push(r.relations[0]); });
  mutate(r => { r.nodes[0].summary.evidence = r.nodes[1].summary.evidence; });
  mutate(r => { r.nodes[0].summary.evidence[0].quote = "这句话并没有出现在任何原文之中"; });
  mutate(r => { r.synthesis.evidence.pop(); });
  mutate(r => { r.nodes[1].document = "K1"; });
  assert.throws(() => validateKnowledge(JSON.stringify({ ...raw, permissions: { audience: "organization" } }), input));
  assert.throws(() => validateKnowledge("not-json", input));
}));

test("发送前脱敏并限制每篇范围，输出不能还原常见凭证", async () => fixture(async (ctx, login) => {
  const d = ctx.store.doc("mengine-demo", "doc-1")!;
  const secret = "sk-abcdefghijklmnopqrst";
  d.content = `知识应在企业授权范围内使用。13800138000 person@example.com ${secret} password=sample-password\n` + "授权知识需要逐项检查。".repeat(1000); ctx.store.saveDoc(d);
  ctx.model.complete = async (_s, raw) => {
    for (const value of [secret, "13800138000", "person@example.com", "sample-password"]) assert.ok(!raw.includes(value));
    const input = JSON.parse(raw); assert.equal(input.documents[0].analyzedCharacters, 6000); assert.ok(input.documents[0].totalCharacters > 6000);
    return { text: JSON.stringify(answer(raw)), usage: {} };
  };
  const response = await analyze(ctx, await login("steward")); assert.equal(response.statusCode, 200, response.body);
  const input = knowledgeInput([d]), invalid = answer(JSON.stringify(input)); invalid.nodes[0].summary.text = secret;
  assert.throws(() => validateKnowledge(JSON.stringify(invalid), input));
}));

test("任一来源在生成中变化或被撤权，整份跨资料结果丢弃", async () => {
  for (const kind of ["text", "policy", "metadata", "session"]) await fixture(async (ctx, login) => {
    const headers = await login("steward");
    ctx.model.complete = async (_s, raw) => {
      if (kind === "session") ctx.store.saveUser({ ...ctx.store.user("u-steward")!, active: false });
      else { const d = ctx.store.doc("mengine-demo", "doc-2")!; if (kind === "text") d.content += "新内容"; if (kind === "metadata") d.tags = ["更新标签"]; if (kind === "policy") { d.audience = "private"; d.ownerId = "u-hr"; d.grants = []; } ctx.store.saveDoc(d); }
      return { text: JSON.stringify(answer(raw)), usage: {} };
    };
    const r = await analyze(ctx, headers); assert.ok([401, 404, 409].includes(r.statusCode), r.body);
    assert.equal((ctx.store.db.prepare("SELECT COUNT(*) AS n FROM wiki_intelligence_reports").get() as { n: number }).n, 0);
  });
});

test("资料更新后旧关联与综合总结整体隐藏，不能通过其他可读来源泄露", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); assert.equal((await analyze(ctx, headers)).statusCode, 200);
  const d = ctx.store.doc("mengine-demo", "doc-2")!; d.audience = "private"; d.ownerId = "u-hr"; d.grants = []; ctx.store.saveDoc(d);
  const snapshot = (await ctx.app.inject({ url: path, headers })).json(); assert.equal(snapshot.state, "stale"); assert.equal(snapshot.report, null);
  assert.ok(!snapshot.documents.some((x: { id: string }) => x.id === d.id));
}));

test("单篇与无关联场景均成立，不为动画补造关联", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  assert.deepEqual((await analyze(ctx, headers, ["doc-1"])).json().report.relations, []);
  ctx.model.complete = async (_s, raw) => { const a = answer(raw); a.relations = []; return { text: JSON.stringify(a), usage: {} }; };
  const r = await analyze(ctx, headers); assert.equal(r.statusCode, 200); assert.equal(r.json().report.nodes.length, 2); assert.deepEqual(r.json().report.relations, []);
}));

test("拒绝过多、重复、旧版本知识与客户端注入的模型结果", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); let calls = 0; ctx.model.complete = async () => { calls++; throw new Error("unexpected"); };
  assert.equal((await analyze(ctx, headers, [])).statusCode, 400);
  assert.equal((await analyze(ctx, headers, ["doc-1", "doc-1"])).statusCode, 400);
  assert.equal((await analyze(ctx, headers, Array.from({ length: 7 }, (_, i) => `doc-${i + 1}`))).statusCode, 400);
  const d = ctx.store.doc("mengine-demo", "doc-1")!; d.version++; ctx.store.saveDoc(d);
  assert.equal((await analyze(ctx, headers)).statusCode, 409);
  assert.equal((await ctx.app.inject({ method: "POST", url: path, headers, payload: { documents: [{ id: "doc-1", version: 2, policyVersion: 1 }], relations: [] } })).statusCode, 400);
  assert.equal(calls, 0);
}));

test("模型失败无伪报告，停用服务明确报错并释放进行中的任务", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); ctx.model.complete = async () => { throw new Error("provider secret"); };
  const failed = await analyze(ctx, headers); assert.equal(failed.statusCode, 502); assert.ok(!failed.body.includes("provider secret"));
  ctx.model.complete = async () => ({ text: "invalid", usage: {} }); assert.equal((await analyze(ctx, headers)).statusCode, 502);
  assert.equal((await ctx.app.inject({ url: path, headers })).json().report, null);
  ctx.model.complete = async (_s, raw) => ({ text: JSON.stringify(answer(raw)), usage: {} }); assert.equal((await analyze(ctx, headers)).statusCode, 200);
  ctx.model.config.enabled = false; assert.equal((await analyze(ctx, headers)).statusCode, 503);
}));

test("并发与频率限制真实模型消耗，按用户只保留三份报告", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { started = r; });
  ctx.model.complete = async (_s, raw) => { started(); await gate; return { text: JSON.stringify(answer(raw)), usage: {} }; };
  const first = analyze(ctx, headers).then(r => r); await entered;
  assert.equal((await analyze(ctx, headers)).statusCode, 429); release(); assert.equal((await first).statusCode, 200);
  for (let i = 0; i < 9; i++) assert.equal((await analyze(ctx, headers)).statusCode, 200);
  assert.equal((await analyze(ctx, headers)).statusCode, 429);
  assert.equal((ctx.store.db.prepare("SELECT COUNT(*) AS n FROM wiki_intelligence_reports").get() as { n: number }).n, 3);
}));

test("图谱一至六节点位置有限且无重叠，范围改变不展示旧分析", () => {
  for (let n = 1; n <= 6; n++) {
    const positions = knowledgePositions(n); assert.equal(positions.length, n);
    for (let i = 0; i < n; i++) { const p = positions[i]; assert.ok(p.x >= 79 && p.x <= 561 && p.y >= 29 && p.y <= 425); for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(p.x - positions[j].x, p.y - positions[j].y) > 100); }
  }
  const report = { documents: [{ id: "a" }, { id: "b" }] } as KnowledgeReport;
  assert.ok(scopeMatches(report, ["b", "a"])); assert.ok(!scopeMatches(report, ["a"])); assert.ok(!scopeMatches(report, ["a", "c"]));
});

function recommendationAnswer(raw: string) {
  const input = JSON.parse(raw), anchor = input.anchors[0], candidate = input.documents.find((d: { key: string }) => !input.anchors.includes(d.key)).key;
  return { recommendations: [{ document: candidate, anchor, reason: "两份资料可结合理解知识处理要求。", evidence: [anchor, candidate].map(key => { const s = input.sources.find((s: { document: string }) => s.document === key); return { source: s.id, quote: s.text.slice(0, 24) }; }) }] };
}
const recommend = (ctx: Context, headers: { cookie: string }, ids = ["doc-1"]) => ctx.app.inject({ method: "POST", url: "/api/wiki/recommendations", headers, payload: { ids } });
test("AI 推荐仅研判可读候选，返回双边依据且不修改资料", async () => fixture(async (ctx, login) => {
  const headers = await login("engineer"), before = ctx.store.documents("mengine-demo");
  ctx.model.complete = async (_s, raw) => {
    const input = JSON.parse(raw); assert.ok(input.sources.every((s: { text: string }) => s.text.length <= 1000));
    const denied = ctx.store.doc("mengine-demo", "doc-7")!; assert.ok(!raw.includes(denied.title));
    return { text: JSON.stringify(recommendationAnswer(raw)), usage: {} };
  };
  const r = await recommend(ctx, headers); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().recommendations.length, 1); assert.equal(r.json().recommendations[0].evidence.length, 2);
  assert.equal(r.json().scopeRevision, (await ctx.app.inject({ url: path, headers })).json().scopeRevision);
  assert.deepEqual(ctx.store.documents("mengine-demo"), before);
  assert.equal((await recommend(ctx, headers, ["doc-7"])).statusCode, 404);
  assert.equal((await recommend(ctx, await login("external"))).statusCode, 404);
  assert.equal((await recommend(ctx, headers, ["doc-1", "doc-1"])).statusCode, 400);
}));
test("AI 推荐拒绝伪引用、自推荐及无依据理由，空推荐为正常完成", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  for (const kind of ["citation", "self", "duplicate"]) {
    ctx.model.complete = async (_s, raw) => { const data = recommendationAnswer(raw); if (kind === "citation") data.recommendations[0].evidence.pop(); if (kind === "self") data.recommendations[0].document = data.recommendations[0].anchor; if (kind === "duplicate") data.recommendations.push(data.recommendations[0]); return { text: JSON.stringify(data), usage: {} }; };
    assert.equal((await recommend(ctx, headers)).statusCode, 502);
  }
  ctx.model.complete = async () => ({ text: '{"recommendations":[]}', usage: {} });
  const r = await recommend(ctx, headers); assert.equal(r.statusCode, 200); assert.deepEqual(r.json().recommendations, []);
}));
test("推荐途中候选正文或权限变化时丢弃整份结果", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  ctx.model.complete = async (_s, raw) => { const d = ctx.store.doc("mengine-demo", "doc-2")!; d.content += "资料已更新"; ctx.store.saveDoc(d); return { text: JSON.stringify(recommendationAnswer(raw)), usage: {} }; };
  assert.equal((await recommend(ctx, headers)).statusCode, 409);
}));


test("知识分析与推荐额度独立，冷却到期恢复，拒绝请求不延长窗口", () => {
  let now = 1000; const limit = knowledgeLimiter(() => now);
  for (let i = 0; i < 10; i++) limit("recommend", "tenant:user");
  limit("analyze", "tenant:user");
  assert.throws(() => limit("recommend", "tenant:user"), /60 秒/);
  now += 59000;
  assert.throws(() => limit("recommend", "tenant:user"), /1 秒/);
  limit("recommend", "tenant:other");
  now += 1000; assert.doesNotThrow(() => limit("recommend", "tenant:user"));
});
test("连续推荐用尽额度后仍可进行知识分析", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  ctx.model.complete = async (_s, raw) => ({ text: JSON.stringify(JSON.parse(raw).anchors ? { recommendations: [] } : answer(raw)), usage: {} });
  for (let i = 0; i < 10; i++) assert.equal((await recommend(ctx, headers)).statusCode, 200);
  const blocked = await recommend(ctx, headers); assert.equal(blocked.statusCode, 429); assert.match(blocked.json().message, /秒后重试/);
  assert.equal((await analyze(ctx, headers)).statusCode, 200);
}));

test("纯图谱模式只请求和保存关联，保留原文与权限校验", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), before = ctx.store.documents("mengine-demo");
  ctx.model.complete = async (instruction, raw) => { assert.ok(instruction.includes("不生成提炼")); return { text: JSON.stringify({ relations: answer(raw).relations }), usage: {} }; };
  const r = await ctx.app.inject({ method: "POST", url: path, headers, payload: { mode: "graph", documents: ["doc-1", "doc-2"].map(id => ({ id, version: 1, policyVersion: 1 })) } });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().report.relations.length, 1); assert.equal(r.json().report.nodes, undefined); assert.equal(r.json().report.synthesis, undefined);
  assert.deepEqual(ctx.store.documents("mengine-demo"), before);
}));
test("纯图谱拒绝单边依据、外部节点和自连接，无关联为有效结果", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  for (const kind of ["one-sided", "foreign", "self", "empty"]) {
    ctx.model.complete = async (_s, raw) => { const r = answer(raw).relations; if (kind === "one-sided") r[0].evidence.pop(); if (kind === "foreign") r[0].to = "K9"; if (kind === "self") r[0].to = "K1"; return { text: JSON.stringify({ relations: kind === "empty" ? [] : r }), usage: {} }; };
    const r = await ctx.app.inject({ method: "POST", url: path, headers, payload: { mode: "graph", documents: ["doc-1", "doc-2"].map(id => ({ id, version: 1, policyVersion: 1 })) } });
    assert.equal(r.statusCode, kind === "empty" ? 200 : 502, r.body);
  }
}));
