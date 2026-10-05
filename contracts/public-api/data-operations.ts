export type DataOperationKind = 'CONNECTIONS' | 'MATERIALS';
export type DataOperationState = 'ALL' | 'READY' | 'PROCESSING' | 'ATTENTION' | 'NOT_STARTED' | 'STOPPED';
export interface DataOperationCounts {
  total: number;
  ready: number;
  processing: number;
  attention: number;
  notStarted: number;
  stopped: number;
}
export interface DataOperationTenant {
  tenantId: string;
  tenantName: string;
  tenantStatus: 'ACTIVE' | 'SUSPENDED';
  counts: DataOperationCounts;
  lastSuccessAt: string | null;
}
export interface DataOperationOverview {
  kind: DataOperationKind;
  query: string;
  state: DataOperationState;
  offset: number;
  checkedAt: string;
  matchedTenants: number;
  counts: DataOperationCounts;
  items: DataOperationTenant[];
  hasMore: boolean;
}
export const dataOperationDiagnostics = [
  'CONNECTION_UNAVAILABLE',
  'CONNECTION_UNCONFIGURED',
  'COLLECTION_TIMEOUT',
  'COLLECTION_INVALID_RESULT',
  'COLLECTION_ADAPTER_FAILED',
  'COLLECTION_INTERRUPTED',
  'OTHER',
  'PARSE_FAILED',
  'UNSUPPORTED_FORMAT',
  'PARTIAL_PARSE',
] as const;
export type DataOperationDiagnostic = (typeof dataOperationDiagnostics)[number];
export const dataOperationFormats = [
  'PDF',
  'DOCX',
  'XLSX',
  'CSV',
  'TXT',
  'MD',
  'JSON',
  'PPTX',
  'HTML',
  'OTHER',
] as const;
export interface DataOperationItem {
  format: (typeof dataOperationFormats)[number] | null;
  sizeBytes: number | null;
  version: number | null;
  datasetCount: number | null;
  rowCount: number | null;
  monitorKey: string;
  runId: string | null;
  stage:
    | 'NOT_STARTED'
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'READY'
    | 'FAILED'
    | 'INTERRUPTED'
    | 'PARTIAL'
    | 'UNSUPPORTED'
    | 'CANCELLED';
  configuration: 'READY' | 'UNAVAILABLE' | 'UNCONFIGURED' | null;
  category: Exclude<DataOperationState, 'ALL'>;
  diagnostic: DataOperationDiagnostic | null;
  createdAt: string;
  finishedAt: string | null;
  lastSuccessAt: string | null;
}
export interface DataOperationDetail {
  kind: DataOperationKind;
  state: DataOperationState;
  offset: number;
  checkedAt: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: 'ACTIVE' | 'SUSPENDED';
  counts: DataOperationCounts;
  items: DataOperationItem[];
  hasMore: boolean;
}
