import { createIdentityRequest } from './client.ts';
export type WorkGoals = { governance: string; stage: string; followUp: string; formalReporting?: string; handoff?: string; indicators?: string; source?: string };
export type WorkRole = {
  accountId: string;
  name: string;
  systemRole: string;
  department: string;
  jobTitle: string;
  responsibilities: string;
  goals?: WorkGoals;
  focus: string[];
  revision: number;
};
export type Focus = { key: string; label: string; keywords: string[]; starter: string };
export type WorkRoles = { canMaintain: boolean; members: WorkRole[]; choices: Focus[] };
export type WorkAudience = {
  version: string;
  key: string;
  role: string;
  roleLabel: string;
  department: string;
  jobTitle: string;
  responsibilities: string;
  goals?: WorkGoals;
  focus: string[];
  focusLabels: string[];
  starters: string[];
  configured: boolean;
  authority: false;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string');
const role = (v: unknown): v is WorkRole =>
  record(v) &&
  [v.accountId, v.name, v.department, v.jobTitle, v.responsibilities].every((x) => typeof x === 'string') &&
  ['OWNER', 'ADMIN', 'MEMBER'].includes(String(v.systemRole)) &&
  strings(v.focus) &&
  Number.isSafeInteger(v.revision) &&
  Number(v.revision) >= 0;
export const isWorkAudience = (v: unknown): v is WorkAudience =>
  record(v) &&
  v.version === '1.0' &&
  typeof v.key === 'string' &&
  ['OWNER', 'ADMIN', 'MEMBER'].includes(String(v.role)) &&
  [v.roleLabel, v.department, v.jobTitle, v.responsibilities].every((x) => typeof x === 'string') &&
  [v.focus, v.focusLabels, v.starters].every(strings) &&
  typeof v.configured === 'boolean' &&
  v.authority === false;
export const isWorkRoles = (v: unknown): v is WorkRoles =>
  record(v) &&
  typeof v.canMaintain === 'boolean' &&
  Array.isArray(v.members) &&
  v.members.every(role) &&
  Array.isArray(v.choices) &&
  v.choices.every(
    (x) =>
      record(x) &&
      typeof x.key === 'string' &&
      typeof x.label === 'string' &&
      typeof x.starter === 'string' &&
      strings(x.keywords),
  );
const path = (tenant: string) => `/api/v1/tenants/${encodeURIComponent(tenant)}/work-roles`;
export const workRoles = {
  list: (tenant: string, signal?: AbortSignal) =>
    createIdentityRequest()(path(tenant), 'GET', isWorkRoles, undefined, signal),
  current: (tenant: string, signal?: AbortSignal) =>
    createIdentityRequest()(`${path(tenant)}/current`, 'GET', isWorkAudience, undefined, signal),
  save: (tenant: string, member: WorkRole, requestId: string) =>
    createIdentityRequest()(`${path(tenant)}/${encodeURIComponent(member.accountId)}`, 'POST', role, {
      requestId,
      expectedRevision: member.revision,
      department: member.department,
      jobTitle: member.jobTitle,
      responsibilities: member.responsibilities,
      focus: member.focus,
      goals: member.goals,
    }),
};
