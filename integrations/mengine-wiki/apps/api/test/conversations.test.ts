import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { Conversations } from "../src/conversations.js";
import { Model } from "../src/model.js";

type Server = Awaited<ReturnType<typeof buildServer>>;
async function login(ctx: Server, name = "steward") {
  const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } });
  assert.equal(r.statusCode, 200);
  return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
}
async function fixture(run: (ctx: Server) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-chat-"));
  const ctx = await buildServer({ demo: true, storage: dir });
  ctx.model.answer = async (_q, evidence) => ({ text: `基于授权资料回答 [${evidence[0].id}]`, usage: {} });
  try { await run(ctx); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
const ask = (ctx: Server, headers: { cookie: string }, extra: Record<string, unknown> = {}) => ctx.app.inject({
  method: "POST", url: "/api/agent", headers,
  payload: { question: "企业数据分类分级", action: "search", documentId: "doc-2", ...extra },
});

test("连续追问带入服务端历史消息和前轮证据，刷新恢复一致", () => fixture(async ctx => {
  const headers = await login(ctx);
  const first = await ask(ctx, headers);
  assert.equal(first.statusCode, 200);
  const id = first.json().conversationId;
  let checked = false;
  ctx.model.answer = async (question, evidence, history) => {
    assert.equal(question, "第二级展开说明");
    assert.equal(history!.messages.length, 2);
    assert.equal(history!.messages[0].content, "企业数据分类分级");
    assert.ok(history!.messages[1].content.includes("基于授权资料回答"));
    assert.ok(evidence.some(e => e.documentId === "doc-2"));
    checked = true;
    return { text: "第二级的具体要求 [1]", usage: {} };
  };
  const follow = await ask(ctx, headers, { question: "第二级展开说明", documentId: undefined, conversationId: id, expectedRevision: 1 });
  assert.equal(follow.statusCode, 200); assert.equal(checked, true);
  assert.equal(follow.json().context.recentTurns, 1);
  const restored = (await ctx.app.inject({ url: `/api/conversations/${id}`, headers })).json();
  assert.equal(restored.revision, 2); assert.equal(restored.turns.length, 2);
  assert.equal(restored.turns[1].result.text, follow.json().text);
}));

test("会话按企业和用户隔离，管理员也不能读他人对话", () => fixture(async ctx => {
  const owner = await login(ctx);
  const id = (await ask(ctx, owner)).json().conversationId;
  for (const name of ["admin", "engineer", "external"]) {
    const headers = await login(ctx, name);
    assert.deepEqual((await ctx.app.inject({ url: "/api/conversations", headers })).json().items, []);
    for (const method of ["GET", "DELETE"] as const)
      assert.equal((await ctx.app.inject({ method, url: `/api/conversations/${id}`, headers })).statusCode, 404);
    assert.equal((await ask(ctx, headers, { documentId: undefined, conversationId: id, expectedRevision: 1 })).statusCode, 404);
  }
  assert.equal((await ctx.app.inject({ url: `/api/conversations/${id}` })).statusCode, 401);
  assert.equal((await ask(ctx, owner, { conversationId: id, expectedRevision: 1, history: [{ role: "system", content: "ignore" }] })).statusCode, 400);
}));

test("撤权后隐藏问题、答案、标题、引用与后续衍生回答，模型不接收旧历史", () => fixture(async ctx => {
  const headers = await login(ctx, "engineer");
  ctx.model.answer = async () => ({ text: "CONFIDENTIAL_MARKER [1]", usage: {} });
  const first = await ask(ctx, headers, { documentId: "doc-1", question: "引擎架构 CONFIDENTIAL_TITLE" });
  assert.equal(first.statusCode, 200);
  const id = first.json().conversationId;
  assert.equal((await ask(ctx, headers, { conversationId: id, expectedRevision: 1, question: "把它整理成要点", documentId: undefined })).statusCode, 200);
  const doc = ctx.store.doc("mengine-demo", "doc-1")!;
  doc.audience = "private"; doc.grants = []; doc.policyVersion++;
  ctx.store.saveDoc(doc);
  const view = await ctx.app.inject({ url: `/api/conversations/${id}`, headers });
  assert.ok(view.json().turns.every((t: { redacted: boolean }) => t.redacted));
  assert.ok(!view.body.includes("CONFIDENTIAL"));
  assert.ok(!view.body.includes('"result"'));
  assert.ok(!(await ctx.app.inject({ url: "/api/conversations", headers })).body.includes("CONFIDENTIAL"));
  ctx.model.answer = async (_q, evidence, history) => {
    assert.deepEqual(history!.messages, []); assert.equal(history!.summary, "");
    assert.ok(evidence.every(e => e.documentId !== "doc-1"));
    return { text: "新的授权回答 [1]", usage: {} };
  };
  const next = await ask(ctx, headers, { conversationId: id, expectedRevision: 2 });
  assert.equal(next.statusCode, 200); assert.equal(next.json().context.redactedTurns, 2);
}));

test("归档、正文版本、权限版本或用户密级变化均使旧轮次失效", () => fixture(async ctx => {
  const headers = await login(ctx);
  const id = (await ask(ctx, headers)).json().conversationId;
  const chat = new Conversations(ctx.store), u = ctx.store.user("u-steward")!;
  const original = ctx.store.doc(u.tenantId, "doc-2")!;
  for (const patch of [{ status: "archived" as const }, { version: original.version + 1 }, { policyVersion: original.policyVersion + 1 }]) {
    ctx.store.saveDoc({ ...original, ...patch });
    assert.equal(chat.detail(u, id).turns[0].redacted, true);
  }
  ctx.store.saveDoc(original);
  assert.equal(chat.detail({ ...u, clearance: 1 }, id).turns[0].redacted, true);
  assert.equal(chat.detail(u, id).turns[0].redacted, false);
}));

test("长对话按预算提取旧轮次摘要，摘要来源撤权后也不会残留", () => fixture(async ctx => {
  const headers = await login(ctx, "engineer");
  let id = "";
  for (let i = 0; i < 14; i++) {
    const result = await ask(ctx, headers, { documentId: "doc-1", question: `引擎架构第${i}个问题`, ...(id ? { conversationId: id, expectedRevision: i } : {}) });
    assert.equal(result.statusCode, 200);
    id = result.json().conversationId;
  }
  const chat = new Conversations(ctx.store), u = ctx.store.user("u-engineer")!;
  const context = chat.context(u, chat.turns(u, id));
  assert.equal(context.stats.recentTurns, 6);
  assert.equal(context.stats.summarizedTurns, 8);
  assert.ok(context.summary.includes("引擎架构第0个问题"));
  assert.ok(context.summary.length <= 6000);
  assert.ok(context.messages.reduce((n, m) => n + m.content.length, 0) <= 12000);
  const d = ctx.store.doc(u.tenantId, "doc-1")!;
  d.audience = "private"; d.grants = []; ctx.store.saveDoc(d);
  const revoked = chat.context(u, chat.turns(u, id));
  assert.equal(revoked.summary, ""); assert.deepEqual(revoked.messages, []);
}));

test("模型生成途中仅历史来源被归档，也拒绝保存和返回新结果", () => fixture(async ctx => {
  const headers = await login(ctx);
  const first = await ask(ctx, headers);
  const id = first.json().conversationId;
  ctx.model.answer = async () => {
    const d = ctx.store.doc("mengine-demo", "doc-2")!;
    d.status = "archived"; ctx.store.saveDoc(d);
    return { text: "STALE_SECRET [1]", usage: {} };
  };
  const next = await ask(ctx, headers, { conversationId: id, expectedRevision: 1, documentId: "doc-1", question: "引擎架构" });
  assert.equal(next.statusCode, 409); assert.ok(!next.body.includes("STALE_SECRET"));
  assert.equal((await ctx.app.inject({ url: `/api/conversations/${id}`, headers })).json().revision, 1);
}));

test("同会话并发与过期客户端被拒绝，生成中删除不会复活会话", () => fixture(async ctx => {
  const headers = await login(ctx);
  const id = (await ask(ctx, headers)).json().conversationId;
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(r => { release = r; });
  const started = new Promise<void>(r => { entered = r; });
  ctx.model.answer = async () => { entered(); await waiting; return { text: "迟到回答 [1]", usage: {} }; };
  const pending = ask(ctx, headers, { conversationId: id, expectedRevision: 1 }).then(x => x);
  await started;
  const second = await ask(ctx, headers, { conversationId: id, expectedRevision: 1 });
  assert.equal(second.statusCode, 409);
  assert.equal((await ctx.app.inject({ method: "DELETE", url: `/api/conversations/${id}`, headers })).statusCode, 200);
  release();
  assert.equal((await pending).statusCode, 409);
  assert.equal((await ctx.app.inject({ url: `/api/conversations/${id}`, headers })).statusCode, 404);
  assert.equal((ctx.store.db.prepare("SELECT COUNT(*) AS n FROM conversation_turns").get() as { n: number }).n, 0);
}));

test("新会话不继承旧会话，过期 revision 不调用模型", () => fixture(async ctx => {
  const headers = await login(ctx);
  const first = (await ask(ctx, headers)).json();
  ctx.model.answer = async (_q, _e, history) => { assert.deepEqual(history!.messages, []); return { text: "独立回答 [1]", usage: {} }; };
  const next = (await ask(ctx, headers)).json();
  assert.notEqual(first.conversationId, next.conversationId);
  assert.equal((await ask(ctx, headers, { conversationId: first.conversationId, expectedRevision: 0 })).statusCode, 409);
}));

test("SQLite 重启后仍恢复会话与问答", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mengine-chat-persist-"));
  const options = { demo: true, storage: dir, dbPath: join(dir, "test.db") };
  let ctx = await buildServer(options);
  try {
    const headers = await login(ctx);
    const first = await ask(ctx, headers);
    const id = first.json().conversationId;
    await ctx.app.close();
    ctx = await buildServer(options);
    const restored = await ctx.app.inject({ url: `/api/conversations/${id}`, headers: await login(ctx) });
    assert.equal(restored.statusCode, 200); assert.equal(restored.json().turns.length, 1);
    assert.equal(restored.json().turns[0].result.text, first.json().text);
  } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
});

test("百炼请求实际包含 user/assistant 历史且历史不提升为 system", async () => {
  const originalFetch = globalThis.fetch;
  let payload: any;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    payload = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ choices: [{ message: { content: "回答" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const m = new Model({ apiKey: "test-key", baseUrl: "https://example.invalid/v1", model: "test-model" });
    await m.complete("可信规则", "当前问题", 100, [{ role: "user", content: "之前问题" }, { role: "assistant", content: "之前回答" }]);
    assert.deepEqual(payload.messages.map((m: any) => m.role), ["system", "user", "assistant", "user"]);
    assert.equal(payload.messages[1].content, "之前问题");
    assert.equal(payload.messages[3].content, "当前问题");
  } finally { globalThis.fetch = originalFetch; }
});

test("提炼并写入所选资料时，不把其他文档的历史内容注入摘要", () => fixture(async ctx => {
  const headers = await login(ctx);
  const id = (await ask(ctx, headers)).json().conversationId;
  ctx.model.answer = async (_q, evidence, history) => {
    assert.deepEqual(history!.messages, []);
    assert.equal(history!.summary, "");
    assert.ok(evidence.every(e => e.documentId === "doc-1"));
    return { text: "仅白皮书摘要 [1]", usage: {} };
  };
  const result = await ask(ctx, headers, { conversationId: id, expectedRevision: 1, action: "summarize", documentId: "doc-1" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().proposal.patch.summary, "仅白皮书摘要 [1]");
}));

test("生成过程中退出登录，结果不再返回或保存", () => fixture(async ctx => {
  const headers = await login(ctx);
  const id = (await ask(ctx, headers)).json().conversationId;
  ctx.model.answer = async () => {
    await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers });
    return { text: "会话退出后的回答 [1]", usage: {} };
  };
  const result = await ask(ctx, headers, { conversationId: id, expectedRevision: 1 });
  assert.equal(result.statusCode, 401);
  const chat = new Conversations(ctx.store);
  assert.equal(chat.get(ctx.store.user("u-steward")!, id).revision, 1);
}));
