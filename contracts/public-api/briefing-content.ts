/** The model supplies prose; the platform supplies immutable verified chart values. */
export interface BriefingRow {
  group: string | null;
  displayGroup?: string; // presentation projection only; never stored as evidence
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
  chartLabels?: { groups: Record<string,string>; columns: Record<string,string>; unit?: string | null; range?: string | null } | null;
  cover?: { dataUrl: string; sourceUrl: string; sourceTitle: string } | null;
  artifactId: string;
  sha256: string;
  ruleTrace?: {
    status: 'RECORDED' | 'NOT_RECORDED';
    versions: { source: 'GLOBAL' | 'TENANT' | 'PERSONAL'; target: 'ALL' | 'BRIEFING'; revision: number }[];
  } | null;
  content: {
    fusion?: FusionEvidence | null;
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
      composition?: { rows: { group: string[]; value: string; records: number; sharePercent: string | null }[]; total: string; percentScale: 6 } | null;
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
      periodMode?: 'EXACT' | 'MONTH' | 'SUMMARY' | 'COMPOSITION' | null;
      timeZone?: string | null;
    } | null;
    calculationArtifactId: string | null;
    calculationSha256: string | null;
    generatedAt: string;
  };
}

export interface FusionEvidence {
  version: 'governed-graph-v1';
  sources: { alias:string; name:string; datasetId:string; snapshotId:string; sha256:string; rowCount:number }[];
  relations: {from:string; to:string; id:string; name:string; local:string[]; foreign:string[]; targetFingerprint:string}[];
  results: {metricId:string; label:string; unit:string; total:string; dimensions:string[]; groups:{dimensions:(string|null)[];value:string;records:number}[]; baseRecords:number; includedRecords:number; unmatched:Record<string,number>; datasets:string[]}[];
  dimensionName:string;
  dimensionLabels:Record<string,string>;
  boundary:string;
}
