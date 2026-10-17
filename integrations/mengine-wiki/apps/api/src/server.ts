import {configuredRetrieval} from "./weknora-retrieval.js";
import { registerAccess, visibleProposals } from "./access-control.js";
import {registerSceneKnowledge} from './scene-knowledge.js';
import {registerPlatformBridge} from './platform-bridge.js';
import {registerSceneFoundation} from './scene-foundation.js';
import {registerLifecycle} from './resource-lifecycle.js';
import {registerBusinessQueries} from './business-queries.js';
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { Store, digest } from "./store.js";
import { Model, type ModelConfig } from "./model.js";
import { Processor } from "./processor.js";
import { Conversations, mergeDependencies } from "./conversations.js";
import { registerHarness } from "./harness.js";
import { registerConnections } from "./database-connections.js";
import { registerDictionary } from "./data-dictionary.js";
import { registerStructuredGovernance, scanStructured } from "./structured-governance.js";
import { registerFoundation } from "./foundation.js";
import { registerLearnedWiki } from "./learned-wiki.js";
import { registerWikiIntelligence } from "./wiki-intelligence.js";
import { registerGovernanceAI } from "./governance-ai.js";
import { flowSnapshot } from "./flow.js";
import { seed, DEMO_PASSWORD } from "./seed.js";
import {
  canRead,
  canUseAI,
  canEdit,
  canIngest,
  canViewAudit,
  canGovernResource,
  canManage,
  canGovern,
  metadata,
  visibleText,
  scan,
  retrieve,
  chunks,
  now,
  roleLabels,
  type User,
  type Doc,
  type Proposal,
  type Role,
} from "./domain.js";
const error = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", additionalProperties: false, properties, required });
const str = (maxLength = 300) => ({ type: "string", minLength: 1, maxLength });
const enumOf = (values: string[]) => ({ type: "string", enum: values });

export async function buildServer(
  options: {
    dbPath?: string;
    storage?: string;
    demo?: boolean;
    production?: boolean;
    origin?: string;
    sceneOrigin?: string;
    model?: ModelConfig;
  } = {},
) {
  if (options.production && options.demo)
    throw new Error("生产环境禁止启用 DEMO_MODE");
  const app = Fastify({
    logger: false,
    bodyLimit: 2_500_000,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const store = new Store(options.dbPath || ":memory:");
  if (options.production && store.tenant("mengine-demo")) {
    store.close();
    throw new Error("生产环境禁止使用含演示账号的数据库，请使用独立企业数据库");
  }
  const model = new Model(
    options.model || {
      apiKey: "",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    },
  );
  const processor = new Processor(
    store,
    options.storage || ".runtime/test-documents",
  );
  const knowledgeRetrieval = configuredRetrieval(store);
  const searchKnowledge = (u: User, docs: Doc[], question: string) => knowledgeRetrieval
    ? knowledgeRetrieval.search(u, docs, question) : Promise.resolve(retrieve(u, docs, question));
  const conversations = new Conversations(store);
  const pendingConversations = new Set<string>();
  const demo = options.demo === true && !options.production;
  if (demo) seed(store);
  processor.resume();
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 8 },
  });
  const rate = new Map<string, { n: number; until: number }>();
  const limited = (key: string, max: number, period: number) => {
    const t = Date.now();
    let r = rate.get(key);
    if (!r || r.until < t) {
      r = { n: 0, until: t + period };
      rate.set(key, r);
    }
    if (++r.n > max) throw error(429, "请求过于频繁，请稍后重试");
    if (rate.size > 10000)
      for (const [k, v] of rate) if (v.until < t) rate.delete(k);
  };
  const session = (req: FastifyRequest): User => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("mengine_session="))
      ?.slice(16);
    if (!token) throw error(401, "请先登录企业空间");
    const row = store.db
      .prepare("SELECT user_id,expires_at FROM sessions WHERE token_hash=?")
      .get(digest(token)) as
      { user_id: string; expires_at: string } | undefined;
    if (!row || Date.parse(row.expires_at) < Date.now())
      throw error(401, "登录已过期");
    const u = store.user(row.user_id);
    if (!u?.active) throw error(401, "账号已停用");
    return u;
  };
  const docFor = (u: User, id: string) => {
    const d = store.doc(u.tenantId, id);
    if (!d) throw error(404, "资料不存在或无权访问");
    return d;
  };
  const auditDenied = (u: User, target: string) =>
    store.audit(u, "access.denied", target, "服务端权限校验拒绝");
  const assertRead = (u: User, d: Doc) => {
    if (!canRead(u, d)) {
      auditDenied(u, d.id);
      throw error(404, "资料不存在或无权访问");
    }
  };
  const assertManage = (u: User, d: Doc) => {
    if (!canGovernResource(u, d) && !(u.role === "admin" && ["failed","archived"].includes(d.status))) throw error(404, "资料不存在或无权访问");
  };
  const publicPaths = new Set([
    "/api/auth/login",
    "/api/auth/demo",
    "/api/health",
    "/api/internal/platform-scene",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = options.origin || "http://localhost:3300";
      if (
        origin &&
        origin !== allowed &&
        !((req.url.startsWith("/api/scene-foundation") || req.url.startsWith("/api/scene-knowledge") || ["/api/auth/login", "/api/auth/logout"].includes(req.url)) && origin === options.sceneOrigin) &&
        !(demo && origin === "http://127.0.0.1:3300")
      )
        throw error(403, "请求来源未授权");
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw error(403, "不接受跨站写入");
    }
    if (!publicPaths.has(req.url.split("?")[0])) session(req);
  });
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode || 500;
    reply.code(status).send({
      message:
        status === 500
          ? "服务暂时不可用，请重试"
          : err instanceof Error
            ? err.message
            : "请求无效",
    });
  });
  app.get("/api/health", async () => ({
    status: "ok",
    service: "Mengine Wiki",
    version: "1.0.0",
  }));
  app.get("/api/auth/demo", async () => ({
    enabled: demo,
    accounts: demo
      ? store.users("mengine-demo").map((u) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          department: u.department,
        }))
      : [],
    password: demo ? DEMO_PASSWORD : undefined,
  }));
  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    {
      schema: {
        body: object({ email: str(180), password: str(200) }, [
          "email",
          "password",
        ]),
      },
    },
    async (req, reply) => {
      limited(`login:${req.ip}`, 20, 60000);
      const u = store.login(req.body.email, req.body.password);
      if (!u?.active) throw error(401, "账号或密码不正确");
      const token = randomBytes(32).toString("hex");
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(
          digest(token),
          u.id,
          new Date(Date.now() + 8 * 3600000).toISOString(),
        );
      reply.header(
        "Set-Cookie",
        `mengine_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${options.production ? "; Secure" : ""}`,
      );
      store.audit(u, "auth.login", "企业空间", "账号登录");
      return { user: u, tenant: store.tenant(u.tenantId) };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("mengine_session="))
      ?.slice(16);
    if (token)
      store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(digest(token));
    reply.header(
      "Set-Cookie",
      "mengine_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  });
  app.get("/api/me", async (req) => {
    const u = session(req);
    return {
      user: u,
      tenant: store.tenant(u.tenantId),
      demo,
      model: model.status(),
      departments: store.departments(u.tenantId),
      roles: roleLabels,
    };
  });
  app.get<{Querystring:{kind?:"all"|"table"|"document";q?:string}}>("/api/flow", {schema:{querystring:{type:"object",properties:{kind:{enum:["all","table","document"]},q:{type:"string",maxLength:120}}}}}, async (req) => flowSnapshot(store, session(req),req.query));
  app.get("/api/overview", async (req) => {
    const u = session(req);
    const all = store.documents(u.tenantId);
    const docs = all.filter((d) => canRead(u, d));
    const governed = all.filter((d) => canManage(u, d));
    const mine = visibleProposals(store,u);
    return {
      stats: {
        visible: docs.length,
        departments: new Set(docs.map((d) => d.department)).size,
        quality: docs.length
          ? Math.round(docs.reduce((n, d) => n + d.quality, 0) / docs.length)
          : 0,
        pending: mine.filter((p) => p.status === "pending").length,
        issues: governed.filter(
          (d) => d.issues.length && d.status !== "archived",
        ).length,
        quarantined: governed.filter((d) => d.status === "quarantined").length,
      },
      recent: docs
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 6)
        .map((d) => metadata(d, u)),
      activity: canGovern(u)
        ? store.audits(u.tenantId).slice(0, 5)
        : store
            .audits(u.tenantId)
            .filter((a) => a.actorId === u.id)
            .slice(0, 5),
      distribution: store.departments(u.tenantId).map((name) => ({
        name,
        count: docs.filter((d) => d.department === name).length,
      })),
      policy: {
        tenantIsolation: true,
        filteredBeforeRetrieval: true,
        agentApproval: true,
      },
    };
  });
  app.get<{
    Querystring: {
      q?: string;
      department?: string;
      status?: string;
      mode?: string;
    };
  }>("/api/documents", async (req) => {
    const u = session(req);
    const q = req.query;
    let docs = store
      .documents(u.tenantId)
      .filter((d) => (q.mode === "manage" ? canManage(u, d) : canRead(u, d)));
    if (q.q)
      docs = docs.filter((d) =>
        `${d.title} ${d.tags.join(" ")}`
          .toLowerCase()
          .includes(q.q!.toLowerCase()),
      );
    if (q.department && q.department !== "all")
      docs = docs.filter((d) => d.department === q.department);
    if (q.status && q.status !== "all")
      docs = docs.filter((d) => d.status === q.status);
    return {
      items: docs
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((d) => metadata(d, u)),
    };
  });
  app.get<{ Params: { id: string } }>("/api/documents/:id", async (req) => {
    const u = session(req),
      d = docFor(u, req.params.id);
    assertRead(u, d);
    store.audit(u, "document.read", d.title, "读取已授权正文");
    return { ...metadata(d, u), content: visibleText(u, d.content) };
  });
  app.post("/api/documents", async (req, reply) => {
    const u = session(req);
    if (!canIngest(u)) throw error(403, "未授予资料导入能力");
    limited(`upload:${u.tenantId}`, 60, 3600000);
    const file = await req.file();
    if (!file) throw error(400, "请选择资料");
    const ext = extname(file.filename).toLowerCase();
    const kind = ext === ".markdown" ? "md" : ext.slice(1);
    if (!["txt", "md", "docx", "pdf"].includes(kind))
      throw error(400, "支持 PDF、DOCX、Markdown 与 TXT");
    const bytes = await file.toBuffer();
    if (!bytes.length) throw error(400, "文件为空");
    const sha = digest(bytes.toString("base64"));
    const duplicate = store.documents(u.tenantId).find((d) => d.sha === sha);
    if (duplicate) {
      if (!canRead(u, duplicate) && !canManage(u, duplicate))
        throw error(409, "相同内容已存在，请联系治理负责人");
      return { duplicate: true, document: metadata(duplicate, u) };
    }
    const field = (name: string) => {
      const v = file.fields[name];
      return v && !Array.isArray(v) && v.type === "field"
        ? String(v.value)
        : "";
    };
    const classification = Number(field("classification") || 1);
    if (
      !Number.isInteger(classification) ||
      classification < 0 ||
      classification > 3 ||
      classification > u.clearance
    )
      throw error(400, "资料密级超出岗位可创建范围");
    const department = u.department;
    const d: Doc = {
      id: randomUUID(),
      tenantId: u.tenantId,
      title: file.filename.replace(/\.[^.]+$/, "").slice(0, 160),
      kind,
      department,
      ownerId: u.id,
      uploadedBy: { id: u.id, name: u.name },
      classification,
      audience: "department",
      grants: [],
      tags: (field("tags") || "新接入")
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
      status: "queued",
      version: 1,
      policyVersion: 1,
      content: "",
      summary: "",
      sha,
      originalPath: "",
      createdAt: now(),
      updatedAt: now(),
      reviewAt: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      quality: 0,
      issues: [],
      error: null,
    };
    await processor.save(d, bytes);
    store.audit(u, "document.upload", d.title, "导入资料，默认仅责任部门可见");
    return reply.code(201).send({ document: metadata(d, u) });
  });
  app.patch<{
    Params: { id: string };
    Body: { title?: string; tags?: string[]; content?: string; expectedVersion?:number };
  }>(
    "/api/documents/:id",
    {
      schema: {
        body: object({
          title: str(160),
          tags: { type: "array", maxItems: 12, items: str(30) },
          content: str(2000000),
          expectedVersion:{type:"integer",minimum:1},
        }),
      },
    },
    async (req) => {
      const u = session(req),
        d = docFor(u, req.params.id);
      if (!canEdit(u, d)) throw error(403, "当前岗位没有内容编辑权限");
      if(d.kind==="数据表")throw error(409,"数据表定义请在数据基座中编辑");
      if(req.body.expectedVersion!==undefined&&req.body.expectedVersion!==d.version)throw error(409,"资料已变化，请重新打开后编辑");
      if(req.body.title!==undefined&&!req.body.title.trim()||req.body.content!==undefined&&!req.body.content.trim())throw error(400,"标题与正文不能为空");
      store.version(d);
      if (req.body.title) d.title = req.body.title;
      if (req.body.tags) d.tags = req.body.tags;
      if (req.body.content) d.content = req.body.content;
      d.version++;
      d.updatedAt = now();
      const report = scan(d.content, d.tags, d.reviewAt);
      d.quality = report.quality;
      d.issues = report.issues;
      if (report.sensitive) {
        d.status = "quarantined";
        d.classification = Math.max(2, d.classification);
      }
      d.summary = d.content.slice(0, 180);
      store.saveDoc(d, report.sensitive ? "quarantined" : "edited");
      store.audit(
        u,
        "document.updated",
        d.title,
        `内容版本更新为 v${d.version}`,
      );
      return metadata(d, u);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/documents/:id/archive",
    async (req) => {
      const u = session(req),
        d = docFor(u, req.params.id);
      assertManage(u, d);
      if (["queued", "processing"].includes(d.status)) throw error(409, "资料正在处理中，请完成后归档");
      if (d.status === "archived") return {ok:true};
      store.version(d);
      d.status = "archived";
      d.version++;
      d.updatedAt = now();
      store.saveDoc(d);
      store.audit(
        u,
        "document.archived",
        d.title,
        "已退出检索与知识展示，原件保留",
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/documents/:id/retry",
    async (req) => {
      const u = session(req),
        d = docFor(u, req.params.id);
      assertManage(u, d);
      if (d.status !== "failed") throw error(409, "仅失败资料可重试");
      d.status = "queued";
      d.error = null;
      d.updatedAt = now();
      store.saveDoc(d, "retry");
      processor.enqueue(d);
      store.audit(u, "document.retry", d.title, "重新执行持久化解析任务");
      return { ok: true };
    },
  );
  registerGovernanceAI(app, store, model, session, limited);
  registerWikiIntelligence(app, store, model, session);
  registerLearnedWiki(app, store, model, session);
  const closeHarness = registerHarness(app, store, model, session, conversations, pendingConversations);
  registerFoundation(app, store, session);
  const closeStructured = registerStructuredGovernance(app,store,session);
  registerLifecycle(app, store, session);
  const closeConnections = registerConnections(app, store, session);
  const closeDictionary = registerDictionary(app, store, model, session);
  registerBusinessQueries(app,store,session);
  registerSceneFoundation(app,store,model,processor,session);
  registerSceneKnowledge(app,store,model,session);
  registerPlatformBridge(app,store,process.env.MENGINE_PLATFORM_BRIDGE_KEY || '');
  app.get("/api/governance", async (req) => {
    const u = session(req);
    if (!canGovern(u)) throw error(403, "该岗位没有治理中心权限");
    const docs = store
      .documents(u.tenantId)
      .filter((d) => canManage(u, d) && d.status !== "archived" && !store.db.prepare('SELECT 1 FROM data_sets WHERE id=? AND tenant_id=?').get(d.id,u.tenantId));
    return {
      items: docs.map((d) => metadata(d, u)),
      auditValid: store.auditValid(u.tenantId),
      scanAt: now(),
    };
  });
  app.post("/api/governance/scan", async (req) => {
    const u = session(req);
    if (!["admin", "steward"].includes(u.role))
      throw error(403, "该岗位不能执行治理扫描");
    let count = 0;
    for (const d of store
      .documents(u.tenantId)
      .filter((d) => canGovernResource(u, d) && d.status === "ready" && !store.db.prepare('SELECT 1 FROM data_sets WHERE id=? AND tenant_id=?').get(d.id,u.tenantId))) {
      const report = scan(d.content, d.tags, d.reviewAt);
      d.quality = report.quality;
      d.issues = report.issues;
      if (report.sensitive) {
        d.status = "quarantined";
        d.classification = Math.max(2, d.classification);
      }
      d.updatedAt = now();
      store.saveDoc(d, report.sensitive ? "quarantined" : "rescanned");
      count++;
    }
    store.audit(
      u,
      "governance.scan",
      "知识资产",
      `完成 ${count} 份资料的敏感信息、标签与复核日期检查`,
    );
    const structured=scanStructured(store,u);
    return { count, structuredTables:structured.tables.length };
  });
  app.post<{ Params: { id: string } }>(
    "/api/governance/:id/remediate",
    async (req) => {
      const u = session(req),
        d = docFor(u, req.params.id);
      if (
        !["steward", "admin"].includes(u.role) ||
        !canGovernResource(u, d)
      )
        throw error(403, "没有治理处理权限");
      if(store.db.prepare('SELECT 1 FROM data_sets WHERE id=? AND tenant_id=?').get(d.id,u.tenantId))throw error(409, '数据表请使用结构化治理复检');
      if (!["ready", "quarantined"].includes(d.status))
        throw error(409, "当前状态不能处理");
      const report=scan(d.content,d.tags,d.reviewAt);
      d.quality=report.quality;d.issues=report.issues;
      d.status=report.sensitive?"quarantined":"ready";
      d.updatedAt=now();store.saveDoc(d,"rescanned");
      store.audit(u,"governance.rechecked",d.id,"重新检查来源；未修改业务内容或标签");
      return metadata(d, u);
    },
  );
  const departmentUsage = (tenant: string, name: string) => {
    const members = store.users(tenant).filter(m => m.department === name).length;
    const docs = store.documents(tenant);
    const assets = docs.filter(d => d.department === name).length;
    const grants = docs.filter(d => d.grants.some(g => g.subjectType === "department" && g.subjectId === name)).length;
    const proposals = store.proposals(tenant).filter(p => p.status === "pending" && Array.isArray(p.patch.grants) && (p.patch.grants as Doc["grants"]).some(g => g.subjectType === "department" && g.subjectId === name)).length;
    return { members, assets, grants, proposals, inUse: !!(members + assets + grants + proposals) };
  };
  app.get("/api/departments", async req => {
    const u = session(req);
    if (!canGovern(u) && u.role !== "manager") throw error(403, "没有部门管理目录权限");
    return { items: store.departments(u.tenantId).map(name => ({ name, ...departmentUsage(u.tenantId, name) })), canManage: u.role === "admin" };
  });
  app.post<{ Body: { name: string } }>("/api/departments", { schema: { body: object({ name: str(40) }, ["name"]) } }, async req => {
    const u = session(req);
    if (u.role !== "admin") throw error(403, "只有企业管理员可以维护部门");
    const name = req.body.name.trim();
    if (!name || name === "all" || /[\u0000-\u001f\u007f]/.test(name)) throw error(400, "请输入有效的部门名称");
    if (store.departments(u.tenantId).includes(name)) throw error(409, "该部门已存在");
    store.db.transaction(() => { store.ensureDepartment(u.tenantId, name); store.audit(u, "department.created", name, "创建企业自定义部门"); })();
    return { name };
  });
  app.delete<{ Params: { name: string } }>("/api/departments/:name", async req => {
    throw error(410,"请使用稳定部门 ID 的组织管理接口");
    const u = session(req), name = req.params.name;
    if (u.role !== "admin") throw error(403, "只有企业管理员可以维护部门");
    if (!store.departments(u.tenantId).includes(name)) throw error(404, "部门不存在");
    store.db.transaction(() => {
      if (departmentUsage(u.tenantId, name).inUse) throw error(409, "该部门仍被成员、资料、授权或待审批方案使用，不能删除");
      store.db.prepare("DELETE FROM departments WHERE tenant_id=? AND name=?").run(u.tenantId, name);
      store.audit(u, "department.deleted", name, "删除未使用的企业部门");
    })();
    return { ok: true };
  });
  app.get("/api/members", async (req) => {
    const u = session(req);
    if (!canGovern(u) && u.role !== "manager")
      throw error(403, "没有成员目录权限");
    return { items: store.users(u.tenantId), roles: roleLabels, departments: store.departments(u.tenantId) };
  });
  app.post<{
    Body: {
      name: string;
      email: string;
      password: string;
      role: Role;
      department: string;
      clearance: number;
    };
  }>(
    "/api/members",
    {
      schema: {
        body: object(
          {
            name: str(60),
            email: {
              type: "string",
              pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
              maxLength: 180,
            },
            password: { type: "string", minLength: 12, maxLength: 200 },
            role: enumOf(Object.keys(roleLabels)),
            department: str(40),
            clearance: { type: "integer", minimum: 0, maximum: 3 },
          },
          ["name", "email", "password", "role", "department", "clearance"],
        ),
      },
    },
    async (req) => {
      const u = session(req);
      if (u.role !== "admin") throw error(403, "只有企业管理员可以添加成员");
      if (!store.departments(u.tenantId).includes(req.body.department)) throw error(400, "请先创建当前企业的部门");
      const { password, ...input } = req.body;
      const member: User = {
        ...input,
        id: randomUUID(),
        tenantId: u.tenantId,
        active: true,
      };
      try {
        store.addUser(member, password);
      } catch {
        throw error(409, "该账号无法创建，请检查是否已存在");
      }
      store.audit(
        u,
        "member.created",
        member.name,
        `岗位 ${roleLabels[member.role]} · ${member.department}`,
      );
      return member;
    },
  );
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      role: Role;
      clearance: number;
      active: boolean;
      department: string;
    };
  }>(
    "/api/members/:id",
    {
      schema: {
        body: object(
          {
            role: enumOf(Object.keys(roleLabels)),
            department: str(40),
            clearance: { type: "integer", minimum: 0, maximum: 3 },
            active: { type: "boolean" },
            name: str(60),
          },
          ["role", "clearance", "active", "department"],
        ),
      },
    },
    async (req) => {
      const u = session(req);
      if (u.role !== "admin") throw error(403, "只有企业管理员可以分配岗位");
      const m = store.user(req.params.id);
      if (!m || m.tenantId !== u.tenantId) throw error(404, "成员不存在");

      if (!store.departments(u.tenantId).includes(req.body.department)) throw error(400, "请先创建当前企业的部门");
      if(req.body.name!==undefined&&!req.body.name.trim())throw error(400,"姓名不能为空");
      Object.assign(m, req.body, req.body.name===undefined?{}:{name:req.body.name.trim()});
      store.saveUser(m);
      store.audit(
        u,
        "member.updated",
        m.name,
        "岗位权限已更新，现有会话已撤销",
      );
      return m;
    },
  );
  app.get("/api/audit", async (req) => {
    const u = session(req);
    if (!canViewAudit(u)) throw error(403, "没有审计访问权限");
    return {
      items: store.audits(u.tenantId),
      valid: store.auditValid(u.tenantId),
    };
  });
  registerAccess(app,store,session);
  app.get("/api/model", async (req) => {
    session(req);
    return model.status();
  });
  app.post("/api/model/test", async (req) => {
    const u = session(req);
    if (!["admin", "steward"].includes(u.role))
      throw error(403, "没有模型测试权限");
    limited(`modeltest:${u.tenantId}`, 5, 60000);
    const started = Date.now();
    try {
      await model.complete("只回复连接正常", "连接检查", 16);
      store.audit(u, "model.test", "阿里云百炼", "模型连接成功");
      return { ok: true, latency: Date.now() - started, ...model.status() };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "模型连接失败",
        ...model.status(),
      };
    }
  });
  app.get<{ Querystring: { offset?: string } }>("/api/conversations", {
    schema: { querystring: object({ offset: { type: "string", pattern: "^[0-9]{1,7}$" } }) },
  }, async req => conversations.list(session(req), Number(req.query.offset || 0)));
  app.post("/api/conversations", async req => {
    const u = session(req);
    limited(`conversations:${u.id}`, 30, 60000);
    const c = conversations.create(u);
    return conversations.detail(u, c.id);
  });
  app.get<{ Params: { id: string } }>("/api/conversations/:id", async req =>
    conversations.detail(session(req), req.params.id));
  app.patch<{Params:{id:string};Body:{title:string}}>("/api/conversations/:id",{schema:{body:object({title:str(80)},['title'])}},async req=>conversations.rename(session(req),req.params.id,req.body.title));
  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async req => {
    const u = session(req);
    conversations.remove(u, req.params.id);
    store.audit(u, "conversation.deleted", req.params.id, "删除本人的知识对话");
    return { ok: true };
  });
  app.post<{
    Body: {
      question: string;
      conversationId?: string;
      expectedRevision?: number;
      action: "search" | "summarize" | "organize" | "permissions";
      documentId?: string;
      audience?: Doc["audience"];
    };
  }>(
    "/api/agent",
    {
      schema: {
        body: object(
          {
            question: str(2000),
            conversationId: str(80),
            expectedRevision: { type: "integer", minimum: 0, maximum: 200 },
            action: enumOf(["search", "summarize", "organize", "permissions"]),
            documentId: str(),
            audience: enumOf(["private", "department", "organization"]),
          },
          ["question", "action"],
        ),
      },
    },
    async (req) => {
      const u = session(req);
      limited(`agent:${u.tenantId}`, 60, 3600000);
      const started = Date.now();
      const { question: rawQuestion, action, documentId } = req.body;
      const question = visibleText(u, rawQuestion.trim());
      if (!question) throw error(400, "请输入问题");
      let docs = store.documents(u.tenantId);
      if (documentId) {
        const d = docFor(u, documentId);
        assertRead(u, d);
        if(!canUseAI(u,d))throw error(403,"此资料已暂停提供给 AI");
        docs = [d];
      }
      if (action !== "search" && !documentId)
        throw error(400, "请先选择需要处理的资料");
      if (action === "summarize" && docs[0].content.length > 24000)
        throw error(
          400,
          "全文超过单次提炼的 24000 字符上限，请先拆分资料；全文检索仍可用",
        );
      const conversation = req.body.conversationId
        ? conversations.get(u, req.body.conversationId)
        : conversations.create(u);
      if (req.body.conversationId && req.body.expectedRevision !== conversation.revision)
        throw error(409, "对话已变化，请重新打开后继续");
      if (conversation.revision >= 200) throw error(409, "本对话已达到 200 轮，请新建对话继续");
      if (pendingConversations.has(conversation.id)) throw error(409, "当前对话正在回答，请等待完成");
      pendingConversations.add(conversation.id);
      try {
        const storedTurns = conversations.turns(u, conversation.id);
        // A saved document summary may only draw on that document's history.
        const contextTurns = action === "summarize"
          ? storedTurns.filter(t => t.dependencies.every(d => d.documentId === documentId))
          : storedTurns;
        const history = conversations.context(u, contextTurns);
        const currentHits = action === "search" ? await searchKnowledge(u, docs, question) : [];
        const contextualHits = action === "search" && history.previous.length
          ? await searchKnowledge(u, docs, `${question} ${history.previous.map(t => t.question).join(" ")}`)
          : [];
        const previousHits = history.previous.flatMap(t => t.result.evidence)
          .filter(e => !documentId || e.documentId === documentId);
        const candidates = [...currentHits, ...contextualHits, ...previousHits];
        const evidence =
          action === "search"
            ? candidates.filter((e, i) => candidates.findIndex(x => x.chunkId === e.chunkId) === i)
                .slice(0, 12).map((e, i) => ({ ...e, id: i + 1 }))
            : action === "summarize"
              ? chunks(docs[0].content).map((c, i) => ({
                  id: i + 1,
                  documentId: docs[0].id,
                  title: docs[0].title,
                  version: docs[0].version,
                  chunkId: `${docs[0].id}:${docs[0].version}:${c.id}`,
                  start: c.start,
                  end: c.end,
                  snippet: visibleText(u, c.text),
                  score: 1,
                }))
              : [];
        const dependencies = mergeDependencies(history.dependencies,
          [...evidence.map(e => e.documentId), ...(documentId ? [documentId] : [])].map(id => {
            const d = docFor(u, id);
            return { documentId: d.id, version: d.version, policyVersion: d.policyVersion };
          }));
        let text = "";
        let provider = "local";
        let fallback: string | null = null;
        let proposal: Proposal | undefined;
        if (action === "permissions") {
          const d = docs[0];
          if (!req.body.audience) throw error(400, "请选择目标可见范围");
          proposal = {
            id: randomUUID(),
            tenantId: u.tenantId,
            documentId: d.id,
            authorId: u.id,
            action: "permissions",
            patch: { audience: req.body.audience },
            reason: question,
            documentVersion: d.version,
            policyVersion: d.policyVersion,
            status: "pending",
            createdAt: now(),
          };
          const labels = {
            private: "仅本人及显式授权",
            department: "责任部门",
            organization: "企业范围",
          };
          text = `已生成《${d.title}》的权限调整方案：可见范围改为「${labels[req.body.audience]}」。密级与已有显式授权继续生效，需要另一位授权负责人复核后执行。`;
        } else if (action === "organize") {
          const d = docs[0];
          if (!canEdit(u, d)) throw error(403, "当前岗位不能整理这份资料");
          const tags = [...new Set([...d.tags, d.department, "知识沉淀"])].slice(
            0,
            10,
          );
          proposal = {
            id: randomUUID(),
            tenantId: u.tenantId,
            documentId: d.id,
            authorId: u.id,
            action: "organize",
            patch: { tags },
            reason: question,
            documentVersion: d.version,
            policyVersion: d.policyVersion,
            status: "pending",
            createdAt: now(),
          };
          text = `已为《${d.title}》生成整理方案：补充「${tags.join("、")}」标签。确认后生效，原有访问权限保持不变。`;
        } else if (!evidence.length) {
          text =
            "当前授权资料中没有找到足够依据。请补充业务关键词，或联系资料负责人申请访问。";
        } else {
          try {
            const result = await model.answer(
              action === "summarize"
                ? `请提炼所选资料的关键结论与操作要点。${question}`
                : question,
              evidence,
              history,
            );
            text = result.text;
            provider = "bailian";
          } catch (e) {
            fallback = e instanceof Error ? e.message : "模型暂不可用";
            text = evidence
              .slice(0, 3)
              .map((e) => `${e.snippet} [${e.id}]`)
              .join("\n\n");
          }
        }
        if (action === "summarize" && canEdit(u, docs[0])) {
          const d = docs[0];
          proposal = {
            id: randomUUID(),
            tenantId: u.tenantId,
            documentId: d.id,
            authorId: u.id,
            action: "summary",
            patch: { summary: text.slice(0, 2000) },
            reason: question,
            documentVersion: d.version,
            policyVersion: d.policyVersion,
            status: "pending",
            createdAt: now(),
          };
        }
        const current = store.user(u.id);
        if (!current?.active) throw error(403, "当前账号已停用");
        if (current.tenantId !== u.tenantId) throw error(403, "企业身份已变化");
        if (current.clearance < u.clearance)
          throw error(409, "回答期间岗位密级已变化，请重新检索");
        if (!conversations.valid(current, dependencies, u.clearance))
          throw error(409, "回答期间资料或历史上下文权限发生变化，请重新检索");
        session(req); // Logout or session revocation during generation must also take effect.
        if (proposal && action === "summarize") {
          const latest = store.doc(u.tenantId, proposal.documentId);
          if (!latest || !canEdit(current, latest))
            throw error(409, "回答期间编辑权限已变化，请重新生成方案");
        }
        const result = {
          id: randomUUID(),
          action,
          conversationId: conversation.id,
          revision: conversation.revision + 1,
          context: history.stats,
          text,
          evidence,
          provider,
          fallback,
          proposal,
          latency: Date.now() - started,
          steps: [
            { label: "校验企业、岗位与历史权限", state: "done" },
            { label: "在授权全文中实时检索", state: "done" },
            {
              label: ["organize", "permissions"].includes(action)
                ? "生成待确认变更方案"
                : provider === "bailian"
                  ? "百炼生成与引用校验"
                  : "返回可追溯本地证据",
              state: "done",
            },
          ],
        };
        store.db.transaction(() => {
          conversations.append(current, conversation, {
            id: result.id, question, result, createdAt: now(), dependencies, clearance: u.clearance,
          });
          if (proposal) store.proposal(proposal);
          store.db.prepare("INSERT INTO agent_runs VALUES(?,?,?,?)").run(
            result.id,
            u.tenantId,
            u.id,
            JSON.stringify({
              action,
              provider,
              latency: result.latency,
              documentIds: evidence.map((e) => e.documentId),
              at: now(),
            }),
          );
          store.audit(
            u,
            "agent.executed",
            action,
            `${evidence.length} 条授权证据 · ${provider} · ${result.latency}ms`,
          );
        })();
        return result;
      } finally {
        pendingConversations.delete(conversation.id);
      }
    },
  );
  app.addHook("onClose", async () => {
    closeStructured();
    await closeConnections();
    await closeDictionary();
    await closeHarness();
    await processor.close();
    store.close();
  });
  return { app, store, processor, model };
}
