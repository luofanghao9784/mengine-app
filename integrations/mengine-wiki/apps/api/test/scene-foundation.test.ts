import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed.js";
import { canRead, canUseAI, retrieve } from "../src/domain.js";
import { queryDataset, listDatasets } from "../src/foundation-query.js";
const ROOT = "/api/scene-foundation";
async function fixture(
  fn: (
    c: Awaited<ReturnType<typeof buildServer>>,
    login: (name: string) => Promise<{ cookie: string }>,
  ) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "scene-foundation-"));
  const c = await buildServer({
    demo: true,
    storage: dir,
    sceneOrigin: "http://127.0.0.1:5173",
  });
  const login = async (name: string) => {
    const r = await c.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: name + "@mengine.demo", password: DEMO_PASSWORD },
    });
    assert.equal(r.statusCode, 200);
    return { cookie: String(r.headers["set-cookie"]).split(";")[0] };
  };
  try {
    await fn(c, login);
  } finally {
    await c.app.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test("scene requires identity, enforces roles and isolates tenant metadata", () =>
  fixture(async (c, login) => {
    assert.equal((await c.app.inject({ url: ROOT })).statusCode, 401);
    assert.equal(
      (await c.app.inject({ url: ROOT, headers: await login("engineer") }))
        .statusCode,
      403,
    );
    const h = await login("admin"),
      r = await c.app.inject({ url: ROOT, headers: h });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().items.length > 0);
    const outside = await login("external");
    assert.deepEqual(
      (await c.app.inject({ url: ROOT, headers: outside })).json().items,
      [],
    );
    assert.equal(
      (
        await c.app.inject({
          url: ROOT + "/" + r.json().items[0].id,
          headers: outside,
        })
      ).statusCode,
      404,
    );
    assert.ok(!r.body.includes("originalPath"));
    assert.ok(!r.body.includes("apiKey"));
    assert.ok(!r.body.includes("content"));
    const detail = await c.app.inject({
      url: ROOT + "/" + r.json().items[0].id,
      headers: h,
    });
    assert.equal(detail.statusCode, 200);
    assert.ok(!detail.body.includes("originalPath"));
    assert.ok(!detail.body.includes('"content"'));
    assert.ok(!detail.body.includes('"values"'));
  }));
test("AI pause is durable, version-checked, audited and preserves human reading and original data", () =>
  fixture(async (c, login) => {
    const h = await login("admin"),
      u = c.store.user("u-admin")!;
    const d = c.store
      .documents(u.tenantId)
      .find((d) => canRead(u, d) && d.kind !== "数据表")!;
    const before = d.content;
    const act = (
      action: string,
      version = d.version,
      policyVersion = d.policyVersion,
    ) =>
      c.app.inject({
        method: "POST",
        url: ROOT + "/" + d.id + "/actions",
        headers: h,
        payload: { action, version, policyVersion },
      });
    assert.equal((await act("hold")).statusCode, 200);
    const paused = c.store.doc(u.tenantId, d.id)!;
    assert.equal(paused.aiPaused, true);
    assert.equal(paused.content, before);
    assert.equal(canRead(u, paused), true);
    assert.equal(canUseAI(u, paused), false);
    assert.deepEqual(retrieve(u, [paused], paused.title), []);
    assert.equal((await act("resume")).statusCode, 409);
    assert.equal(
      (await act("resume", paused.version, paused.policyVersion)).statusCode,
      200,
    );
    assert.equal(canUseAI(u, c.store.doc(u.tenantId, d.id)!), true);
    assert.ok(c.store.auditValid(u.tenantId));
    assert.ok(
      c.store.audits(u.tenantId).some((a) => a.action === "foundation.ai.hold"),
    );
  }));
test("restricted management origin cannot mutate old APIs; unsupported imports and record changes fail", () =>
  fixture(async (c, login) => {
    const h = await login("admin"),
      item = (await c.app.inject({ url: ROOT, headers: h }))
        .json()
        .items.find((x: any) => x.actions.includes("hold"));
    const payload = {
      action: "hold",
      version: item.version,
      policyVersion: item.policyVersion,
    };
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: ROOT + "/" + item.id + "/actions",
          headers: { ...h, origin: "https://untrusted.example" },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: ROOT + "/" + item.id + "/actions",
          headers: { ...h, origin: "http://127.0.0.1:5173" },
          payload: { ...payload, action: "delete" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: "/api/foundation",
          headers: { ...h, origin: "http://127.0.0.1:5173" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: ROOT + "/" + item.id + "/actions",
          headers: { ...h, origin: "http://127.0.0.1:5173" },
          payload,
        })
      ).statusCode,
      200,
    );
    const audit = await login("auditor");
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: ROOT + "/scan",
          headers: audit,
        })
      ).statusCode,
      403,
    );
  }));
test("table metadata omits rows and paused datasets are excluded from model tools", () =>
  fixture(async (c, login) => {
    const h = await login("admin"),
      r = await c.app.inject({
        method: "POST",
        url: "/api/foundation",
        headers: h,
        payload: {
          title: "测试数据资产",
          department: "企业管理",
          purpose: "只读元数据",
          source: "隔离测试",
          updatePolicy: "每日",
          fields: [
            {
              name: "amount",
              label: "金额",
              type: "number",
              required: true,
              unique: false,
              sensitive: false,
              description: "金额说明",
            },
          ],
        },
      });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id;
    await c.app.inject({
      method: "POST",
      url: "/api/foundation/" + id + "/records",
      headers: h,
      payload: {
        values: { amount: "987654321" },
        expectedVersion: 1,
        reason: "测试样本",
      },
    });
    const detail = await c.app.inject({ url: ROOT + "/" + id, headers: h });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.ok(!detail.body.includes("987654321"));
    assert.equal(detail.json().asset.total, 1);
    assert.equal(detail.json().dictionary.fields[0].name, "amount");
    const d = c.store.doc("mengine-demo", id)!;
    await c.app.inject({
      method: "POST",
      url: ROOT + "/" + id + "/actions",
      headers: h,
      payload: {
        action: "hold",
        version: d.version,
        policyVersion: d.policyVersion,
      },
    });
    const u = c.store.user("u-admin")!;
    assert.ok(!listDatasets(c.store, u).some((x) => x.document.id === id));
    assert.throws(
      () => queryDataset(c.store, u, id, { operation: "count" }, true),
      /暂停/,
    );
    assert.equal(
      queryDataset(c.store, u, id, { operation: "count" }).result
        .matchedRecords,
      1,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: ROOT + "/" + id + "/actions",
          headers: h,
          payload: {
            action: "import",
            version: d.version,
            policyVersion: d.policyVersion,
          },
        })
      ).statusCode,
      400,
    );
  }));
test("model generation is queued in the existing worker and does not alter source records", () =>
  fixture(async (c, login) => {
    const h = await login("admin");
    const r = await c.app.inject({
      method: "POST",
      url: "/api/foundation",
      headers: h,
      payload: {
        title: "模型队列测试",
        department: "企业管理",
        purpose: "字段解释",
        source: "合成测试源",
        updatePolicy: "每日",
        fields: [
          {
            name: "amount",
            label: "金额",
            type: "number",
            required: true,
            unique: false,
            sensitive: false,
            description: "人民币元",
          },
        ],
      },
    });
    const id = r.json().id;
    c.model.status = () => ({
      provider: "test",
      model: "test",
      configured: true,
      enabled: true,
      endpoint: "http://127.0.0.1",
    });
    let called = 0;
    c.model.complete = async () => {
      called++;
      return {
        text: JSON.stringify({
          tableMeaning: "测试金额表",
          usageRules: "只读",
          fields: [
            {
              name: "amount",
              label: "金额",
              meaning: "金额",
              unit: "元",
              rules: "数值",
              evidence: "字段注释",
            },
          ],
          relations: [],
          templates: [],
        }),
        usage: null,
      };
    };
    const d = c.store.doc("mengine-demo", id)!;
    const response = await c.app.inject({
      method: "POST",
      url: ROOT + "/" + id + "/actions",
      headers: h,
      payload: {
        action: "dictionary",
        version: d.version,
        policyVersion: d.policyVersion,
      },
    });
    assert.equal(response.statusCode, 202, response.body);
    for (let i = 0; i < 100; i++) {
      const job = c.store.db
        .prepare("SELECT state FROM dictionary_jobs WHERE dataset_id=?")
        .get(id) as { state: string };
      if (job.state === "succeeded") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(called, 1);
    const detail = (
      await c.app.inject({ url: ROOT + "/" + id, headers: h })
    ).json();
    assert.equal(detail.dictionary.status, "generated");
    assert.equal(detail.dictionary.fields[0].unit, "元");
    assert.equal(detail.asset.total, 0);
  }));
test("recheck delegates to actual governance and keeps record values unchanged", () =>
  fixture(async (c, login) => {
    const h = await login("admin");
    const r = await c.app.inject({
      method: "POST",
      url: "/api/foundation",
      headers: h,
      payload: {
        title: "复检测试",
        department: "企业管理",
        purpose: "校验",
        source: "合成测试源",
        updatePolicy: "每日",
        fields: [
          {
            name: "amount",
            label: "金额",
            type: "number",
            required: true,
            unique: false,
            sensitive: false,
            description: "",
          },
        ],
      },
    });
    const id = r.json().id,
      d = c.store.doc("mengine-demo", id)!;
    const row = {
      id: "test-isolated",
      version: 1,
      values: { amount: "12" },
      issues: ["旧异常"],
      status: "quarantined",
      updatedAt: new Date().toISOString(),
      actor: "测试",
    };
    c.store.db
      .prepare("INSERT INTO data_rows VALUES(?,?,?,?,?,?)")
      .run(
        row.id,
        id,
        d.tenantId,
        row.status,
        row.updatedAt,
        JSON.stringify(row),
      );
    const result = await c.app.inject({
      method: "POST",
      url: ROOT + "/" + id + "/actions",
      headers: h,
      payload: {
        action: "recheck",
        version: d.version,
        policyVersion: d.policyVersion,
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    const saved = JSON.parse(
      (
        c.store.db
          .prepare("SELECT data FROM data_rows WHERE id=?")
          .get(row.id) as { data: string }
      ).data,
    );
    assert.deepEqual(saved.values, row.values);
    assert.equal(saved.status, "ready");
    assert.ok(
      c.store
        .audits(d.tenantId)
        .some((a) => a.action === "structured.rechecked"),
    );
  }));
test("non-blocking governance hints remain visible without claiming every record is unavailable", () =>
  fixture(async (c, login) => {
    const h = await login("admin"),
      u = c.store.user("u-admin")!,
      d = c.store
        .documents(u.tenantId)
        .find((d) => canRead(u, d) && d.kind !== "数据表")!;
    d.issues = ["缺少业务标签"];
    c.store.saveDoc(d);
    const item = (await c.app.inject({ url: ROOT, headers: h }))
      .json()
      .items.find((x: any) => x.id === d.id);
    assert.equal(item.available, true);
    assert.equal(item.needsAttention, true);
    assert.equal(item.checksPassed, false);
    assert.equal(item.gate, 3);
    assert.match(item.label, /检查提示/);
  }));
test("manual approval is audited, survives scans, preserves records and expires on snapshot change", () =>
  fixture(async (c, login) => {
    const h = await login("admin");
    const created = await c.app.inject({
      method: "POST",
      url: "/api/foundation",
      headers: h,
      payload: {
        title: "人工校验测试",
        department: "企业管理",
        purpose: "测试",
        source: "合成",
        updatePolicy: "每日",
        fields: [
          {
            name: "amount",
            label: "金额",
            type: "number",
            required: true,
            unique: false,
            sensitive: false,
            description: "",
          },
        ],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id,
      d = c.store.doc("mengine-demo", id)!;
    const row = {
      id: "manual-test-row",
      version: 1,
      values: { amount: "bad" },
      issues: ["数值格式无效"],
      status: "quarantined",
      updatedAt: new Date().toISOString(),
      actor: "测试",
    };
    c.store.db
      .prepare("INSERT INTO data_rows VALUES(?,?,?,?,?,?)")
      .run(
        row.id,
        id,
        d.tenantId,
        row.status,
        row.updatedAt,
        JSON.stringify(row),
      );
    const scan = async () =>
      (
        await c.app.inject({
          method: "POST",
          url: "/api/governance/structured/scan",
          headers: h,
        })
      ).json();
    const f = (await scan()).findings.find(
      (f: any) => f.datasetId === id && f.kind === "field",
    );
    const approve = (headers = h, version = d.version, findingId = f.id) =>
      c.app.inject({
        method: "POST",
        url: ROOT + "/" + id + "/actions",
        headers,
        payload: {
          action: "approve",
          version,
          policyVersion: d.policyVersion,
          findingId,
          reason: "业务负责人已核实",
        },
      });
    assert.equal((await approve(await login("auditor"))).statusCode, 403);
    assert.equal((await approve(await login("external"))).statusCode, 404);
    assert.equal((await approve(h, d.version + 1)).statusCode, 409);
    assert.equal((await approve(h, d.version, "missing")).statusCode, 404);
    const ok = await approve();
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((await approve()).statusCode, 409);
    const result = (await scan()).findings.find((x: any) => x.id === f.id);
    assert.equal(result.status, "resolved");
    assert.equal(result.history.at(-1).action, "人工校验通过");
    assert.equal(result.history.at(-1).note, "业务负责人已核实");
    const detail = (
      await c.app.inject({ url: ROOT + "/" + id, headers: h })
    ).json();
    assert.equal(
      detail.findings.find((x: any) => x.id === f.id).manuallyApproved,
      true,
    );
    assert.ok(
      c.store
        .audits(d.tenantId)
        .some((a) => a.action === "structured.issue.approved"),
    );
    assert.equal(
      (
        c.store.db
          .prepare("SELECT data FROM data_rows WHERE id=?")
          .get(row.id) as { data: string }
      ).data,
      JSON.stringify(row),
    );
    d.version++;
    c.store.saveDoc(d);
    const reopened = (await scan()).findings.find((x: any) => x.id === f.id);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.manualApproval, undefined);
  }));
test("document governance joins issue handling, manual approval and remediation without changing table records", () =>
  fixture(async (c, login) => {
    const h = await login("admin"),
      u = c.store.user("u-admin")!,
      d = c.store
        .documents(u.tenantId)
        .find((d) => canRead(u, d) && d.kind !== "数据表")!;
    d.content = "内容简短";
    d.issues = ["内容信息量偏低"];
    d.status = "ready";
    c.store.saveDoc(d);
    const detail = async () =>
      (await c.app.inject({ url: ROOT + "/" + d.id, headers: h })).json();
    const first = await detail(),
      f = first.findings.find((f: any) => f.kind === "document");
    assert.ok(f);
    const act = async (action: string, extra = {}) => {
      const latest = c.store.doc(u.tenantId, d.id)!;
      return c.app.inject({
        method: "POST",
        url: ROOT + "/" + d.id + "/actions",
        headers: h,
        payload: {
          action,
          version: latest.version,
          policyVersion: latest.policyVersion,
          ...extra,
        },
      });
    };
    assert.equal(
      (await act("handle", { findingId: f.id, reason: "已核实适用性" }))
        .statusCode,
      200,
    );
    assert.equal(
      (await detail()).findings.find((x: any) => x.id === f.id).status,
      "handling",
    );
    assert.equal(
      (await act("approve", { findingId: f.id, reason: "该业务说明完整" }))
        .statusCode,
      200,
    );
    assert.equal((await act("recheck")).statusCode, 200);
    assert.equal(
      (await detail()).findings.find((x: any) => x.id === f.id)
        .manuallyApproved,
      true,
    );
    assert.equal(c.store.doc(u.tenantId, d.id)!.content, "内容简短");
    const changed = c.store.doc(u.tenantId, d.id)!;
    changed.content = "修订的简短内容";
    changed.version++;
    c.store.saveDoc(changed);
    assert.equal(
      (await detail()).findings.find((x: any) => x.id === f.id).status,
      "open",
    );
    changed.content = "合成联系信息 13800138000";
    changed.status = "quarantined";
    changed.classification = 2;
    c.store.saveDoc(changed);
    const fixed = await act("remediate");
    assert.equal(fixed.statusCode, 200, fixed.body);
    assert.ok(!c.store.doc(u.tenantId, d.id)!.content.includes("13800138000"));
    assert.equal(c.store.doc(u.tenantId, d.id)!.status, "ready");
    const summary = (await c.app.inject({ url: ROOT, headers: h })).json();
    assert.equal(summary.auditValid, true);
    assert.ok(summary.governance.departments.length);
  }));
test("scene knowledge uses Wiki permissions, actual article ids and verified graph edges", () =>
  fixture(async (c, login) => {
    const { governanceFingerprint } = await import("../src/governance-ai.js");
    const h = await login("admin"),
      u = c.store.user("u-admin")!;
    const docs = c.store
      .documents(u.tenantId)
      .filter((d) => canUseAI(u, d) && d.kind !== "数据表")
      .slice(0, 2);
    assert.equal(docs.length, 2);
    for (const [i, d] of docs.entries()) {
      const k = {
        id: "knowledge-" + d.id,
        sourceId: d.id,
        fingerprint: governanceFingerprint(d),
        title: "真实知识" + i,
        intro: "合成测试导语",
        content: "合成测试知识正文",
        evidence: [{ quote: "合成原文依据" }],
        createdAt: new Date().toISOString(),
        model: "test",
        revision: 1,
      };
      c.store.db
        .prepare("INSERT INTO wiki_knowledge VALUES(?,?,?,?)")
        .run(k.id, u.tenantId, d.id, JSON.stringify(k));
    }
    const wiki = (
      await c.app.inject({ url: "/api/wiki/knowledge", headers: h })
    ).json();
    const graph = {
      scopeRevision: wiki.scopeRevision,
      documents: docs.map((d, i) => ({
        key: "K" + i,
        id: "knowledge-" + d.id,
      })),
      relations: [
        {
          from: "K0",
          to: "K1",
          reason: "有依据的关系",
          evidence: [{ quote: "关联依据" }],
        },
        { from: "K0", to: "unknown", reason: "不可见关系", evidence: [] },
      ],
    };
    c.store.db
      .prepare("INSERT INTO wiki_auto_graphs VALUES(?,?,?)")
      .run(u.tenantId, u.id, JSON.stringify(graph));
    const read = () =>
      c.app.inject({ url: "/api/scene-knowledge", headers: h });
    const r = await read();
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().items.length, 2);
    assert.equal(r.json().relations.length, 1);
    assert.equal(r.json().relations[0][0], "knowledge-" + docs[0].id);
    assert.equal(r.json().sourceKind["knowledge-" + docs[0].id], 1);
    assert.equal(
      (await c.app.inject({ url: "/api/scene-knowledge" })).statusCode,
      401,
    );
    assert.equal(
      (
        await c.app.inject({
          url: "/api/scene-knowledge",
          headers: await login("engineer"),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await c.app.inject({
          url: "/api/scene-knowledge",
          headers: await login("external"),
        })
      ).json().items.length,
      0,
    );
    const source = "/api/scene-knowledge/knowledge-" + docs[0].id + "/source";
    assert.equal(
      (await c.app.inject({ url: source, headers: h })).statusCode,
      200,
    );
    docs[0].policyVersion++;
    c.store.saveDoc(docs[0]);
    const stale = await read();
    assert.equal(stale.json().items.length, 1);
    assert.equal(stale.json().relations.length, 0);
    assert.equal(
      (await c.app.inject({ url: source, headers: h })).statusCode,
      404,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: "/api/scene-knowledge/sync",
          headers: { ...h, origin: "https://evil.example" },
          payload: {},
        })
      ).statusCode,
      403,
    );
  }));
test("business knowledge analyzes governed rows, stores evidence and joins the original star contract", () =>
  fixture(async (c, login) => {
    const { dictionaryFingerprint } =
      await import("../src/dictionary-version.js");
    const h = await login("admin"),
      u = c.store.user("u-admin")!;
    const r = await c.app.inject({
      method: "POST",
      url: "/api/foundation",
      headers: h,
      payload: {
        title: "订单分析测试",
        department: "企业管理",
        source: "合成测试",
        purpose: "理解金额分布",
        updatePolicy: "每日",
        fields: [
          {
            name: "amount",
            label: "金额",
            type: "number",
            required: true,
            unique: false,
            sensitive: false,
            description: "订单金额",
          },
          {
            name: "phone",
            label: "手机号",
            type: "text",
            required: false,
            unique: false,
            sensitive: true,
            description: "联系号码",
          },
        ],
      },
    });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().id,
      d = c.store.doc(u.tenantId, id)!;
    for (const [i, status] of ["ready", "ready", "quarantined"].entries()) {
      const row = {
        id: "business-row-" + i,
        version: 1,
        values: { amount: String((i + 1) * 10), phone: "13800138000" },
        issues: [],
        status,
        updatedAt: new Date().toISOString(),
        actor: "test",
      };
      c.store.db
        .prepare("INSERT INTO data_rows VALUES(?,?,?,?,?,?)")
        .run(
          row.id,
          id,
          u.tenantId,
          status,
          row.updatedAt,
          JSON.stringify(row),
        );
    }
    const definition = JSON.parse(
      (
        c.store.db.prepare("SELECT data FROM data_sets WHERE id=?").get(id) as {
          data: string;
        }
      ).data,
    );
    const business = {
      tableMeaning: "订单金额快照",
      fields: [
        { name: "amount", label: "金额", meaning: "订单金额", unit: "元" },
      ],
      relations: [],
      templates: [],
    };
    c.store.db
      .prepare("INSERT OR REPLACE INTO data_dictionary VALUES(?,?,?)")
      .run(
        id,
        u.tenantId,
        JSON.stringify({
          confirmed: {
            origin: "model",
            fingerprint: dictionaryFingerprint(c.store, u.tenantId, definition),
            definition: business,
          },
        }),
      );
    c.model.status = () => ({
      configured: true,
      enabled: true,
      model: "test-model",
      provider: "test",
      endpoint: "",
    });
    let calls = 0;
    c.model.complete = async (_system, raw) => {
      calls++;
      const input = JSON.parse(raw);
      assert.ok(!raw.includes("13800138000"));
      assert.ok(!input.fields.some((f: any) => f.name === "phone"));
      assert.ok(input.facts.some((f: any) => f.text.includes("记录数：2")));
      const fact = input.facts.find((f: any) => f.text.includes("合计"));
      assert.ok(fact.text.includes("30"));
      return {
        text: JSON.stringify({
          articles: [
            {
              title: "订单金额合计30元",
              intro: "订单规模观察",
              content: "已统计的订单金额合计30元。",
              evidence: ["F1", fact.id],
            },
            {
              title: "订单金额范围可追溯",
              intro: "基于已统计的订单",
              content: "订单金额合计30元。",
              evidence: [fact.id],
            },
            {
              title: "未核验候选不可发布",
              intro: "不能让错误候选影响独立有效知识",
              content: "当前金额为999999元。",
              evidence: [fact.id],
            },
          ],
          reason: "",
        }),
        usage: null,
      };
    };
    const sync = await c.app.inject({
      method: "POST",
      url: "/api/scene-knowledge/sync",
      headers: h,
      payload: {},
    });
    assert.equal(sync.statusCode, 200, sync.body);
    assert.equal(calls, 1);
    const snap = (
      await c.app.inject({ url: "/api/scene-knowledge", headers: h })
    ).json();
    const item = snap.items.find((k: any) => k.id.startsWith("business-" + id));
    assert.ok(item);
    assert.equal(snap.sourceKind[item.id], 0);
    assert.equal(snap.tabs[2].items.length, 2);
    assert.equal(snap.relations.length, 1);
    assert.match(item.verdict, /30元/);
    assert.equal(
      (
        await c.app.inject({
          url: "/api/scene-knowledge/" + item.id + "/source",
          headers: h,
        })
      ).statusCode,
      200,
    );
    assert.ok(
      c.store
        .audits(u.tenantId)
        .some((a) => a.action === "wiki.business.completed"),
    );
    const outside = (
      await c.app.inject({
        url: "/api/scene-knowledge",
        headers: await login("external"),
      })
    ).json();
    assert.equal(outside.tabs[2].items.length, 0);
    d.version++;
    c.store.saveDoc(d);
    const stale = (
      await c.app.inject({ url: "/api/scene-knowledge", headers: h })
    ).json();
    assert.equal(stale.tabs[2].items.length, 0);
    assert.equal(stale.relations.length, 0);
    c.model.complete = async () => ({
      text: JSON.stringify({
        articles: [
          {
            title: "虚构金额",
            intro: "不应发布",
            content: "999999元",
            evidence: ["F2"],
          },
        ],
        reason: "",
      }),
      usage: null,
    });
    const invalid = await c.app.inject({
      method: "POST",
      url: "/api/scene-knowledge/sync",
      headers: h,
      payload: {},
    });
    assert.equal(invalid.statusCode, 502);
    assert.equal(
      (await c.app.inject({ url: "/api/scene-knowledge", headers: h })).json()
        .tabs[2].items.length,
      0,
    );
    c.model.complete = async () => ({
      text: JSON.stringify({
        articles: [
          {
            title: "当前合格快照订单分析",
            intro: "业务发现",
            content: "订单金额最低10元。",
            evidence: ["F2"],
          },
        ],
        reason: "",
      }),
      usage: null,
    });
    const jargon = await c.app.inject({
      method: "POST",
      url: "/api/scene-knowledge/sync",
      headers: h,
      payload: { retry: true },
    });
    assert.equal(jargon.statusCode, 502);
    assert.match(jargon.body, /内容校验失败/);
    c.model.complete = async () => ({
      text: JSON.stringify({
        articles: [],
        reason: "当前没有足够有意义的业务发现",
      }),
      usage: null,
    });
    const empty = await c.app.inject({
      method: "POST",
      url: "/api/scene-knowledge/sync",
      headers: h,
      payload: { retry: true },
    });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(
      (await c.app.inject({ url: "/api/scene-knowledge", headers: h })).json()
        .business.withoutFindings,
      1,
    );
    d.version++;
    c.store.saveDoc(d);
    c.model.complete = async () => {
      d.policyVersion++;
      c.store.saveDoc(d);
      return {
        text: JSON.stringify({ articles: [], reason: "空发现" }),
        usage: null,
      };
    };
    const revoked = await c.app.inject({
      method: "POST",
      url: "/api/scene-knowledge/sync",
      headers: h,
      payload: {},
    });
    assert.equal(revoked.statusCode, 409, revoked.body);
  }));
