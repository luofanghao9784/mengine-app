import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import {
  canRead,
  canEdit,
  retrieve,
  visibleText,
  type Doc,
} from "../src/domain.js";
async function fixture(
  run: (
    ctx: Awaited<ReturnType<typeof buildServer>>,
    login: (name: string) => Promise<{ cookie: string }>,
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "mengine-test-"));
  const ctx = await buildServer({ demo: true, storage: dir });
  const login = async (name: string) => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: `${name}@mengine.demo`, password: DEMO_PASSWORD },
    });
    assert.equal(r.statusCode, 200);
    return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
  };
  try {
    await run(ctx, login);
  } finally {
    await ctx.app.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test("未登录请求和伪造身份头不能读取任何企业资料", async () =>
  fixture(async ({ app }) => {
    for (const url of [
      "/api/documents",
      "/api/overview",
      "/api/members",
      "/api/audit",
    ])
      assert.equal(
        (
          await app.inject({
            url,
            headers: { "x-user-id": "u-admin", "x-tenant-id": "mengine-demo" },
          })
        ).statusCode,
        401,
      );
  }));
test("企业隔离贯穿列表、正文、Agent 和管理", async () =>
  fixture(async ({ app }, login) => {
    const headers = await login("external");
    assert.equal(
      (await app.inject({ url: "/api/documents", headers })).json().items
        .length,
      0,
    );
    for (const url of ["/api/documents/doc-1", "/api/documents/doc-7"])
      assert.equal((await app.inject({ url, headers })).statusCode, 404);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/agent",
          headers,
          payload: {
            question: "提炼",
            action: "summarize",
            documentId: "doc-1",
          },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/documents/doc-1/archive",
          headers,
        })
      ).statusCode,
      404,
    );
  }));
test("企业管理员可读取本企业受限正文与权限配置，仍受企业与发布边界约束", async () =>
  fixture(async ({ app, store }, login) => {
    const headers = await login("admin");
    const managed = (
      await app.inject({ url: "/api/documents?mode=manage", headers })
    ).json().items;
    const secret = managed.find((d: Doc) => d.id === "doc-7");
    assert.equal(secret.canManage, true);
    assert.equal(secret.canRead, true);
    assert.ok(secret.summary);
    assert.equal(secret.content, undefined);
    assert.equal(
      (await app.inject({ url: "/api/documents/doc-7", headers })).statusCode,
      200,
    );
    const admin = store.user("u-admin")!, doc = store.doc(admin.tenantId,"doc-7")!;
    assert.equal(canRead({...admin,active:false},doc),false);
    assert.equal(canRead({...admin,tenantId:"another-enterprise"},doc),false);
    for(const status of ["quarantined","archived","processing","failed"] as const) assert.equal(canRead(admin,{...doc,status}),false);
    assert.equal(canEdit(admin,doc),false); // Read-all does not grant arbitrary write rights.
  }));
test("岗位、部门、显式授权与密级同时生效", async () =>
  fixture(async ({ store }) => {
    const user = store.user("u-engineer")!;
    const doc = store.doc(user.tenantId, "doc-7")!;
    assert.equal(canRead(user, doc), false);
    doc.grants = [{ subjectType: "role", subjectId: "member", level: "read" }];
    assert.equal(canRead(user, doc), false);
    doc.classification = 1;
    assert.equal(canRead(user, doc), true);
    assert.equal(canEdit(user, doc), false);
    doc.grants[0].level = "edit";
    assert.equal(canEdit(user, doc), true);
  }));
test("成员撤权会撤销已有会话", async () =>
  fixture(async ({ app }, login) => {
    const member = await login("engineer"),
      admin = await login("admin");
    assert.equal(
      (await app.inject({ url: "/api/me", headers: member })).statusCode,
      200,
    );
    const changed = await app.inject({
      method: "PATCH",
      url: "/api/members/u-engineer",
      headers: admin,
      payload: {
        role: "member",
        clearance: 0,
        active: false,
        department: "技术研发",
      },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(
      (await app.inject({ url: "/api/me", headers: member })).statusCode,
      401,
    );
  }));
test("普通成员不能管理岗位、扫描、治理、访问审计", async () =>
  fixture(async ({ app }, login) => {
    const headers = await login("engineer");
    for (const url of ["/api/members", "/api/audit", "/api/governance"])
      assert.equal((await app.inject({ url, headers })).statusCode, 403);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/governance/scan",
          headers,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/governance/doc-10/remediate",
          headers,
        })
      ).statusCode,
      403,
    );
  }));
test("检索不能通过全量候选泄露人事资料", async () =>
  fixture(async ({ store }) => {
    const user = store.user("u-engineer")!;
    const hits = retrieve(
      user,
      store.documents(user.tenantId),
      "员工薪酬绩效核定方案",
    );
    assert.ok(hits.every((x) => x.documentId !== "doc-7"));
    assert.equal(
      visibleText(user, "联系方式 13800138000 test@example.com"),
      "联系方式 [手机号已脱敏] [邮箱已脱敏]",
    );
  }));
test("模型调用之前必须有资料阅读授权", async () =>
  fixture(async ({ app, model }, login) => {
    let calls = 0;
    model.answer = async () => {
      calls++;
      return { text: "测试 [1]", usage: {} };
    };
    const headers = await login("engineer");
    const result = await app.inject({
      method: "POST",
      url: "/api/agent",
      headers,
      payload: {
        question: "总结薪酬",
        action: "summarize",
        documentId: "doc-7",
      },
    });
    assert.equal(result.statusCode, 404);
    assert.equal(calls, 0);
  }));
test("模型生成期间权限变更，禁止返回旧证据", async () =>
  fixture(async ({ app, model, store }, login) => {
    const headers = await login("engineer");
    model.answer = async () => {
      const d = store.doc("mengine-demo", "doc-1")!;
      d.audience = "private";
      d.policyVersion++;
      store.saveDoc(d);
      return { text: "这是证据回答 [1]", usage: {} };
    };
    const result = await app.inject({
      method: "POST",
      url: "/api/agent",
      headers,
      payload: { question: "引擎架构", action: "search", documentId: "doc-1" },
    });
    assert.equal(result.statusCode, 409);
  }));
test("权限方案必须双人审批，并阻止普通成员执行", async () =>
  fixture(async ({ app, store }, login) => {
    const steward = await login("steward"),
      admin = await login("admin"),
      member = await login("engineer");
    const plan = await app.inject({
      method: "POST",
      url: "/api/proposals",
      headers: steward,
      payload: {
        documentId: "doc-1",
        action: "permissions",
        patch: {
          audience: "organization",
          grants: [{ subjectType: "role", subjectId: "member", level: "read" }],
        },
        reason: "跨部门架构协作",
      },
    });
    assert.equal(plan.statusCode, 200);
    const ownList=(await app.inject({url:"/api/proposals",headers:steward})).json().items;
    const otherList=(await app.inject({url:"/api/proposals",headers:admin})).json().items;
    assert.equal(ownList.find((p:any)=>p.id===plan.json().id).canApprove,false);
    assert.equal(ownList.find((p:any)=>p.id===plan.json().id).canReject,true);
    assert.equal(otherList.find((p:any)=>p.id===plan.json().id).canApprove,true);
    const url = `/api/proposals/${plan.json().id}/resolve`;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: member,
          payload: { decision: "approve" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: steward,
          payload: { decision: "approve" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: admin,
          payload: { decision: "approve" },
        })
      ).statusCode,
      200,
    );
    assert.equal(store.doc("mengine-demo", "doc-1")!.audience, "organization");
    assert.equal(store.doc("mengine-demo", "doc-1")!.policyVersion, 2);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: admin,
          payload: { decision: "approve" },
        })
      ).statusCode,
      409,
    );
  }));
test("旧版本方案不能覆盖更新后的文档", async () =>
  fixture(async ({ app }, login) => {
    const headers = await login("steward");
    const plan = (
      await app.inject({
        method: "POST",
        url: "/api/proposals",
        headers,
        payload: {
          documentId: "doc-1",
          action: "organize",
          patch: { tags: ["新标签"] },
          reason: "整理",
        },
      })
    ).json();
    await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-1",
      headers,
      payload: { title: "架构更新" },
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/proposals/${plan.id}/resolve`,
          headers,
          payload: { decision: "approve" },
        })
      ).statusCode,
      409,
    );
  }));
test("禁止通过方案修改 tenant、角色或跨企业授权成员", async () =>
  fixture(async ({ app }, login) => {
    const headers = await login("steward");
    for (const patch of [
      { role: "admin" },
      {
        grants: [
          { subjectType: "user", subjectId: "u-external", level: "read" },
        ],
      },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/proposals",
            headers,
            payload: {
              documentId: "doc-1",
              action: "permissions",
              patch,
              reason: "测试",
            },
          })
        ).statusCode,
        400,
      );
  }));
test("审批列表不会向没有内容授权的审计岗位泄露摘要方案", async () =>
  fixture(async ({ app }, login) => {
    const hr = await login("hr"),
      auditor = await login("auditor");
    const plan = await app.inject({
      method: "POST",
      url: "/api/proposals",
      headers: hr,
      payload: {
        documentId: "doc-7",
        action: "summary",
        patch: { summary: "绝密薪资方案摘要" },
        reason: "整理",
      },
    });
    assert.equal(plan.statusCode, 200);
    const list = await app.inject({ url: "/api/proposals", headers: auditor });
    assert.ok(!list.body.includes("绝密薪资"));
  }));
test("敏感资料隔离并可按权限脱敏复核", async () =>
  fixture(async ({ app, store }, login) => {
    const steward = await login("steward");
    assert.equal(
      (await app.inject({ url: "/api/documents/doc-10", headers: steward }))
        .statusCode,
      404,
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/governance/doc-10/remediate",
      headers: steward,
    });
    assert.equal(result.statusCode, 200);
    const d = store.doc("mengine-demo", "doc-10")!;
    assert.equal(d.status, "ready");
    assert.ok(!d.content.includes("13800138000"));
    assert.ok(d.content.includes("[手机号已脱敏]"));
    assert.equal(d.version, 2);
  }));
test("全文检索覆盖长文尾部，上传 SHA 幂等", async () =>
  fixture(async ({ app, processor, store }, login) => {
    const headers = await login("steward");
    const content =
      "普通业务说明。".repeat(1500) +
      "\n\nzephyrcode quartzmatrix cobaltvector";
    const boundary = "mengine-test";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tail.txt"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`,
    );
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    assert.equal(uploaded.statusCode, 201);
    assert.deepEqual(uploaded.json().document.uploadedBy, { id: "u-steward", name: "罗方豪" });
    const id = uploaded.json().document.id;
    await processor.close();
    const d = store.doc("mengine-demo", id)!;
    assert.equal(d.status, "ready");
    const evidence = retrieve(
      store.user("u-steward")!,
      [d],
      "zephyrcode quartzmatrix",
    );
    assert.ok(evidence.some((e) => e.snippet.includes("cobaltvector")));
    const repeated = await app.inject({
      method: "POST",
      url: "/api/documents",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    assert.equal(repeated.json().duplicate, true);
    assert.deepEqual(repeated.json().document.uploadedBy, d.uploadedBy);
    const forged = await app.inject({ method: "PATCH", url: `/api/documents/${id}`, headers, payload: { uploadedBy: { id: "u-admin", name: "伪造上传人" } } });
    assert.equal(forged.statusCode, 400);
    const edited = await app.inject({ method: "PATCH", url: `/api/documents/${id}`, headers, payload: { tags: ["更新标签"] } });
    assert.equal(edited.statusCode, 200);
    assert.deepEqual(edited.json().uploadedBy, { id: "u-steward", name: "罗方豪" });
  }));
test("处理中任务可在启动恢复，归档后退出检索", async () =>
  fixture(async ({ store, processor, app }, login) => {
    const d = store.doc("mengine-demo", "doc-1")!;
    d.originalPath = join(processor.root, "resume.txt");
    d.kind = "txt";
    d.status = "processing";
    await writeFile(
      d.originalPath,
      "恢复后的全文知识内容与可追溯来源信息。".repeat(8),
    );
    store.saveDoc(d);
    processor.resume();
    await processor.close();
    assert.equal(store.doc(d.tenantId, d.id)!.status, "ready");
    const headers = await login("steward");
    await app.inject({
      method: "POST",
      url: `/api/documents/${d.id}/archive`,
      headers,
    });
    assert.equal(
      (await app.inject({ url: `/api/documents/${d.id}`, headers })).statusCode,
      404,
    );
    assert.equal(
      retrieve(
        store.user("u-steward")!,
        [store.doc(d.tenantId, d.id)!],
        "恢复后的全文",
      ).length,
      0,
    );
  }));
test("跨站写入、类型错误与未知字段被拒绝", async () =>
  fixture(async ({ app }, login) => {
    const headers = await login("steward");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/governance/scan",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).statusCode,
      403,
    );
    for (const question of [42, { text: "test" }])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent",
            headers,
            payload: { question, action: "search", tenantId: "other" },
          })
        ).statusCode,
        400,
      );
  }));
test("审计链可校验且能检测篡改", async () =>
  fixture(async ({ store }, login) => {
    await login("steward");
    assert.equal(store.auditValid("mengine-demo"), true);
    store.db
      .prepare(
        "UPDATE audit SET data='tampered' WHERE seq=1 AND tenant_id='mengine-demo'",
      )
      .run();
    assert.equal(store.auditValid("mengine-demo"), false);
  }));
test("正式模式不提供演示账号，禁止生产演示配置", async () => {
  const { app } = await buildServer({ demo: false });
  try {
    const res = (await app.inject("/api/auth/demo")).json();
    assert.equal(res.enabled, false);
    assert.equal(res.password, undefined);
  } finally {
    await app.close();
  }
  await assert.rejects(
    () => buildServer({ demo: true, production: true }),
    /禁止/,
  );
});

test("Agent 权限调整只生成方案，双人复核后生效", async () =>
  fixture(async ({ app, store }, login) => {
    const author = await login("engineer");
    const admin = await login("admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/agent",
      headers: author,
      payload: {
        action: "permissions",
        question: "申请扩大协作范围",
        documentId: "doc-1",
        audience: "organization",
      },
    });
    assert.equal(res.statusCode, 200);
    const p = res.json().proposal;
    assert.equal(p.status, "pending");
    assert.equal(store.doc("mengine-demo", "doc-1")!.audience, "department");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/proposals/${p.id}/resolve`,
          headers: admin,
          payload: { decision: "approve" },
        })
      ).statusCode,
      200,
    );
    assert.equal(store.doc("mengine-demo", "doc-1")!.audience, "organization");
    assert.equal(store.doc("mengine-demo", "doc-1")!.classification, 1);
  }));

test("生成期间密级降低时不能返回旧的未脱敏文本", async () =>
  fixture(async ({ app, model, store }, login) => {
    const headers = await login("steward");
    model.answer = async () => {
      const user = store.user("u-steward")!;
      user.clearance = 1;
      store.saveUser(user);
      return { text: "旧证据 [1]", usage: {} };
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/agent",
      headers,
      payload: { action: "search", question: "引擎架构", documentId: "doc-1" },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().text, undefined);
  }));

test("生产启动拒绝含演示身份的数据库", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mengine-production-"));
  const dbPath = join(dir, "demo.db");
  try {
    const demo = await buildServer({ dbPath, demo: true, storage: dir });
    await demo.app.close();
    await assert.rejects(
      () => buildServer({ dbPath, production: true, storage: dir }),
      /演示账号/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
