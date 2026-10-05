import { createIdentityRequest, record } from '../identity/client';
export interface NewsSource {
  id: string;
  name: string;
  url: string;
  format: string;
  industry: string;
  region: string;
  enabled: boolean;
  revision: number;
  selected: boolean;
  lastStatus?: string | null;
  checkedAt?: string | null;
}
const source = (v: unknown): v is NewsSource =>
  record(v) &&
  typeof v.id === 'string' &&
  typeof v.name === 'string' &&
  typeof v.url === 'string' &&
  ['PAGE', 'RSS', 'ATOM'].includes(String(v.format)) &&
  typeof v.industry === 'string' &&
  typeof v.region === 'string' &&
  typeof v.enabled === 'boolean' &&
  typeof v.selected === 'boolean' &&
  Number.isInteger(v.revision);
const sources = (v: unknown): v is NewsSource[] => Array.isArray(v) && v.every(source);
export function newsClient(tenant?: string) {
  const request = createIdentityRequest();
  const path = tenant ? `/api/v1/tenants/${tenant}/news-sources` : '/api/platform-admin/v1/news-sources';
  return {
    list: (signal?: AbortSignal) => request(path, 'GET', sources, undefined, signal),
    save: (c: Omit<NewsSource, 'selected' | 'id'> & { id: string | null }) =>
      request(path, 'POST', source, c),
    select: (s: NewsSource, enabled: boolean) =>
      request(path, 'POST', sources, { sourceId: s.id, revision: s.revision, enabled }),
  };
}
