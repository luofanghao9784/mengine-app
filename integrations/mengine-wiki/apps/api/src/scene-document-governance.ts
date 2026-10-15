import { createHash } from "node:crypto";
import type { Store } from "./store.js";
import { now, type Doc, type User } from "./domain.js";
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
export type DocumentFinding = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  count: number;
  status: string;
  firstAt: string;
  lastAt: string;
  manualApproval?: string;
  history: { at: string; actor: string; action: string; note: string }[];
};
export const documentCheckFingerprint = (d: Doc) =>
  hash([
    d.version,
    d.policyVersion,
    d.content,
    d.tags,
    d.reviewAt,
    d.classification,
    d.status,
    d.issues,
  ]);
export function documentFindings(s: Store, u: User, d: Doc) {
  const at = now(),
    fingerprint = documentCheckFingerprint(d);
  const old = (
    s.db
      .prepare(
        "SELECT data FROM scene_document_findings WHERE tenant_id=? AND document_id=?",
      )
      .all(u.tenantId, d.id) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as DocumentFinding);
  const issues = ["ready", "quarantined"].includes(d.status)
    ? [
        ...new Set([
          ...d.issues,
          ...(Date.parse(d.reviewAt) < Date.now() ? ["已超过复核日期"] : []),
        ]),
      ]
    : [];
  const current = issues.map((title) => {
    const id = "doc-" + hash([d.id, title]),
      previous = old.find((f) => f.id === id);
    const approved =
      previous?.status === "resolved" &&
      previous.manualApproval === fingerprint;
    return {
      id,
      kind: "document",
      title,
      detail:
        title === "内容信息量偏低"
          ? "正文信息量低于现有规则阈值，可核实业务适用性并记录人工结论。"
          : title === "已超过复核日期"
            ? "资料已超过复核日期，请由责任人核实有效性，更新来源资料后重新检查。"
            : "原系统资料检查规则命中；请由责任人核实处理，敏感资料保持原权限限制。",
      count: 1,
      status: approved
        ? "resolved"
        : previous?.status === "handling"
          ? "handling"
          : "open",
      firstAt: previous?.firstAt || at,
      lastAt: at,
      manualApproval: approved ? previous?.manualApproval : undefined,
      history: previous
        ? previous.status === "resolved" && !approved
          ? [
              ...previous.history,
              {
                at,
                actor: u.name,
                action: "重新发现",
                note: "资料版本或检查依据已变化，请重新核验",
              },
            ].slice(-50)
          : previous.history
        : [{ at, actor: u.name, action: "发现问题", note: title }],
    } as DocumentFinding;
  });
  for (const f of old.filter((f) => !current.some((x) => x.id === f.id))) {
    if (!["ready", "quarantined"].includes(d.status)) {
      // An unavailable processor result is not evidence that an issue disappeared.
      if (f.manualApproval && f.manualApproval !== fingerprint) {
        f.status = "open";
        f.manualApproval = undefined;
        f.history = [...f.history, {at, actor: u.name, action: "重新发现", note: "资料状态已变化，等待处理完成后重新核验"}].slice(-50);
      }
      current.push(f);
      continue;
    }
    if (f.status !== "resolved") {
      f.status = "resolved";
      f.manualApproval = undefined;
      f.history.push({
        at,
        actor: u.name,
        action: "复检通过",
        note: "当前资料检查中问题已消失",
      });
    }
    f.history = f.history.slice(-50);
    current.push(f);
  }
  s.db.transaction(() => {
    for (const f of current)
      s.db
        .prepare(
          "INSERT INTO scene_document_findings VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(f.id, u.tenantId, d.id, JSON.stringify(f));
  })();
  return current;
}
export function recordDocumentDecision(
  s: Store,
  u: User,
  d: Doc,
  id: string,
  action: string,
  reason: string,
) {
  if (!["ready", "quarantined"].includes(d.status))
    throw Object.assign(Error("资料尚未完成处理，请处理完成后核验"), {statusCode:409});
  const f = documentFindings(s, u, d).find((f) => f.id === id);
  if (!f) throw Object.assign(Error("资料治理问题不存在"), { statusCode: 404 });
  if (f.status === "resolved")
    throw Object.assign(Error("问题已经关闭，请刷新"), { statusCode: 409 });
  const at = now();
  f.status = action === "approve" ? "resolved" : "handling";
  f.manualApproval =
    action === "approve" ? documentCheckFingerprint(d) : undefined;
  f.history.push({
    at,
    actor: u.name,
    action: action === "approve" ? "人工校验通过" : "开始处理",
    note: reason,
  });
  f.history = f.history.slice(-50);
  s.db.transaction(() => {
    s.db
      .prepare(
        "UPDATE scene_document_findings SET data=? WHERE id=? AND tenant_id=?",
      )
      .run(JSON.stringify(f), id, u.tenantId);
    s.audit(
      u,
      action === "approve"
        ? "governance.issue.approved"
        : "governance.issue.handling",
      d.id,
      `${f.title}；${reason}`,
    );
  })();
}
