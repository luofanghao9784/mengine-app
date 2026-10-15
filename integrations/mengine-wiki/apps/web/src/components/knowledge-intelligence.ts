export type KnowledgeDoc = { id: string; title: string; department: string; version: number; policyVersion: number };
export type KnowledgeCitation = { source: string; quote: string };
export type SupportedKnowledge = { text: string; evidence: KnowledgeCitation[] };
export type KnowledgeRelation = { from: string; to: string; kind: "topic" | "complement" | "dependency" | "sequence"; reason: string; evidence: KnowledgeCitation[] };
export type KnowledgeReport = {
  id: string; createdAt: string; model: string;
  documents: (KnowledgeDoc & { key: string; analyzedCharacters: number; totalCharacters: number })[];
  nodes?: { document: string; summary: SupportedKnowledge; takeaways: SupportedKnowledge[] }[];
  synthesis?: SupportedKnowledge; relations: KnowledgeRelation[];
};
export const relationLabels = { topic: "共同主题", complement: "互为补充", dependency: "前置依赖", sequence: "流程衔接" };
export const scopeMatches = (report: KnowledgeReport, selected: string[]) => report.documents.length === selected.length && report.documents.every(d => selected.includes(d.id));
export function knowledgePositions(count: number) {
  if (count === 1) return [{ x: 320, y: 230 }];
  if (count === 2) return [{ x: 140, y: 230 }, { x: 500, y: 230 }];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / count;
    return { x: 320 + Math.cos(angle) * 218, y: 230 + Math.sin(angle) * 168 };
  });
}

/** All authorized learned articles are nodes, even before relation analysis completes. */
export function fullKnowledgeGraph(
  articles: { id: string; title: string; department: string; sourceVersion: number; content: string }[],
  report: KnowledgeReport | null | undefined,
): KnowledgeReport {
  const documents = [...articles].sort((a, b) => a.id.localeCompare(b.id)).map(a => {
    const existing = report?.documents.find(d => d.id === a.id);
    return { id: a.id, key: existing?.key || `N-${a.id}`, title: a.title, department: a.department,
      version: a.sourceVersion, policyVersion: existing?.policyVersion || 0,
      analyzedCharacters: existing?.analyzedCharacters || 0, totalCharacters: a.content.length };
  });
  const keys = new Set(documents.map(d => d.key));
  return { id: report?.id || "pending", createdAt: report?.createdAt || "", model: report?.model || "",
    documents, relations: (report?.relations || []).filter(r => keys.has(r.from) && keys.has(r.to)) };
}

/** Low-discrepancy disk layout keeps large collections inside the canvas. */
export function knowledgeDotPositions(count: number) {
  if (count <= 6) return knowledgePositions(count);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const radius = Math.sqrt((i + .5) / count), angle = i * goldenAngle;
    return { x: 320 + Math.cos(angle) * radius * 265, y: 230 + Math.sin(angle) * radius * 180 };
  });
}
