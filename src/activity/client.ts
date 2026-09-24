import type { ActivityItem, ActivityPage } from '../../contracts/public-api/activity';
import { createIdentityRequest, IdentityError, record, text, uuid } from '../identity/client.ts';
export const isActivity = (v: unknown): v is ActivityItem =>
  record(v) &&
  uuid(v.id) &&
  uuid(v.workspaceId) &&
  text(v.workspaceName) &&
  (v.folderId === null || uuid(v.folderId)) &&
  uuid(v.materialId) &&
  Number.isSafeInteger(v.version) &&
  (v.version as number) > 0 &&
  text(v.filename) &&
  text(v.actorName) &&
  ['MATERIAL_UPLOADED', 'MATERIAL_UPDATED', 'DOCUMENT_PUBLISHED', 'DOCUMENT_UPDATED'].includes(
    String(v.kind),
  ) &&
  text(v.occurredAt) &&
  Number.isFinite(Date.parse(v.occurredAt));
export function createActivityClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    list(tenant: string, workspace: string | null, cursor: string | null, signal?: AbortSignal) {
      if (!uuid(tenant) || (workspace !== null && !uuid(workspace)))
        throw new IdentityError('INVALID_REQUEST', 400);
      const query = new URLSearchParams({ limit: '20' });
      if (workspace) query.set('workspace', workspace);
      if (cursor) query.set('cursor', cursor);
      return request(
        `/api/v1/tenants/${tenant}/activity?${query}`,
        'GET',
        (v): v is ActivityPage =>
          record(v) &&
          v.tenantId === tenant &&
          v.workspaceId === workspace &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          v.items.every((x) => isActivity(x) && (!workspace || x.workspaceId === workspace)) &&
          new Set(v.items.map((x) => x.id)).size === v.items.length &&
          (v.nextCursor === null ||
            (text(v.nextCursor) && v.nextCursor.length <= 100 && v.items.length === 20)),
        undefined,
        signal,
      );
    },
  };
}
export const activityClient = createActivityClient();
