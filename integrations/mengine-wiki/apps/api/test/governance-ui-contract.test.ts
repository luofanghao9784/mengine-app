import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { metadata, scan } from "../src/domain.js";
import { governanceRules, governanceSummary, remediationBlockedReason, remediationChange, type GovernanceAsset } from "../../web/src/components/governance-model.js";

async function fixture(run: (ctx: Awaited<ReturnType<typeof buildServer>>, login: (name: string) => Promise<{ cookie: string }>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-governance-contract-"));
  const ctx = await buildServer({ demo: true, storage: dir });
  const login = async (name: string) => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD } });
    assert.equal(r.statusCode, 200);
    return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
  };
  try { await run(ctx, login); } finally { await ctx.app.close(); await rm(dir, { recursive: true, force: true }); }
}
test("治理显示的六项规则与后端扫描结果一致，邮箱不触发隔离", () => {
  const result = scan("13800138000 110101199001011234 test@example.com", [], "2020-01-01");
  assert.deepEqual(governanceRules.map(r => r.issue), result.issues);
  assert.equal(result.quality, 20); assert.equal(result.sensitive, true);
  assert.equal(scan("only@example.com", ["测试"], "2099-01-01").sensitive, false);
});
test("治理快照不含受限正文，UI 禁用理由与真实拒绝行为一致", async () => fixture(async ({ app, store }, login) => {
  const limited = store.user("u-steward")!; limited.duties = { governance: [{ type: "tenant", id: "mengine-demo" }] }; limited.clearance = 2; store.saveUser(limited);
  const headers = await login("steward"), user = store.user("u-steward")!;
  const snapshot = (await app.inject({ url: "/api/governance", headers })).json();
  for (const d of snapshot.items) { assert.equal(d.content, undefined); assert.equal(d.originalPath, undefined); if (!d.canRead) assert.equal(d.summary, ""); }
  const high = snapshot.items.find((d: GovernanceAsset) => d.classification > user.clearance)!;
  assert.ok(high); assert.notEqual(remediationBlockedReason(high, user), "");
  assert.equal((await app.inject({ method: "POST", url: `/api/governance/${high.id}/remediate`, headers })).statusCode, 403);
  const auditor = await login("auditor");
  assert.equal((await app.inject({ url: "/api/governance", headers: auditor })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/governance/scan", headers: auditor })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/governance", headers: await login("engineer") })).statusCode, 403);
}));
test("治理复检保留原文、标签、密级和 ACL，不将仍有敏感信息的资料发布", async () => fixture(async ({ app, store }, login) => {
  const headers = await login("admin"), user = store.user("u-admin")!;
  const doc = store.documents(user.tenantId).find(d => d.status === "quarantined")!;
  const before = metadata(doc, user), audience = doc.audience, grants = doc.grants, classification = doc.classification;
  assert.equal(remediationBlockedReason(before, user), "");
  const response = await app.inject({ method: "POST", url: `/api/governance/${doc.id}/remediate`, headers });
  assert.equal(response.statusCode, 200);
  const after = response.json();
  assert.equal(after.status, "quarantined"); assert.equal(after.version, before.version);
  assert.equal(store.doc(user.tenantId,doc.id)!.content,doc.content);
  assert.equal(after.classification, classification); assert.equal(after.audience, audience); assert.deepEqual(after.grants, grants);
  assert.equal(after.reviewAt, before.reviewAt);
  assert.deepEqual(after.tags, before.tags); assert.equal(after.content, undefined);
  const delta = remediationChange(before, after);
  assert.ok(delta.remaining.includes("检测到手机号")); assert.ok(delta.remaining.includes("内容信息量偏低"));
  const refreshed = (await app.inject({ url: "/api/governance", headers })).json();
  assert.deepEqual(refreshed.items.find((d: GovernanceAsset) => d.id === after.id), after);
  assert.ok(refreshed.auditValid); assert.equal(store.flowEvents(user.tenantId, doc.id)[0].event, "rescanned");
}));
test("重新扫描仅处理已发布范围，隔离和未完成资料不被误报为已扫描", async () => fixture(async ({ app, store }, login) => {
  const headers = await login("admin");
  const before = (await app.inject({ url: "/api/governance", headers })).json();
  const candidate = store.doc("mengine-demo", "doc-1")!;
  candidate.status = "processing"; candidate.quality = 0; store.saveDoc(candidate);
  const res = await app.inject({ method: "POST", url: "/api/governance/scan", headers });
  assert.equal(res.statusCode, 200); assert.equal(res.json().count, before.items.filter((d: GovernanceAsset) => d.status === "ready").length - 1);
  assert.equal(store.doc("mengine-demo", candidate.id)!.status, "processing");
  const after = (await app.inject({ url: "/api/governance", headers })).json();
  assert.equal(governanceSummary(after.items, after.scanAt).assessed, after.items.length - 1);
}));

test("管理员有效 L3，旧资料中的低密级字段不应导致界面和接口误拒绝", () => fixture(async ({app,store},login) => {
 const headers=await login("admin"), user={...store.user("u-admin")!,clearance:0};
 // Simulate a persisted pre-migration account without normalizing it through saveUser.
 store.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user),user.id);
 const d=store.doc(user.tenantId,"doc-7")!;
 assert.equal(remediationBlockedReason(metadata(d,user),user),"");
 assert.equal((await app.inject({method:"POST",url:`/api/governance/${d.id}/remediate`,headers})).statusCode,200);
}));
