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
export function rememberedTenant(account: string): string | null {
  try {
    return localStorage.getItem('dreamcore-last-tenant:' + account);
  } catch {
    return null;
  }
}
export function rememberTenant(account: string, tenant: string) {
  try {
    localStorage.setItem('dreamcore-last-tenant:' + account, tenant);
  } catch {
    /* Only a navigation preference. */
  }
}
