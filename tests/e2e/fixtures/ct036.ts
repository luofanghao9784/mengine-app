import { expect, type Page } from '@playwright/test';

// Synthetic identities and explicitly mocked read responses only; no real execution or results.
export const tenant = '00000000-0000-4000-8000-000000000036';
export const other = '00000000-0000-4000-8000-000000000037';
export const account = '00000000-0000-4000-8000-000000000038';
type OpenedReply = {
  status?: number;
  items?: { enterpriseFunction: string; displayName: string }[];
  networkError?: boolean;
};
export const openedItem = { enterpriseFunction: 'quality-check', displayName: '质量检查' };
export async function fixture(
  page: Page,
  mode: 'member' | 'anonymous' | 'no-member' = 'member',
  reply: OpenedReply = { items: [openedItem] },
) {
  const requests: { path: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, method: route.request().method() });
    const t = path.includes(other) ? other : tenant;
    if (path === '/api/tenant-admin/v1/opened-capabilities') {
      expect(new URL(route.request().url()).search).toBe('');
      if (reply.networkError) return route.abort('failed');
      return route.fulfill({ status: reply.status ?? 200, json: { items: reply.items ?? [] } });
    }
    if (path === '/api/v1/me') {
      if (mode === 'anonymous') return route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } });
      return route.fulfill({
        json: {
          account: { id: account, phone: '+8619900000036', email: null, displayName: '合成成员' },
          platformAdmin: false,
          memberships:
            mode === 'no-member'
              ? []
              : [
                  { tenantId: tenant, tenantName: '合成企业甲', role: 'TENANT_ADMIN' },
                  { tenantId: other, tenantName: '合成企业乙', role: 'TENANT_ADMIN' },
                ],
        },
      });
    }
    if (path.endsWith('/phone/configuration'))
      return route.fulfill({ json: { delivery: 'DISABLED', localPreview: false } });
    if (path.endsWith('/governance'))
      return route.fulfill({
        json: {
          tenantId: t,
          ownerId: account,
          revision: 1,
          owner: true,
          canConfigure: true,
          canEnterManagement: true,
          canAcceptInitialResponsibility: false,
          pendingHandover: null,
          capabilities: [],
        },
      });
    if (path.endsWith('/business-status'))
      return route.fulfill({
        json: { tenantId: t, businessEnabled: true, canExport: false, exitState: null, exportDeadline: null },
      });
    if (path.endsWith('/workspace/notifications'))
      return route.fulfill({ json: { tenantId: t, conversations: false, briefing: false } });
    // Existing native plugin requests may fail; the new opened section must still be visible.
    return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  return { requests, errors };
}
