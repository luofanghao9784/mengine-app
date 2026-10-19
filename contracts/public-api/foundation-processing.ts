/** Read-only processing products, bound to the current source version and original ACL. */
export interface FoundationProcessing {
  assetId: string;
  name: string;
  version: number;
  revision: string;
  recordKind: 'DATASET_ROWS' | 'DOCUMENT_CHUNKS';
  recordCount: number;
  fields: { name: string; type: string; meaning: string; unit: string; origin: string; evidence: string }[];
  records: (string | null)[][];
  offset: number;
  hasMore: boolean;
  stages: {
    key: string;
    name: string;
    state: string;
    at: string | null;
    detail: string;
    outputs: string[];
    fields: string[];
  }[];
  history: {
    id: string;
    stage: string;
    state: string;
    createdAt: string;
    finishedAt: string | null;
    detail: string;
  }[];
  notes: string[];
}
