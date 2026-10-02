import type { Membership } from '../../contracts/public-api/identity';
export function entryTenant(
  explicit: string | null,
  memberships: Membership[],
  remembered: string | null,
): string {
  if (explicit !== null) return explicit; // A revoked explicit destination must never silently switch enterprises.
  if (remembered && memberships.some((m) => m.tenantId === remembered)) return remembered;
  return memberships.length === 1 ? memberships[0].tenantId : '';
}
type Surface = 'workspace' | 'tenant-admin' | 'platform-admin';
const tenantKey = (account: string, surface: Surface) => `dreamcore-tab-tenant:${surface}:${account}`;

/** Navigation belongs to this tab and surface; the authentication cookie remains shared. */
export function rememberedTenant(
  account: string,
  surface: Surface = 'workspace',
  storage?: Storage,
): string | null {
  try {
    return (storage ?? sessionStorage).getItem(tenantKey(account, surface));
  } catch {
    return null;
  }
}
export function rememberTenant(
  account: string,
  tenant: string,
  surface: Surface = 'workspace',
  storage?: Storage,
) {
  try {
    (storage ?? sessionStorage).setItem(tenantKey(account, surface), tenant);
  } catch {
    /* Only a navigation preference; explicit destinations remain usable. */
  }
}
