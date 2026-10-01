export interface MethodConfiguration {
  relevanceWeight: number;
  recencyWeight: number;
  importanceWeight: number;
}
export interface MethodVersion {
  id: string;
  familyId: string;
  number: number;
  baseVersion: string | null;
  configuration: MethodConfiguration | null;
  configurationSha: string;
  compatibility: 'ranking-v1';
  rationale: string;
  published: boolean;
  bodyAvailable: boolean;
  createdAt: string;
}
export interface MethodFamily {
  id: string;
  kind: 'RANKING_V1';
  title: string;
  revision: number;
  headVersion: string | null;
  publishedVersion: string | null;
  versions: MethodVersion[];
}
export interface MethodComparison {
  id: string;
  candidateVersion: string;
  baselineVersion: string | null;
  standardVersion: string;
  sampleVersions: string[];
  cases: {
    sampleVersion: string;
    expected: string[];
    baseline: string[];
    candidate: string[];
    baselinePass: boolean;
    candidatePass: boolean;
  }[];
  denominator: number;
  baselinePass: number;
  candidatePass: number;
  conclusion: 'IMPROVED_ON_SAMPLES' | 'NO_CHANGE' | 'REGRESSION' | 'TRADEOFF';
  validity: 'CURRENT' | 'STALE' | 'DETAILS_UNAVAILABLE';
  mode: 'SYNTHETIC';
  businessQuality: 'NOT_VALIDATED';
  createdAt: string;
}
export interface MethodRef {
  versionId: string | null;
  adoptionRevision: number;
  scope: 'BUILTIN' | 'TENANT' | 'WORKSPACE';
  workspaceId: string | null;
  configurationSha: string;
}
export interface MethodAdoption {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  revision: number;
  status: 'ACTIVE' | 'STOPPED';
  versionId: string;
  effectiveFallback: 'BUILTIN' | 'TENANT_THEN_BUILTIN';
  history: {
    revision: number;
    action: 'ADOPT' | 'STOP' | 'ROLLBACK';
    versionId: string;
    actor: string;
    createdAt: string;
  }[];
}
export interface MethodSelection {
  adoption: MethodAdoption | null;
  effective: MethodRef;
  configuration: MethodConfiguration;
  canAdopt: boolean;
  adoptedVersion: MethodVersion | null;
}
/** rank receives <=1000 fully authorized candidates before pagination. Features are finite [0,1].
 * Weights are finite [0,100], positive sum, normalized for score. Default .55/.25/.20.
 * Order: score DESC, createdAt DESC, UUID string ASC. Workspace ACTIVE > tenant ACTIVE > builtin.
 * Platform publication does not adopt. Manual adoption accepts explicit synthetic-only limitations.
 * Stopping a workspace selection falls back to tenant/builtin; rollback never replays business tasks.
 * Callers bind full pool, preferences and MethodRef snapshot to pagination; changed snapshots refresh.
 */
