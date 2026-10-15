// Presentation only: API metadata remains the source of truth for findings and access.
export type GovernanceAsset = {
  id: string; title: string; department: string; kind: string; status: string;
  classification: number; audience: string; tags: string[]; issues: string[];
  quality: number; version: number; policyVersion?: number; summary?: string; reviewAt: string; updatedAt: string;
  canRead: boolean; canEdit: boolean; canManage: boolean;
};
export type GovernanceUser = { name: string; role: string; clearance: number };
export const governanceRules = [
  { id: "phone", name: "手机号识别", issue: "检测到手机号", dimension: "敏感信息", icon: "shield", impact: "触发隔离", description: "检查正文中的 11 位手机号格式。命中后隔离资料，密级至少提升至 L2。", remedy: "将匹配字段替换为脱敏占位符。" },
  { id: "identity", name: "身份证号识别", issue: "检测到身份证号", dimension: "敏感信息", icon: "lock", impact: "触发隔离", description: "检查正文中的 18 位身份证号格式。命中后隔离资料，密级至少提升至 L2。", remedy: "将匹配字段替换为脱敏占位符。" },
  { id: "email", name: "邮箱信息识别", issue: "包含邮箱信息", dimension: "敏感信息", icon: "mail", impact: "质量提醒", description: "检查正文中的邮箱格式，记录质量问题；单独命中邮箱不会触发隔离。", remedy: "治理处理会将邮箱替换为脱敏占位符。" },
  { id: "tags", name: "业务标签完整性", issue: "缺少业务标签", dimension: "可发现性", icon: "folder", impact: "质量提醒", description: "检查资料是否至少包含一个业务标签，不判断标签的业务准确性。", remedy: "缺失时补充“待分类”；准确业务标签仍需有编辑权限的人员完善。" },
  { id: "review", name: "复核时效", issue: "已超过复核日期", dimension: "时效性", icon: "clock", impact: "质量提醒", description: "扫描时比较复核日期与当前时间。复核日历还会提示扫描之后新到期的资料。", remedy: "治理处理将复核日期更新为处理日之后 90 天。" },
  { id: "content", name: "内容信息量", issue: "内容信息量偏低", dimension: "内容质量", icon: "book", impact: "人工完善", description: "正文少于 80 个字符时提示信息量偏低，不代表事实准确性或业务完整性判断。", remedy: "需要有编辑权限的人员补充正文；自动脱敏不能保证消除此项。" },
] as const;
export type Queue = "all" | "attention" | "quarantined" | "overdue" | "healthy" | "processing" | "failed";
export type QualityBand = "all" | "excellent" | "improve" | "low";
export type GovernanceFilter = { query: string; department: string; queue: Queue; rule: string; band: QualityBand; sort: "priority" | "quality" | "review" | "updated" };
export const initialGovernanceFilter: GovernanceFilter = { query: "", department: "all", queue: "all", rule: "all", band: "all", sort: "priority" };
export const assetStatus: Record<string, string> = { ready: "已发布", quarantined: "已隔离", queued: "等待处理", processing: "解析中", failed: "处理失败", archived: "已归档" };
export const classificationNames = ["公开", "企业内部", "机密", "严格受限"];
export const roleLabels: Record<string, string> = { admin: "企业管理员", steward: "数据治理负责人", auditor: "审计员", member: "岗位成员", manager: "部门负责人" };
export const isAssessed = (d: GovernanceAsset) => ["ready", "quarantined"].includes(d.status);
export const isOverdue = (d: GovernanceAsset, at: string) => isAssessed(d) && Date.parse(d.reviewAt) < Date.parse(at);
export const needsAttention = (d: GovernanceAsset, at: string) => d.status === "failed" || d.status === "quarantined" || (isAssessed(d) && (d.issues.length > 0 || isOverdue(d, at)));
export function priority(d: GovernanceAsset, at: string) {
  if (d.status === "quarantined") return 4;
  if (d.status === "failed") return 3;
  if (isAssessed(d) && d.issues.some(issue => ["检测到手机号", "检测到身份证号"].includes(issue))) return 3;
  if (isOverdue(d, at)) return 2;
  return isAssessed(d) && d.issues.length ? 1 : 0;
}
export function remediationBlockedReason(d: GovernanceAsset, u: GovernanceUser) {
  if (!["admin", "steward"].includes(u.role)) return "当前岗位仅可查看，不能执行治理处理。";
  if (!d.canManage) return "当前账号没有该资料的管理权限。";
  if (u.clearance < d.classification) return `资料为 L${d.classification}，高于当前 L${u.clearance} 密级授权；请由有权负责人处理。`;
  if (!["ready", "quarantined"].includes(d.status)) return "该资料尚未完成解析，或处理失败；请先在资料库处理接入问题。";
  return "";
}
export function governanceSummary(docs: GovernanceAsset[], at: string) {
  const assessed = docs.filter(isAssessed);
  return {
    total: docs.length, assessed: assessed.length,
    average: assessed.length ? Math.round(assessed.reduce((sum, d) => sum + d.quality, 0) / assessed.length) : null,
    attention: docs.filter(d => needsAttention(d, at)).length,
    quarantined: docs.filter(d => d.status === "quarantined").length,
    overdue: docs.filter(d => isOverdue(d, at)).length,
    healthy: docs.filter(d => d.status === "ready" && !needsAttention(d, at)).length,
    processing: docs.filter(d => ["queued", "processing"].includes(d.status)).length,
    failed: docs.filter(d => d.status === "failed").length,
    findings: assessed.reduce((sum, d) => sum + d.issues.length, 0),
    published: docs.filter(d => d.status === "ready").length,
  };
}
export function filterGovernance(docs: GovernanceAsset[], filter: GovernanceFilter, at: string) {
  const query = filter.query.trim().toLocaleLowerCase();
  const rule = governanceRules.find(r => r.id === filter.rule);
  return docs.filter(d => {
    if (filter.department !== "all" && d.department !== filter.department) return false;
    // No summaries or plaintext are searched in this management-only surface.
    if (query && ![d.title, d.department, ...d.tags].join(" ").toLocaleLowerCase().includes(query)) return false;
    if (filter.queue === "attention" && !needsAttention(d, at)) return false;
    if (filter.queue === "quarantined" && d.status !== "quarantined") return false;
    if (filter.queue === "overdue" && !isOverdue(d, at)) return false;
    if (filter.queue === "healthy" && (d.status !== "ready" || needsAttention(d, at))) return false;
    if (filter.queue === "processing" && !["queued", "processing"].includes(d.status)) return false;
    if (filter.queue === "failed" && d.status !== "failed") return false;
    if (filter.rule !== "all" && (!rule || !isAssessed(d) || !d.issues.includes(rule.issue))) return false;
    if (filter.band !== "all" && (!isAssessed(d) || (filter.band === "excellent" ? d.quality < 90 : filter.band === "improve" ? d.quality < 60 || d.quality >= 90 : d.quality >= 60))) return false;
    return true;
  }).sort((a, b) => {
    const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : Infinity;
    const rank = filter.sort === "quality" ? (isAssessed(a) ? a.quality : Infinity) - (isAssessed(b) ? b.quality : Infinity)
      : filter.sort === "review" ? time(a.reviewAt) - time(b.reviewAt)
      : filter.sort === "updated" ? time(b.updatedAt) - time(a.updatedAt)
      : priority(b, at) - priority(a, at);
    return (Number.isNaN(rank) ? 0 : rank) || a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
  });
}
export function remediationChange(before: GovernanceAsset, after: GovernanceAsset) {
  return { resolved: before.issues.filter(issue => !after.issues.includes(issue)), remaining: [...after.issues], qualityDelta: after.quality - before.quality };
}
