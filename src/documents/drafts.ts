import type { Identity } from '../../contracts/public-api/identity';

// Session-level cleanup must happen before revoked membership unmounts the document reader.
// A failed network refresh is not proof of revocation; callers retain drafts in that case.
export function reconcileDocumentDrafts(identity: Identity | null, storage?: Storage) {
  try {
    const target = storage ?? sessionStorage;
    const prefixes =
      identity?.memberships.map((m) => `dreamcore:document:${identity.account.id}:${m.tenantId}:`) || [];
    for (const key of Object.keys(target))
      if (key.startsWith('dreamcore:document:') && !prefixes.some((prefix) => key.startsWith(prefix)))
        target.removeItem(key);
  } catch {
    /* Browser storage can be disabled. Server authorization remains authoritative. */
  }
}
