import { createBusinessKnowledge } from "./business-knowledge.js";
import type { Model } from "./model.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Store } from "./store.js";
import { canUseAI, type User } from "./domain.js";
import { redactForGovernance } from "./governance-ai.js";
const fail = (statusCode: number, message: string) =>
  Object.assign(Error(message), { statusCode });
const safe = redactForGovernance;
// Adapt existing, permission-checked Wiki results to the scene's unchanged card and star contracts.
export function registerSceneKnowledge(
  app: FastifyInstance,
  store: Store,
  model: Model,
  session: (r: FastifyRequest) => User,
) {
  const business = createBusinessKnowledge(store, model);
  const auth = (req: FastifyRequest) => {
    const u = session(req);
    return u;
  };
  const call = async (req: FastifyRequest, url: string, payload?: unknown) => {
    const r = await app.inject({
      method: payload === undefined ? "GET" : "POST",
      url,
      headers: { cookie: req.headers.cookie || "" },
      ...(payload === undefined ? {} : { payload: payload as any }),
    });
    if (r.statusCode >= 400)
      throw fail(r.statusCode, r.json().message || "知识服务暂不可用");
    return r.json();
  };
  const card = (k: any) => ({
    id: k.id,
    group: k.department,
    name: k.title,
    why: k.intro,
    side: k.department,
    tone: "ok",
    verdict: k.content,
    kvHead: ["项", "内容", "状态"],
    kv: [
      ["来源", k.sourceTitle, `v${k.sourceVersion}`, "plain"],
      [
        "类型",
        k.sourceKind === 0 ? "业务数据知识" : "资料知识",
        "AI 学习生成",
        "plain",
      ],
      ...k.evidence.map((e: any, i: number) => [
        `依据 ${i + 1}`,
        e.quote,
        k.sourceKind === 0 ? "业务数据统计" : "原文依据",
        "ok",
      ]),
      [k.origin === "deployment" ? "部署治理" : "模型", k.model, `知识 v${k.revision}`, "plain"],
    ],
    actions: ["查看来源", "重新核验"],
  });
  app.get("/api/scene-knowledge", async (req) => {
    const u = auth(req);
    const snap = await call(req, "/api/wiki/knowledge");
    const structured = business.snapshot(u);
    const businessItems = structured.items.map(card),
      documentItems = snap.items.map(card);
    const items = [...businessItems, ...documentItems],
      ids = new Set(items.map((k: any) => k.id));
    const keys = new Map<string, string>(
      (snap.graph?.documents || []).map((d: any) => [d.key, d.id]),
    );
    const relations = (snap.graph?.relations || []).flatMap((r: any) => {
      const a = keys.get(r.from),
        b = keys.get(r.to);
      return a && b && a !== b && ids.has(a) && ids.has(b)
        ? [
            [
              a,
              b,
              safe(r.reason) +
                "；依据：" +
                r.evidence.map((e: any) => safe(e.quote)).join("；"),
            ],
          ]
        : [];
    });
    // Shared evidence is a factual source relationship, not an inferred business dependency.
    for (let i = 0; i < structured.items.length; i++)
      for (let j = i + 1; j < structured.items.length; j++) {
        const a = structured.items[i],
          b = structured.items[j];
        const common =
          a.sourceId === b.sourceId
            ? a.evidence.filter((e) => b.evidence.some((v) => v.id === e.id))
            : [];
        if (common.length)
          relations.push([
            a.id,
            b.id,
            "引用同一业务数据统计：" +
              common.map((e) => e.quote).join("；"),
          ]);
      }
    const learnedIds = new Set(snap.items.map((k: any) => k.sourceId));
    const archivedIds = new Set(
      (
        store.db
          .prepare(
            "SELECT source_id,data FROM wiki_knowledge WHERE tenant_id=?",
          )
          .all(u.tenantId) as { source_id: string; data: string }[]
      )
        .filter((r) => JSON.parse(r.data).archived)
        .map((r) => r.source_id),
    );
    const waiting = store
      .documents(u.tenantId)
      .filter(
        (d) =>
          d.kind !== "数据表" &&
          canUseAI(u, d) &&
          !learnedIds.has(d.id) &&
          !archivedIds.has(d.id),
      )
      .map((d) => ({
        id: "pending-" + d.id,
        group: "需要留意",
        name: safe(d.title),
        why: "来源待学习或更新",
        side: safe(d.department),
        tone: "warn",
        verdict:
          "该来源尚无当前有效知识，请重新核验。仅完成学习的知识进入星图。",
        kvHead: ["项", "内容", "状态"],
        kv: [["来源", safe(d.title), `v${d.version}`, "plain"]],
        actions: ["重新核验"],
      }));
    waiting.push(
      ...structured.waiting.map((d) => ({
        id: "pending-business-" + d.id,
        group: "需要留意",
        name: d.title,
        why: d.state === "failed" ? "业务数据分析待重试" : "业务数据待分析",
        side: d.department,
        tone: "warn",
        verdict: d.reason,
        kvHead: ["项", "内容", "状态"],
        kv: [["来源", d.title, "已治理结构化数据", "plain"]],
        actions: ["重新核验"],
      })),
    );
    const sourceKind = Object.fromEntries(
      items.map((k: any) => [
        k.id,
        businessItems.some((b) => b.id === k.id) ? 0 : 1,
      ]),
    );
    return {
      items,
      relations,
      sourceKind,
      pending: snap.pending + structured.pending.length,
      failed: snap.failed + structured.failed.length,
      busy: snap.busy || structured.busy,
      available: snap.available,
      needsGraph: documentItems.length > 0 && !snap.graph,
      scopeRevision: snap.scopeRevision,
      tabs: [
        { label: `全部 ${items.length}`, items },
        { label: `需要留意 ${waiting.length}`, items: waiting },
        { label: `来自业务数据 ${businessItems.length}`, items: businessItems },
        { label: `来自资料 ${documentItems.length}`, items: documentItems },
        { label: "来自会话 0", items: [] },
      ],
      stats: {
        title: "知识构成",
        rows: [
          ["来自业务数据", String(businessItems.length)],
          ["来自资料", String(documentItems.length)],
          ["来自会话", "0"],
          ["关联", String(relations.length)],
          ["需要留意", String(waiting.length)],
        ],
      },
      aside: {
        title: "最近入库",
        rows: [...structured.items, ...snap.items]
          .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3)
          .map((k: any) => [k.title, k.createdAt]),
      },
      business: {
        learned: businessItems.length,
        pending: structured.pending.length,
        failed: structured.failed.length,
        withoutFindings: structured.empty.length,
      },
      status: structured.busy
        ? "正在分析业务数据"
        : structured.pending.length
          ? `${structured.pending.length} 个数据集待分析`
          : structured.failed.length
            ? `${structured.failed.length} 个数据集分析待重试`
            : snap.busy
              ? "知识正在同步"
              : snap.failed
                ? `${snap.failed} 份资料学习未完成`
                : snap.pending
                  ? `${snap.pending} 份资料待学习`
                  : items.length
                    ? "知识已同步"
                    : "暂无已沉淀知识",
    };
  });
  app.get<{ Params: { id: string } }>(
    "/api/scene-knowledge/:id/source",
    async (req) => {
      const u = auth(req),
        snap = await call(req, "/api/wiki/knowledge"),
        k = [...business.snapshot(u).items, ...snap.items].find(
          (k: any) => k.id === req.params.id,
        );
      if (!k) throw fail(404, "知识已变化或无权访问");
      const d = store.doc(u.tenantId, k.sourceId);
      if (!d || !canUseAI(u, d)) throw fail(404, "来源已变化或无权访问");
      if (k.sourceKind === 0)
        return {
          ...card(k),
          name: d.title,
          verdict:
            "知识依据来自已纳入分析的业务记录。未通过检查的记录及敏感字段不参与统计；尚未同步的新数据不在此次统计范围内。",
          actions: ["返回知识"],
        };
      return {
        ...card(k),
        name: d.title,
        verdict: safe(d.content).slice(0, 6000),
        kv: [
          ["来源版本", String(d.version), "当前授权资料", "plain"],
          ["展示范围", "正文前 6000 字", "已脱敏", "plain"],
        ],
        actions: ["返回知识"],
      };
    },
  );
  app.post<{ Body: { retry?: boolean } }>(
    "/api/scene-knowledge/sync",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { retry: { type: "boolean" } },
        },
      },
    },
    async (req) => {
      const u = auth(req);
      const structured = business.snapshot(u);
      const id =
        structured.pending[0] ||
        (req.body.retry ? structured.failed[0] : undefined);
      if (id) return business.learn(u, id, () => auth(req));
      const snap = await call(req, "/api/wiki/knowledge");
      if (snap.busy) return { message: "知识正在同步" };
      if (snap.pending || (req.body.retry && snap.failed)) {
        const r = await call(req, "/api/wiki/learn", {
          retry: !!req.body.retry,
        });
        return { message: "知识学习已完成", learned: r.learned };
      }
      if (snap.items.length && !snap.graph) {
        await call(req, "/api/wiki/auto-graph", {});
        return { message: "知识关联已更新" };
      }
      return { message: "知识已同步" };
    },
  );
}
