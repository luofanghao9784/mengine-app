/** Scoped immutable evaluation evidence. A platform account never receives tenant cases. */
export interface Evidence {
  kind: 'TASK' | 'FEEDBACK' | 'MATERIAL_VERSION';
  id: string;
  revision: number;
  attempt: number;
}
export type Dimension = 'FACT' | 'CONTENT_QUALITY' | 'USER_EFFECT' | 'RUNTIME';
export interface Criterion {
  key: string;
  dimension: Dimension;
  strength: 'REQUIRED' | 'QUALITY' | 'PREFERENCE';
  check: 'EVIDENCE_AVAILABLE' | 'TASK_SUCCEEDED' | 'SYNTHETIC_EQUALS' | 'MANUAL';
  requirement: string;
}
export interface EvaluationContent {
  title: string;
  purpose: 'REGRESSION' | 'DEVELOPMENT';
  description: string;
  criteria: Criterion[];
  input: string;
  expected: string;
  observed: string;
  unknowns: string;
}
export type EvidenceMode = 'SYNTHETIC' | 'NO_MODEL' | 'VERIFICATION' | 'LIVE' | 'UNKNOWN';
export interface EvaluationAsset {
  id: string;
  tenantId: string | null;
  workspaceId: string | null;
  kind: 'STANDARD' | 'SAMPLE';
  revision: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  version: {
    id: string;
    revision: number;
    content: EvaluationContent;
    evidence: Evidence[];
    originKey: string;
    mode: EvidenceMode;
    createdAt: string;
  };
}
export interface EvaluationPage<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
}
export interface Finding {
  sampleVersion: string;
  criterion: string;
  dimension: Dimension;
  strength: Criterion['strength'];
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  basis: 'PROGRAM' | 'HUMAN' | 'MISSING';
  note: string;
}
export interface Judgment {
  sampleVersion: string;
  criterion: string;
  verdict: Finding['verdict'];
  note: string;
}
export interface Evaluation {
  id: string;
  tenantId: string | null;
  workspaceId: string | null;
  standardVersion: string;
  sampleVersions: string[];
  supersedes: string | null;
  evaluator: string;
  createdAt: string;
  validity: 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'DETAILS_UNAVAILABLE';
  modes: EvidenceMode[];
  uniqueOrigins: number;
  coverage: { dimension: Dimension; denominator: number; pass: number; fail: number; unknown: number }[];
  findings: Finding[];
  businessQuality: 'NOT_VALIDATED';
  adoptionDecision: 'NOT_MADE';
}
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'REVIEW' | 'CLOSED';
export type IssueOutcome = 'FIXED' | 'DUPLICATE' | 'NOT_REPRODUCIBLE' | 'ACCEPTED_TRADEOFF' | 'SUPERSEDED';
export interface IssueChange {
  status: IssueStatus;
  assignee: string | null;
  outcome: IssueOutcome | null;
  basis: 'HUMAN_CONFIRMATION' | null;
  note: string;
  evidence: Evidence[];
}
export interface EvaluationIssue {
  id: string;
  tenantId: string | null;
  workspaceId: string | null;
  sampleVersion: string;
  evaluationId: string | null;
  title: string;
  category: 'DATA' | 'CONTENT' | 'PREFERENCE' | 'TECHNICAL' | 'AUTHORIZATION' | 'METHOD';
  impact: string;
  nextAction: string;
  revision: number;
  status: IssueStatus;
  assignee: string | null;
  outcome: IssueOutcome | null;
  history: (IssueChange & { revision: number; actor: string; createdAt: string })[];
}
export interface EvidenceOption {
  evidence: Evidence;
  title: string;
  state: string;
  mode: EvidenceMode;
}
export interface EvidenceDetails {
  evidence: Evidence;
  mode: EvidenceMode;
  state: string;
  exact: boolean;
  sourceVersions: number;
  resourceCoverage: 'NOT_RECORDED' | 'ATTEMPT_LEDGER';
  costStatus: 'NOT_A_BILL';
  attempts: {
    attempt: number;
    mode: 'live' | 'verification';
    status: string;
    meteringEnabled: boolean;
    startedAt: string;
    finishedAt: string | null;
    registeredRequests: number;
    reportedUsage: number;
    pendingRequests: number;
    knownInputTokens: number | null;
    knownOutputTokens: number | null;
  }[];
}
/** No independent holdout claim: this first manual workspace exposes cases as regression/development only.
 * All source references are reauthorized on every read; revisions and source modes are server-derived.
 * A program success cannot satisfy business value, and a review cannot replace a program factual finding.
 * Coverage denominator is criterion observations; uniqueOrigins is separately deduplicated by source.
 * Pure synthetic equality only checks the submitted fixture; method comparisons separately execute methods.
 */
