import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
type Context = Awaited<ReturnType<typeof buildServer>>;
function learning(raw: string) {
  const input = JSON.parse(raw);
  return { articles: input.documents.map((d: { key: string }) => { const text = input.sources.find((s: { document: string }) => s.document === d.key).text; return { source: d.key, title: `知识分享 ${d.key}`, intro: "依据授权资料形成的知识分享。", content: `知识的处理应遵循原始资料要求。${text.slice(0, 160)}`, evidence: [{ quote: text.slice(0, 24) }] }; }) };
}
function graph(raw: string) {
  const input = JSON.parse(raw), selected = input.documents.slice(0, 3).map((d: { key: string }) => d.key);
  return { selected, relations: selected.length < 2 ? [] : [{ from: selected[0], to: selected[1], kind: "topic", reason: "两篇知识共同描述资料处理要求。", evidence: selected.slice(0, 2).map((key: string) => { const source = input.sources.find((s: { document: string }) => s.document === key); return { source: source.id, quote: source.text.slice(0, 24) }; }) }] };
}
async function fixture(run: (ctx: Context, login: (name: string) => Promise<{ cookie: string }>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "learned-wiki-"));
  const ctx = await buildServer({ demo: true, dbPath: join(dir, "wiki.db"), storage: dir, model: { apiKey: "test-placeholder", model: "test-model", baseUrl: "https://example.invalid/v1" } });
  ctx.model.complete = async (s, raw) => ({ text: JSON.stringify(s.includes('"articles"') ? learning(raw) : graph(raw)), usage: {} });
  const login = async (name: string) => { const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } }); return { cookie: String(r.headers["set-cookie"]).split(";")[0] }; };
  try { await run(ctx, login); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
const snapshot = async (ctx: Context, headers: { cookie: string }) => (await ctx.app.inject({ url: "/api/wiki/knowledge", headers })).json();
const learn = (ctx: Context, headers: { cookie: string }, retry = false) => ctx.app.inject({ method: "POST", url: "/api/wiki/learn", headers, payload: { retry } });
const buildGraph = (ctx: Context, headers: { cookie: string }) => ctx.app.inject({ method: "POST", url: "/api/wiki/auto-graph", headers });
test("Wiki 初始不展示原始资料，只有 AI 成功沉淀后产生独立知识，来源保持原状", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"), before = ctx.store.documents("mengine-demo");
  const initial = await snapshot(ctx, headers); assert.equal(initial.items.length, 0); assert.ok(initial.pending > 0); assert.equal(initial.graph, null);
  assert.equal((await ctx.app.inject({ url: "/api/wiki/knowledge" })).statusCode, 401);
  assert.equal((await buildGraph(ctx, headers)).statusCode, 409);
  const r = await learn(ctx, headers); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().learned, 1);
  const state = await snapshot(ctx, headers); assert.equal(state.items.length, 1); assert.ok(state.items.every((k: { id: string; sourceId: string; evidence: unknown[] }) => k.id !== k.sourceId && k.evidence.length));
  assert.deepEqual(ctx.store.documents("mengine-demo"), before);
  assert.equal((await snapshot(ctx, await login("external"))).items.length, 0);
}));
test("自动星图仅来自沉淀知识，系统候选与模型选择无需客户端传入范围，复用有效缓存", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); await learn(ctx, headers); await learn(ctx, headers);
  const response = await buildGraph(ctx, headers); assert.equal(response.statusCode, 200, response.body);
  const g = response.json(), state = await snapshot(ctx, headers); assert.equal(g.documents.length, 2); assert.equal(g.relations.length, 1);
  assert.ok(g.documents.every((d: { id: string }) => state.items.some((k: { id: string }) => k.id === d.id)));
  ctx.model.complete = async () => { throw new Error("cache should avoid model call"); };
  assert.equal((await buildGraph(ctx, headers)).json().id, g.id);
}));
test("来源变更、隔离或撤权立即隐藏知识及依赖星图，管理权限不授予正文", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); await learn(ctx, headers); await learn(ctx, headers); await buildGraph(ctx, headers);
  const state = await snapshot(ctx, headers), k = state.items[0], source = ctx.store.doc("mengine-demo", k.sourceId)!;
  source.status = "quarantined"; ctx.store.saveDoc(source);
  const hidden = await snapshot(ctx, headers); assert.ok(!hidden.items.some((x: { id: string }) => x.id === k.id)); assert.equal(hidden.graph, null);
  const admin = await snapshot(ctx, await login("admin")); assert.ok(!admin.items.some((x: { sourceId: string }) => x.sourceId === "doc-1"));
}));
test("学习途中撤权或来源改变不发布任何知识", async () => fixture(async (ctx, login) => {
  const headers = await login("steward");
  ctx.model.complete = async (_s, raw) => { const first = JSON.parse(raw).documents[0]; const d = ctx.store.documents("mengine-demo").find(d => d.title === first.title)!; d.content += "来源已修改"; ctx.store.saveDoc(d); return { text: JSON.stringify(learning(raw)), usage: {} }; };
  assert.equal((await learn(ctx, headers)).statusCode, 409); assert.equal((await snapshot(ctx, headers)).items.length, 0);
}));
test("模型失败记录待重试且不伪造知识，显式重试才重新学习失败版本", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); ctx.model.complete = async () => ({ text: '{"articles":[]}', usage: {} });
  assert.equal((await learn(ctx, headers)).statusCode, 502);
  const state = await snapshot(ctx, headers); assert.equal(state.failed, 1); assert.equal(state.items.length, 0);
  ctx.model.complete = async (_s, raw) => ({ text: JSON.stringify(learning(raw)), usage: {} });
  assert.equal((await learn(ctx, headers, true)).statusCode, 200); assert.equal((await snapshot(ctx, headers)).failed, 0);
}));
test("自动星图拒绝越界范围与单边引用，允许无关联节点", async () => fixture(async (ctx, login) => {
  const headers = await login("steward"); await learn(ctx, headers); await learn(ctx, headers);
  for (const kind of ["foreign", "one-sided", "empty"]) {
    ctx.model.complete = async (_s, raw) => { const g = graph(raw); if (kind === "foreign") g.selected = ["unknown"]; if (kind === "one-sided") g.relations[0].evidence.pop(); if (kind === "empty") g.relations = []; return { text: JSON.stringify(g), usage: {} }; };
    const r = await buildGraph(ctx, headers); assert.equal(r.statusCode, kind === "empty" ? 200 : 502, r.body);
  }
}));
