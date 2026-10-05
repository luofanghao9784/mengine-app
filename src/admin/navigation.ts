export type AdminRealm = 'tenant' | 'platform';
export const tenantPages = [
  'overview',
  'engine',
  'members',
  'database',
  'materials',
  'experience',
  'company',
] as const;
export const platformPages = [
  'overview',
  'tenants',
  'accounts',
  'data',
  'database',
  'materials',
  'engine',
  'experience',
  'capabilities',
  'usage',
] as const;
export type AdminPage = (typeof tenantPages)[number] | (typeof platformPages)[number] | 'settings';
const legacyTenant: Record<string, AdminPage> = {
  business: 'members',
  duties: 'members',
  sources: 'database',
  profiles: 'company',
  configuration: 'company',
  experiences: 'experience',
  evaluation: 'experience',
  attention: 'experience',
  operations: 'engine',
  'content-lifecycle': 'materials',
  retention: 'company',
  methods: 'company',
};
export function adminPage(realm: AdminRealm, hash: string): AdminPage {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const pages: readonly string[] = realm === 'tenant' ? tenantPages : [...platformPages, 'settings'];
  const selected = params.get('admin');
  if (
    realm === 'platform' &&
    (selected === 'data' || (selected === 'engine' && params.get('detail') === 'data'))
  )
    return params.get('kind') === 'MATERIALS' ? 'materials' : 'database';
  if (realm === 'platform' && selected === 'engine' && params.get('detail') === 'storage')
    return 'capabilities';
  if (selected && pages.includes(selected)) return selected as AdminPage;
  if (realm === 'tenant' && ['records', 'settings'].includes(params.get('tab') || '')) return 'company';
  if (realm === 'tenant' && params.get('tab') === 'operations') return 'engine';
  if (realm === 'tenant' && params.get('view') === 'library') return 'materials';
  if (realm === 'tenant') return legacyTenant[params.get('manage') || ''] || 'overview';
  const old = params.get('tab');
  return old === 'operations'
    ? 'engine'
    : old === 'methods'
      ? 'capabilities'
      : old === 'evaluation'
        ? 'experience'
        : old === 'tenants'
          ? 'tenants'
          : 'overview';
}
/** Only the customer admin realm carries a customer tenant and return context. */
export function adminHref(
  realm: AdminRealm,
  page: AdminPage,
  hash: string,
  extra: Record<string, string> = {},
) {
  const old = new URLSearchParams(hash.replace(/^#/, ''));
  const next = new URLSearchParams({ admin: page });
  if (realm === 'tenant')
    for (const key of ['tenant', 'back', 'support']) if (old.has(key)) next.set(key, old.get(key)!);
  for (const [key, value] of Object.entries(extra))
    if (!['tenant', 'back', 'admin'].includes(key)) next.set(key, value);
  return '#' + next;
}
