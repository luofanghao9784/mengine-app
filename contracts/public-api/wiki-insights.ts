export interface InsightDocument {
  id: string;
  versionId: string;
  version: number;
  title: string;
  anchor: boolean;
  fragments: { id: string; locator: string; content: string }[];
}
export interface InsightEvidence {
  materialId: string;
  chunkId: string;
  quote: string;
}
export interface InsightPoint {
  text: string;
  evidence: InsightEvidence[];
}
export interface InsightReport {
  nodes: { materialId: string; summary: InsightPoint; takeaways: InsightPoint[] }[];
  synthesis: InsightPoint | null;
  relations: {
    from: string;
    to: string;
    kind: 'topic' | 'complement' | 'dependency' | 'sequence';
    reason: string;
    evidence: InsightEvidence[];
  }[];
  recommendations: { document: string; anchor: string; reason: string; evidence: InsightEvidence[] }[];
}
export type InsightMode = 'ANALYZE' | 'GRAPH' | 'RECOMMEND';
export interface WikiInsight {
  id: string;
  tenantId: string;
  conversationId: string;
  taskId: string;
  mode: InsightMode;
  status: string;
  executionClass: 'live' | 'verification' | null;
  modelName: string | null;
  documents: InsightDocument[];
  report: InsightReport | null;
}
