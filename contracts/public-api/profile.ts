/** Background data never changes access rights or creates a task/plan. */
export type ProfileScope = 'TENANT' | 'WORKSPACE' | 'PERSONAL';
export type ProfileKind = 'FACT' | 'INFERENCE' | 'GOAL' | 'PREFERENCE';
export type ProfileStatus = 'ACTIVE' | 'PROPOSED' | 'WITHDRAWN';
export interface ProfileValue {
  id: string; versionId: string; tenantId: string; scope: ProfileScope; subjectId: string; key: string; kind: ProfileKind;
  revision: number; value: string; provenance: string; status: ProfileStatus;
  effectiveStatus: ProfileStatus | 'EXPIRED'; expiresAt: string | null; changedBy: string; changedAt: string;
}
export interface ProfilePage {
  tenantId: string; scope: ProfileScope; subjectId: string; canMaintain: boolean;
  items: ProfileValue[]; hasMore: boolean; entries: ProfileEntryInfo[];
}
export interface ProfileContent {
  value: string; provenance: string; status: Exclude<ProfileStatus,'WITHDRAWN'>; expiresAt?: string | null;
}
export interface CreateProfile extends ProfileContent { requestId: string; key: string; kind: ProfileKind }
export interface SaveProfile extends ProfileContent { requestId: string; expectedRevision: number }
export interface WithdrawProfile { requestId: string; expectedRevision: number }

/** Minimal history keeps removed versions addressable without returning their body. */
export interface ProfileVersionInfo {
  versionId: string; revision: number; current: boolean; status: ProfileStatus;
  effectiveStatus: ProfileStatus | 'EXPIRED'; expiresAt: string | null; changedAt: string; bodyAvailable: boolean;
}
export interface ProfileHistory { canMaintain: boolean; items: ProfileVersionInfo[]; hasMore: boolean }

export interface ProfileEntryInfo { id: string; key: string; kind: ProfileKind; versionId: string; revision: number; bodyAvailable: boolean }
