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
/** Bounded composition; paragraph references reuse verified editorial content, never executable code. */
export interface BriefingPresentation {
  version: 'briefing-presentation-v1';
  layout: 'EDITORIAL' | 'KEY_METRIC' | 'STEPS' | 'COMPARISON' | 'SOURCE';
  chartStyle: 'GROUPED_BAR' | 'DUMBBELL' | 'DELTA_BAR' | 'CURRENT_BAR' | 'TABLE' | null;
  focusGroup: string | null;
  focusValue: 'CURRENT' | 'DIFFERENCE' | 'CHANGE_PERCENT' | null;
  sections: {
    role: 'OBSERVATION' | 'INTERPRETATION' | 'ACTION' | 'OPTION' | 'CAUTION';
    paragraphIndex: number;
  }[];
}
export interface BriefingDocument {
  cover?: { dataUrl: string; sourceUrl: string; sourceTitle: string } | null;
  artifactId: string;
  sha256: string;
  ruleTrace?: {
    status: 'RECORDED' | 'NOT_RECORDED';
    versions: { source: 'GLOBAL' | 'TENANT' | 'PERSONAL'; target: 'ALL' | 'BRIEFING'; revision: number }[];
  } | null;
  content: {
    schemaVersion: 'briefing-data-v1' | 'briefing-text-v1' | 'briefing-dataset-v1';
    businessType: 'INFO' | 'DATA' | 'INSIGHT' | 'SUGGESTION' | 'RESULT';
    title: string;
    summary: string;
    analysis: string[];
    presentation?: BriefingPresentation | null;
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
    datasetSource?: {
      datasetId: string;
      snapshotId: string;
      version: number;
      name: string;
      sha256: string;
      rowCount: number;
      collectedAt: string;
      coverageThrough: string | null;
    } | null;
    datasetBasis?: {
      groupColumn: string;
      periodColumn: string;
      matchedRows: number;
      ignoredRows: number;
      periodMode?: 'EXACT' | 'MONTH' | 'SUMMARY' | null;
      timeZone?: string | null;
    } | null;
    calculationArtifactId: string | null;
    calculationSha256: string | null;
    generatedAt: string;
  };
}
