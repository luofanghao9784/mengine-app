import type { Identity } from '../../contracts/public-api/identity.ts';
import { createIdentityRequest, record, text, uuid } from './client.ts';

type AgentIdentity = { accountId: string; displayName: string; roles: string[] };
const isAgentIdentity = (value: unknown): value is AgentIdentity =>
  record(value) &&
  uuid(value.accountId) &&
  text(value.displayName) &&
  Array.isArray(value.roles) &&
  value.roles.every(text) &&
  value.roles.includes('AGENT_ADMIN');

/** The isolated agent realm returns its own identity DTO, without customer memberships. */
const toSessionIdentity = (value: AgentIdentity): Identity => ({
  account: { id: value.accountId, displayName: value.displayName, email: null },
  platformAdmin: false,
  memberships: [],
});

export function createAgentIdentityClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    me: async (signal?: AbortSignal) =>
      toSessionIdentity(
        await request('/api/agent-admin/v1/auth/me', 'GET', isAgentIdentity, undefined, signal),
      ),
    login: async (username: string, password: string) =>
      toSessionIdentity(
        await request('/api/agent-admin/v1/auth/login', 'POST', isAgentIdentity, { username, password }),
      ),
    logout: () => request('/api/agent-admin/v1/auth/logout', 'POST', (v): v is null => v === null),
  };
}
