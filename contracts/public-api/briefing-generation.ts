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
  used: number;
  reserved: number;
  remaining: number;
}
export interface GenerationState {
  quota?: GenerationQuota;
  capabilities?: Record<string, { available: boolean; reason: string | null }>;
  policies: GenerationPolicy[];
  batches: GenerationBatch[];
}
