export const roleLabels = {
  admin: "企业管理员",
  steward: "数据治理负责人",
  manager: "部门负责人",
  member: "岗位成员",
  auditor: "审计员",
} as const;
export type Role = keyof typeof roleLabels;
export type Scope = { type: "tenant" | "department" | "resource"; id: string };
export type Duties = { governance?: Scope[]; inspection?: Scope[]; approval?: Scope[]; connections?: string[]; ingest?: boolean };
export type User = {
  departmentId?: string;
  duties?: Duties;
  id: string;
  tenantId: string;
  name: string;
  email: string;
  department: string;
  role: Role;
  clearance: number;
  active: boolean;
};
export type Grant = {
  subjectType: "user" | "department" | "role";
  subjectId: string;
  level: "read" | "edit";
};
export type Doc = {
  departmentId?: string;
  aiPaused?: boolean;
  id: string;
  tenantId: string;
  title: string;
  kind: string;
  department: string;
  ownerId: string;
  /** Upload-time identity, independent of ownership and business tags. */
  uploadedBy?: { id: string; name: string };
  classification: number;
  audience: "department" | "organization" | "private";
  grants: Grant[];
  tags: string[];
  status:
    "queued" | "processing" | "ready" | "quarantined" | "failed" | "archived";
  version: number;
  policyVersion: number;
  content: string;
  summary: string;
  sha: string;
  originalPath: string;
  createdAt: string;
  updatedAt: string;
  reviewAt: string;
  quality: number;
  issues: string[];
  error: string | null;
};
export type Evidence = {
  id: number;
  documentId: string;
  title: string;
  version: number;
  chunkId: string;
  start: number;
  end: number;
  snippet: string;
  score: number;
};
export type Proposal = {
  id: string;
  tenantId: string;
  documentId: string;
  authorId: string;
  action: "organize" | "permissions" | "summary" | "dictionary";
  patch: Record<string, unknown>;
  reason: string;
  documentVersion: number;
  policyVersion: number;
  status: "pending" | "applied" | "rejected" | "withdrawn" | "invalidated";
  createdAt: string;
  resolvedAt?: string;
};
export type FlowEventName =
  | "received" | "parsing" | "scanning" | "published" | "quarantined"
  | "failed" | "archived" | "retry" | "resumed" | "edited" | "rescanned" | "remediated"
  | "permissions-applied" | "change-applied"
  | "dictionary-queued" | "sync-started" | "sync-completed" | "sync-failed"
  | "structure-stored" | "records-checked" | "dictionary-generating" | "dictionary-generated" | "dictionary-failed" | "dictionary-interrupted";
export const now = () => new Date().toISOString();
export const classificationLabels = ["公开", "企业内部", "机密", "严格受限"];
export const sameTenant = (u: User, d: Doc) => u.tenantId === d.tenantId;
const validIdentity = (u: User) => u.active && Object.hasOwn(roleLabels, u.role);
const level = (u: User) => u.role === "admin" ? 3 : u.clearance;
const scoped = (u: User, d: Doc, scopes: Scope[] = []) => scopes.some(s =>
  s.type === "tenant" ? s.id === u.tenantId : s.type === "resource" ? s.id === d.id : !!d.departmentId && s.id === d.departmentId);
const boundary = (u: User, d: Doc) => validIdentity(u) && sameTenant(u,d);
export function canReadResource(u: User, d: Doc) {
  if (!boundary(u,d) || d.status !== "ready" || level(u) < d.classification) return false;
  return u.role === "admin" || d.audience === "organization" || u.id === d.ownerId ||
    (d.audience === "department" && !!u.departmentId && u.departmentId === d.departmentId) ||
    d.grants.some(g => g.subjectType === "user" ? g.subjectId === u.id : g.subjectType === "role" ? g.subjectId === u.role : !!u.departmentId && g.subjectId === u.departmentId);
}
export const canRead = canReadResource;
export const canUseAI = (u: User,d: Doc) => canReadResource(u,d) && !d.aiPaused;
export const canEditContent = (_u: User,_d: Doc): boolean => false;
export const canEditSchema = canEditContent;
export const canMutateRecords = canEditContent;
/** Compatibility only for rejecting legacy customer content writes. Never use for system jobs. */
export const canEdit = canEditContent;
export const canManageOrganization = (u: User) => validIdentity(u) && u.role === "admin";
export const canViewAudit = (u: User) => validIdentity(u) && ["admin","auditor"].includes(u.role);
export const canViewGovernanceMetadata = (u: User,d: Doc) => boundary(u,d) &&
  (u.role === "admin" || u.role === "steward" && scoped(u,d,u.duties?.governance));
export const canGovernResource = (u: User,d: Doc) => canViewGovernanceMetadata(u,d) &&
  level(u) >= d.classification && !["archived","queued","processing"].includes(d.status);
export const canInspectQuarantinedContent = (u: User,d: Doc) => boundary(u,d) &&
  d.status === "quarantined" && level(u) >= d.classification &&
  (u.role === "admin" || u.role === "steward" && scoped(u,d,u.duties?.inspection));
export const canRecheck = canGovernResource;
export const canRegenerateDictionary = (u: User,d: Doc) => canGovernResource(u,d) && canUseAI(u,d);
export const canViewPolicy = (u: User,d: Doc) => boundary(u,d) && (u.role === "admin" || canRead(u,d) || canViewGovernanceMetadata(u,d));
export const canRequestAccess = (u: User,d: Doc) => boundary(u,d) && d.status === "ready";
export const canManagePolicy = (u: User,d: Doc) => boundary(u,d) && u.role === "admin";
export const canApprovePolicy = (u: User,d: Doc,applicant?:string) => boundary(u,d) &&
  (u.role === "admin" || u.role === "steward" && u.id !== applicant && level(u) >= d.classification && scoped(u,d,u.duties?.approval));
export const canIngest = (u: User) => validIdentity(u) && u.role !== "auditor" && (u.role === "admin" || u.duties?.ingest === true);
export const canManageConnection = (u: User, tenant: string, id?: string) => validIdentity(u) && u.tenantId === tenant &&
  (u.role === "admin" || u.role === "steward" && !!id && (u.duties?.connections || []).includes(id));
export const canRunSync = (u: User,d: Doc) => canGovernResource(u,d);
export const canManage = canViewGovernanceMetadata;
export const canGovern = (u: User) => validIdentity(u) && ["admin","steward"].includes(u.role);
export function visibleText(u: User, text: string) {
  return u.clearance >= 2
    ? text
    : text
        .replace(/\b1[3-9]\d{9}\b/g, "[手机号已脱敏]")
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[邮箱已脱敏]")
        .replace(/\b\d{17}[\dXx]\b/g, "[身份证号已脱敏]");
}
export function metadata(d: Doc, u: User) {
  const { content, originalPath, sha, ...safe } = d;
  return {
    ...safe,
    summary: canRead(u, d) ? visibleText(u, d.summary) : "",
    canRead: canRead(u, d),
    canEdit: false,
    canViewPolicy: canViewPolicy(u,d),
    canManagePolicy: canManagePolicy(u,d),
    canGovern: canGovernResource(u,d),
    canRecheck: canRecheck(u,d),
    canInspect: canInspectQuarantinedContent(u,d),
    canManage: canManage(u, d),
  };
}
export function scan(text: string, tags: string[], reviewAt: string) {
  const issues: string[] = [];
  if (/\b1[3-9]\d{9}\b/.test(text)) issues.push("检测到手机号");
  if (/\b\d{17}[\dXx]\b/.test(text)) issues.push("检测到身份证号");
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) issues.push("包含邮箱信息");
  if (!tags.length) issues.push("缺少业务标签");
  if (Date.parse(reviewAt) < Date.now()) issues.push("已超过复核日期");
  if (text.length < 80) issues.push("内容信息量偏低");
  return {
    issues,
    quality: Math.max(20, 100 - issues.length * 16),
    sensitive: issues.some((x) => x.includes("手机号") || x.includes("身份证")),
  };
}
export function chunks(text: string) {
  const result: { id: string; start: number; end: number; text: string }[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 850, text.length);
    if (end < text.length) {
      const split = text.lastIndexOf("\n", end);
      if (split > start + 400) end = split + 1;
    }
    result.push({
      id: String(result.length),
      start,
      end,
      text: text.slice(start, end),
    });
    if (end === text.length) break;
    start = end - 100;
  }
  return result;
}
export function tokens(text: string) {
  const a: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+|[\u3400-\u9fff]+/g)) {
    const s = m[0];
    if (/^[a-z0-9]+$/.test(s) || s.length <= 2) a.push(s);
    else for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2));
  }
  return [...new Set(a)];
}
export function retrieve(u: User, docs: Doc[], question: string): Evidence[] {
  const query = tokens(question);
  if (!query.length) return [];
  return docs
    .filter((d) => canUseAI(u, d))
    .flatMap((d) =>
      chunks(d.content).map((c) => {
        const safe = visibleText({ ...u, clearance: 0 }, c.text);
        const hits = query.filter((q) => safe.toLowerCase().includes(q)).length;
        const titleHits = query.filter((q) =>
          d.title.toLowerCase().includes(q),
        ).length;
        return {
          documentId: d.id,
          title: d.title,
          version: d.version,
          chunkId: `${d.id}:${d.version}:${c.id}`,
          start: c.start,
          end: c.end,
          snippet: safe,
          score: (hits + titleHits * 0.7) / query.length,
        };
      }),
    )
    .filter((x) => x.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x, i) => ({ ...x, id: i + 1 }));
}
