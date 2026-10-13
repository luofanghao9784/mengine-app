import {
  documentFindings,
  recordDocumentDecision,
} from "./scene-document-governance.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Store } from "./store.js";
import type { Model } from "./model.js";
import type { Processor } from "./processor.js";
import {
  canGovern,
  canUseAI,
  scan,
  canManage,
  canRead,
  canEdit,
  now,
  type User,
  type Doc,
} from "./domain.js";
import { dictionaryFingerprint } from "./dictionary-version.js";
import { enqueueDictionary } from "./dictionary-jobs.js";
import { redactForGovernance } from "./governance-ai.js";

const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const ROOT = "/api/scene-foundation";
const states: Record<string, string> = {
  queued: "等待解析",
  processing: "正在解析",
  failed: "解析失败",
  quarantined: "敏感信息待核对",
  archived: "已归档",
  ready: "已就绪",
};
const safe = (v: unknown) =>
  redactForGovernance(typeof v === "string" ? v : "");
// This surface deliberately projects metadata only: no document body, records, credentials or raw connection configuration.
export function registerSceneFoundation(
  app: FastifyInstance,
  store: Store,
  model: Model,
  processor: Processor,
  session: (r: FastifyRequest) => User,
) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS scene_document_findings(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,document_id TEXT NOT NULL,data TEXT NOT NULL)",
  );
  const auth = (req: FastifyRequest) => {
    const u = session(req);
    if (!canGovern(u))
      throw fail(403, "数据基座管理需要管理员、治理负责人或审计岗位");
    return u;
  };
  const visible = (u: User, d: Doc) =>
    u.tenantId === d.tenantId &&
    (u.role === "auditor" || canManage(u, d) || canRead(u, d));
  const get = (u: User, id: string) => {
    const d = store.doc(u.tenantId, id);
    if (!d || !visible(u, d)) throw fail(404, "资产不存在或未授权");
    return d;
  };
  const definition = (u: User, id: string) => {
    const r = store.db
      .prepare("SELECT data FROM data_sets WHERE tenant_id=? AND id=?")
      .get(u.tenantId, id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : null;
  };
  const jobs = (u: User) =>
    (
      store.db
        .prepare("SELECT data FROM database_sync_jobs WHERE tenant_id=?")
        .all(u.tenantId) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  const dict = (u: User, d: Doc, set: any) => {
    if (!set) return null;
    const r = store.db
      .prepare(
        "SELECT data FROM data_dictionary WHERE tenant_id=? AND dataset_id=?",
      )
      .get(u.tenantId, d.id) as { data: string } | undefined;
    const data = r ? JSON.parse(r.data) : null,
      c = data?.confirmed;
    const current =
      !!c &&
      c.origin === "model" &&
      c.fingerprint === dictionaryFingerprint(store, u.tenantId, set);
    const job = store.db
      .prepare(
        "SELECT state,attempts,next_at AS nextAt,error FROM dictionary_jobs WHERE tenant_id=? AND dataset_id=?",
      )
      .get(u.tenantId, d.id) as
      | { state: string; attempts: number; nextAt: string; error: string }
      | undefined;
    return {
      status: current ? "generated" : c ? "changed" : "waiting",
      current,
      revision: data?.revision || 0,
      provider: safe(c?.provider),
      at: c?.at || null,
      job: job ? { ...job, error: safe(job.error) } : null,
      fields: set.fields.map((f: any) => {
        const g = current
          ? c.definition.fields.find((x: any) => x.name === f.name)
          : null;
        return {
          name: f.name,
          label: safe(g?.label || f.label),
          type: f.type,
          required: !!f.required,
          unique: !!f.unique,
          sensitive: !!f.sensitive,
          meaning: safe(g?.meaning || f.description),
          unit: safe(g?.unit),
          rules: safe(g?.rules),
          evidence: safe(g?.evidence),
        };
      }),
      tableMeaning: current ? safe(c.definition.tableMeaning) : "",
      usageRules: current ? safe(c.definition.usageRules) : "",
      warnings: current ? (c.warnings || []).map(safe) : [],
      relations: current
        ? (c.definition.relations || []).flatMap((r: any) => {
            const target = store.doc(u.tenantId, r.targetId);
            return target && visible(u, target)
              ? [
                  {
                    id: r.id,
                    name: safe(r.name),
                    targetId: r.targetId,
                    target: safe(target.title),
                    keys: r.keys,
                    evidence: safe(r.evidence),
                  },
                ]
              : [];
          })
        : [],
      templates: current
        ? (c.definition.templates || [])
            .filter(
              (t: any) =>
                !t.related ||
                (c.definition.relations || []).some((r: any) => {
                  const target = store.doc(u.tenantId, r.targetId);
                  return (
                    r.id === t.related.relationId &&
                    target &&
                    visible(u, target)
                  );
                }),
            )
            .map((t: any) => ({
              id: t.id,
              name: safe(t.name),
              question: safe(t.question),
              operation: t.operation,
              evidence: safe(t.evidence),
            }))
        : [],
    };
  };
  const item = (u: User, d: Doc, syncs: any[]) => {
    const set = definition(u, d.id),
      dictionary = dict(u, d, set),
      sync = syncs.find((j) => j.datasetId === d.id);
    const count = set
      ? (store.db
          .prepare(
            "SELECT COUNT(*) total,COALESCE(SUM(status='ready'),0) ready,COALESCE(SUM(status='quarantined'),0) isolated FROM data_rows WHERE tenant_id=? AND dataset_id=?",
          )
          .get(u.tenantId, d.id) as {
          total: number;
          ready: number;
          isolated: number;
        })
      : null;
    const activeJob = ["queued", "running"].includes(
      dictionary?.job?.state || "",
    );
    const issues = store.db
      .prepare("SELECT data FROM structured_findings WHERE tenant_id=?")
      .all(u.tenantId) as { data: string }[];
    const findings = issues
      .map((r) => JSON.parse(r.data))
      .filter(
        (f) =>
          f.datasetId === d.id &&
          f.status !== "resolved" &&
          (!f.targetId ||
            (store.doc(u.tenantId, f.targetId) &&
              visible(u, store.doc(u.tenantId, f.targetId)!))),
      );
    const metadataIssues = !set
      ? documentFindings(store, u, d)
          .filter((f) => f.status !== "resolved")
          .map((f) => f.title)
      : [];
    const gate =
      d.status === "queued"
        ? 0
        : ["processing", "failed"].includes(d.status)
          ? 1
          : set && !dictionary?.current
            ? 2
            : d.aiPaused ||
                d.status === "quarantined" ||
                !!count?.isolated ||
                findings.length ||
                metadataIssues.length ||
                sync?.state === "failed"
              ? 3
              : 4;
    const available =
      d.status === "ready" && !d.aiPaused && (!set || !!count?.ready);
    const needsAttention =
      d.status !== "archived" &&
      (!available ||
        !!count?.isolated ||
        findings.length > 0 ||
        metadataIssues.length > 0 ||
        sync?.state === "failed" ||
        (!!set && !dictionary?.current));
    const checksPassed =
      d.status === "ready" &&
      !d.aiPaused &&
      (!set || dictionary?.current) &&
      !count?.isolated &&
      findings.length === 0 &&
      metadataIssues.length === 0 &&
      sync?.state !== "failed";
    const label = d.aiPaused
      ? "暂不提供给 AI"
      : d.status !== "ready"
        ? states[d.status]
        : set && !dictionary?.current
          ? activeJob
            ? "口径生成中"
            : "口径待生成"
          : count?.isolated
            ? `${count.isolated} 条记录已隔离`
            : findings.length
              ? `${findings.length} 项治理问题`
              : metadataIssues.length
                ? `${metadataIssues.length} 项资料检查提示`
                : sync?.state === "failed"
                  ? "同步失败"
                  : available
                    ? "AI 可用"
                    : set && !count?.total
                      ? "空数据集"
                      : "待核对";
    const manage =
      canManage(u, d) &&
      ["admin", "steward"].includes(u.role) &&
      u.clearance >= d.classification;
    const actions: string[] = [];
    if (manage) {
      if (d.aiPaused) actions.push("resume");
      else if (["ready", "quarantined"].includes(d.status))
        actions.push("hold");
      if (d.status === "quarantined" && !set) actions.push("allow");
      if (d.status === "failed" && !set) actions.push("retry");
      if (!set && ["ready", "quarantined"].includes(d.status))
        actions.push("recheck", "remediate");
      if (
        !set &&
        canUseAI(u, d) &&
        model.status().configured &&
        model.status().enabled
      )
        actions.push("analyze");
      if (
        set &&
        canEdit(u, d) &&
        !activeJob &&
        !d.aiPaused &&
        model.status().configured &&
        model.status().enabled
      )
        actions.push("dictionary");
      if (set && canEdit(u, d) && u.clearance >= 2) actions.push("recheck");
      if (sync?.enabled && sync.state !== "running" && canEdit(u, d))
        actions.push("sync");
    }
    return {
      id: d.id,
      title: safe(d.title),
      department: safe(d.department),
      classification: d.classification,
      kind: set ? "table" : "document",
      sourceKind: set ? 0 : 1,
      source: safe(set?.source || "内部资料库"),
      status: d.status,
      label,
      gate,
      available,
      needsAttention,
      checksPassed,
      paused: !!d.aiPaused,
      version: d.version,
      policyVersion: d.policyVersion,
      updatedAt: d.updatedAt,
      reviewAt: d.reviewAt,
      quality: d.quality,
      issues: (set ? d.issues : metadataIssues).map(safe),
      tags: d.tags.map(safe),
      total: count?.total ?? null,
      ready: count?.ready ?? null,
      isolated: count?.isolated ?? 0,
      fieldCount: set?.fields.length || 0,
      dictionaryStatus: dictionary?.status || null,
      actions,
      tone:
        available && !needsAttention
          ? "ok"
          : ["queued", "processing"].includes(d.status) || activeJob
            ? "run"
            : d.status === "archived"
              ? "plain"
              : "warn",
      updatePolicy: safe(set?.updatePolicy || "成员上传后处理"),
      sync: sync
        ? {
            id: sync.id,
            enabled: sync.enabled,
            state: sync.state,
            intervalMinutes: sync.intervalMinutes,
            nextAt: sync.nextAt,
            lastSuccess: sync.lastSuccess || null,
            error:
              sync.state === "failed"
                ? "同步失败，保留上次快照，请检查来源与任务权限。"
                : "",
          }
        : null,
    };
  };
  app.get(ROOT, async (req) => {
    const u = auth(req),
      syncs = jobs(u),
      items = store
        .documents(u.tenantId)
        .filter((d) => visible(u, d))
        .map((d) => item(u, d, syncs));
    const active = items.filter((x) => x.status !== "archived");
    return {
      at: now(),
      user: { name: u.name, role: u.role },
      tenant: store.tenant(u.tenantId),
      model: {
        configured: model.status().configured,
        enabled: model.status().enabled,
        model: model.status().model,
      },
      items,
      passed: [
        active.length,
        ...[1, 2, 3].map(
          (g) =>
            active.filter((x) => (g === 3 ? x.checksPassed : x.gate > g))
              .length,
        ),
        active.filter((x) => x.available).length,
      ],
      sources: [
        {
          name: "外部数据集",
          count: active.filter((x) => x.sourceKind === 0).length,
        },
        {
          name: "内部资料库",
          count: active.filter((x) => x.sourceKind === 1).length,
        },
        { name: "外网数据集", count: 0 },
      ],
      auditValid: store.auditValid(u.tenantId),
      governance: {
        attention: active.filter((a) => a.needsAttention).length,
        isolated: active.filter(
          (a) => a.status === "quarantined" || a.isolated > 0,
        ).length,
        overdue: active.filter((a) => Date.parse(a.reviewAt) < Date.now())
          .length,
        failed: active.filter(
          (a) => a.status === "failed" || a.sync?.state === "failed",
        ).length,
        averageQuality: active.length
          ? Math.round(
              active.reduce((sum, a) => sum + a.quality, 0) / active.length,
            )
          : null,
        departments: [...new Set(active.map((a) => a.department))].map(
          (name) => ({
            name,
            total: active.filter((a) => a.department === name).length,
            attention: active.filter(
              (a) => a.department === name && a.needsAttention,
            ).length,
          }),
        ),
      },
      canScan: ["admin", "steward"].includes(u.role),
    };
  });
  app.get<{ Params: { id: string } }>(ROOT + "/:id", async (req) => {
    const u = auth(req),
      d = get(u, req.params.id),
      set = definition(u, d.id),
      a = item(u, d, jobs(u));
    const findings = (
      store.db
        .prepare("SELECT data FROM structured_findings WHERE tenant_id=?")
        .all(u.tenantId) as { data: string }[]
    )
      .map((r) => JSON.parse(r.data))
      .filter(
        (f) =>
          f.datasetId === d.id &&
          (!f.targetId ||
            (store.doc(u.tenantId, f.targetId) &&
              visible(u, store.doc(u.tenantId, f.targetId)!))),
      )
      .concat(!set ? documentFindings(store, u, d) : [])
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        title: safe(f.title),
        detail: safe(f.detail)
          .replace(
            "请在记录清单更正后重新校验。",
            "请由源系统负责人修正后同步并复检。",
          )
          .replace("更正后重新校验", "源系统修正并同步后重新校验"),
        count: f.count,
        field: f.field,
        status: f.status,
        manuallyApproved: !!f.manualApproval,
        firstAt: f.firstAt,
        lastAt: f.lastAt,
        history: f.history.map((h: any) => ({
          at: h.at,
          actor: safe(h.actor),
          action: safe(h.action),
          note: safe(h.note),
        })),
      }));
    let analysis = null;
    if (!set && canUseAI(u, d) && canManage(u, d)) {
      const r = await app.inject({
        url: `/api/governance/${encodeURIComponent(d.id)}/analysis`,
        headers: { cookie: req.headers.cookie || "" },
      });
      if (r.statusCode === 200) {
        const v = r.json();
        analysis = {
          state: v.state,
          model: v.model,
          available: v.available,
          report: v.report
            ? {
                createdAt: v.report.createdAt,
                overview: safe(v.report.overview),
                findings: v.report.findings.map((f: any) => ({
                  title: safe(f.title),
                  severity: f.severity,
                  explanation: safe(f.explanation),
                  recommendation: safe(f.recommendation),
                })),
              }
            : null,
        };
      }
    }
    return {
      analysis,
      asset: a,
      audit: store
        .audits(u.tenantId)
        .filter((x) => x.target === d.id)
        .map((x) => ({
          at: x.at,
          actor: safe(x.actor),
          action: safe(x.action),
          detail: safe(x.detail),
        })),
      dictionary: dict(u, d, set),
      findings,
      events: store.flowEvents(u.tenantId, d.id),
      batches: (
        store.db
          .prepare(
            "SELECT data FROM data_batches WHERE tenant_id=? AND dataset_id=? ORDER BY seq DESC LIMIT 30",
          )
          .all(u.tenantId, d.id) as { data: string }[]
      ).map((r) => {
        const b = JSON.parse(r.data);
        return {
          at: b.at,
          version: b.version,
          actor: safe(b.actor),
          operation: safe(b.operation),
          status: b.status || "",
          reason: safe(b.reason),
        };
      }),
    };
  });
  // Only these domain operations exist on the management surface; no generic forwarding or record mutation.
  const body = {
    type: "object",
    additionalProperties: false,
    required: ["action", "version", "policyVersion"],
    properties: {
      action: {
        enum: [
          "hold",
          "resume",
          "allow",
          "retry",
          "dictionary",
          "recheck",
          "sync",
          "handle",
          "approve",
          "remediate",
          "analyze",
        ],
      },
      version: { type: "integer", minimum: 1 },
      policyVersion: { type: "integer", minimum: 1 },
      reason: { type: "string", maxLength: 300 },
      findingId: { type: "string", maxLength: 100 },
    },
  };
  app.post<{
    Params: { id: string };
    Body: {
      action: string;
      version: number;
      policyVersion: number;
      reason?: string;
      findingId?: string;
    };
  }>(ROOT + "/:id/actions", { schema: { body } }, async (req, reply) => {
    const u = auth(req),
      d = get(u, req.params.id),
      b = req.body,
      a = item(u, d, jobs(u));
    if (
      !canManage(u, d) ||
      !["admin", "steward"].includes(u.role) ||
      u.clearance < d.classification
    )
      throw fail(403, "当前账号无权操作此资产");
    if (d.version !== b.version || d.policyVersion !== b.policyVersion)
      throw fail(409, "资产或权限已变化，请刷新后重试");
    if (
      !["handle", "approve"].includes(b.action) &&
      !a.actions.includes(b.action)
    )
      throw fail(409, "当前状态不支持此操作，请刷新");
    const reason = b.reason?.trim() || "企业管理端数据基座操作";
    if (["hold", "resume", "allow"].includes(b.action)) {
      store.db.transaction(() => {
        store.version(d);
        if (b.action === "allow") {
          d.status = "ready";
          d.version++;
          d.aiPaused = false;
        } else d.aiPaused = b.action === "hold";
        d.policyVersion++;
        d.updatedAt = now();
        store.saveDoc(d);
        store.audit(u, "foundation.ai." + b.action, d.id, reason);
      })();
    } else if (
      !definition(u, d.id) &&
      ["handle", "approve"].includes(b.action)
    ) {
      if (!b.reason?.trim()) throw fail(400, "请填写处理说明");
      recordDocumentDecision(store, u, d, b.findingId || "", b.action, reason);
    } else if (!definition(u, d.id) && b.action === "recheck") {
      const report = scan(d.content, d.tags, d.reviewAt);
      d.quality = report.quality;
      d.issues = report.issues;
      if (report.sensitive) {
        d.status = "quarantined";
        d.classification = Math.max(2, d.classification);
      }
      d.updatedAt = now();
      store.saveDoc(d, "rescanned");
      documentFindings(store, u, d);
      store.audit(u, "governance.rechecked", d.id, reason);
    } else if (b.action === "retry") {
      d.status = "queued";
      d.error = null;
      d.updatedAt = now();
      store.saveDoc(d, "retry");
      processor.enqueue(d);
      store.audit(u, "document.retry", d.id, reason);
    } else if (b.action === "dictionary") {
      enqueueDictionary(store, u, d.id);
      store.audit(u, "dictionary.requested", d.id, reason);
      return reply
        .code(202)
        .send({ ok: true, message: "已加入现有模型任务队列，完成后自动刷新" });
    } else {
      let url = "",
        payload: Record<string, unknown> = {};
      if (b.action === "recheck") {
        url = `/api/governance/structured/${encodeURIComponent(d.id)}/recheck`;
        payload = { expectedVersion: d.version, reason };
      }
      if (b.action === "remediate")
        url = `/api/governance/${encodeURIComponent(d.id)}/remediate`;
      if (b.action === "analyze") {
        url = `/api/governance/${encodeURIComponent(d.id)}/analysis`;
        payload = {
          documentVersion: d.version,
          policyVersion: d.policyVersion,
        };
      }
      if (b.action === "sync")
        url = `/api/database-sync/${encodeURIComponent(a.sync!.id)}/run`;
      if (["handle", "approve"].includes(b.action)) {
        const f = store.db
          .prepare(
            "SELECT data FROM structured_findings WHERE id=? AND tenant_id=?",
          )
          .get(b.findingId || "", u.tenantId) as { data: string } | undefined;
        if (!f || JSON.parse(f.data).datasetId !== d.id)
          throw fail(404, "治理问题不存在");
        if (!b.reason?.trim()) throw fail(400, "请填写处理说明");
        url = `/api/governance/structured/issues/${encodeURIComponent(b.findingId!)}/${b.action}`;
        payload =
          b.action === "approve"
            ? { reason, expectedVersion: d.version }
            : { reason };
      }
      const result = await app.inject({
        method: "POST",
        url,
        headers: { cookie: req.headers.cookie || "" },
        payload,
      });
      if (result.statusCode >= 400)
        throw fail(result.statusCode, result.json().message || "操作未完成");
      store.audit(u, "foundation." + b.action, d.id, reason);
    }
    return {
      ok: true,
      message:
        b.action === "sync"
          ? "本次取数已完成"
          : b.action === "hold"
            ? "已暂停后续 AI 调用，原始记录保留"
            : "操作已完成并写入审计",
    };
  });
  app.post(ROOT + "/scan", async (req) => {
    const u = auth(req);
    if (!["admin", "steward"].includes(u.role))
      throw fail(403, "没有治理扫描权限");
    const result = await app.inject({
      method: "POST",
      url: "/api/governance/scan",
      headers: { cookie: req.headers.cookie || "" },
    });
    if (result.statusCode >= 400)
      throw fail(result.statusCode, result.json().message || "扫描失败");
    return result.json();
  });
}
