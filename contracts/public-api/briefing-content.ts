/** The model supplies prose; the platform supplies immutable verified chart values. */
export interface BriefingRow {
  group: string | null;
  baseline: string | null;
  current: string | null;
  difference: string | null;
  changePercent: string | null;
  baselineRank: number | null;
  currentRank: number | null;
  issue: string | null;
}
export interface BriefingDocument {
  artifactId: string;
  sha256: string;
  content: {
    schemaVersion: 'briefing-data-v1' | 'briefing-text-v1';
    businessType: 'INFO' | 'DATA' | 'INSIGHT' | 'SUGGESTION' | 'RESULT';
    title: string;
    summary: string;
    analysis: string[];
    chart: {
      type: 'GROUPED_BAR';
      metric: string;
      unit: string;
      baseline: string;
      current: string;
      range: string;
      rows: BriefingRow[];
      totals: BriefingRow;
    } | null;
    source: {
      id: string;
      materialId: string;
      versionId: string;
      version: number;
      filename: string;
      sha256: string;
      scopeExcerpt: string;
    } | null;
    calculationArtifactId: string | null;
    calculationSha256: string | null;
    generatedAt: string;
  };
}
