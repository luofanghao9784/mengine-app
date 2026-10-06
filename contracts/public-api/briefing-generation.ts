export type GenerationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_DATA'
  | 'WAITING_RESOURCE'
  | 'WAITING_CAPABILITY'
  | 'SUCCEEDED'
  | 'NO_NEW_CONTENT'
  | 'FAILED'
  | 'CANCELLED'
  | 'AUTHORITY_REVOKED';
export interface GenerationBatch {
  id: string;
  workspaceId: string;
  trigger: string;
  businessType: string | null;
  status: GenerationStatus;
  reason: string | null;
  taskId: string | null;
  cardIds: string[];
  createdAt: string;
  finishedAt: string | null;
}
export interface GenerationPolicy {
  id: string;
  workspaceId: string;
  workspaceName: string;
  enabled: boolean;
  revision: number;
  reason: string | null;
}
export interface GenerationQuota {
  limit: number;
  /** Successful audited card deliveries in the current daily/reset window. */
  used: number;
  /** Pending batches and queued/running attempts temporarily hold slots. */
  reserved: number;
  remaining: number;
}
export interface GenerationState {
  /** Manual generation: daily 6 successful cards. */
  quota?: GenerationQuota;
  /** Independent automatic generation: daily 8 successful cards. */
  automaticQuota?: GenerationQuota;
  capabilities?: Record<string, { available: boolean; reason: string | null }>;
  policies: GenerationPolicy[];
  batches: GenerationBatch[];
}
