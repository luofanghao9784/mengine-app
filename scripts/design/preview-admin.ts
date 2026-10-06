/**
 * Visual preview of the tenant admin and platform console with synthetic API responses.
 * No backend, model or customer data. Usage:
 *   node --experimental-strip-types scripts/design/preview-admin.ts [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium, type BrowserContext } from 'playwright';
import { telemetryChannels } from '../../contracts/public-api/engine-telemetry.ts';
import { withVite } from './serve.ts';

const port = Number(process.env.PREVIEW_PORT ?? 5195);
const out = process.argv[2] ?? '.local/design-preview/admin';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  person = id(2);
const now = '2026-10-06T01:30:00Z';
const names = ['林知', '周叙', '许棠', '陈默', '宋一', '韩青'];
const members = names.map((displayName, i) => ({
  accountId: id(30 + i),
  displayName,
  phone: `+86199000000${String(10 + i)}`,
  email: null,
  role: i === 0 ? 'TENANT_ADMIN' : 'MEMBER',
  status: i === 5 ? 'DISABLED' : 'ACTIVE',
  accountStatus: 'ACTIVE',
  version: 0,
}));
const tenants = ['合成健身', '合成餐饮', '合成零售', '合成教育'].map((name, i) => ({
  id: id(1 + i * 100),
  name,
  status: i === 3 ? 'SUSPENDED' : 'ACTIVE',
  createdAt: '2026-09-2' + i + 'T02:00:00Z',
  activeMemberCount: [12, 34, 8, 21][i],
  owner: { state: 'ASSIGNED', accountId: id(30 + i), name: names[i] },
  version: 0,
}));

async function mock(context: BrowserContext) {
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/platform-admin/v1/auth/me')
      return json({ account: { id: person, email: 'platform@example.test', displayName: '平台管理员' }, platformAdmin: true, memberships: [] });
    if (path === '/api/v1/me')
      return json({
        account: { id: person, email: null, phone: '+8619900000002', displayName: '林知' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成健身', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: person,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path === '/api/platform-admin/v1/overview')
      return json({
        totalTenants: 4,
        activeTenants: 3,
        suspendedTenants: 1,
        platform: 'AVAILABLE',
        database: 'AVAILABLE',
        invitationDelivery: 'DISABLED',
        checkedAt: now,
      });
    if (path.endsWith('/overview'))
      return json({
        tenantId: tenant,
        name: '合成健身',
        version: 0,
        activeMemberCount: 5,
        disabledMemberCount: 1,
        sharedWorkspaceCount: 3,
        invitationDelivery: 'DISABLED',
      });
    if (path.endsWith('/engine-telemetry')) {
      const scoped = path.includes('/tenants/');
      return json({
        tenantId: scoped ? tenant : null,
        checkedAt: now,
        recentSeconds: 300,
        evolution: 'NOT_CONNECTED',
        channels: telemetryChannels
          .filter((c) => !scoped || c !== 'GENERAL_ADJUSTMENT')
          .map((code, i) => ({
            code,
            running: [3, 2, 4, 6, 1, 2, 1, 0, 5, 1][i] ?? 0,
            queued: [5, 7, 1, 3, 0, 1, 0, 1, 0, 0][i] ?? 0,
            waiting: code === 'COMPANY' ? 2 : 0,
            unknown: code === 'EXPERIENCE' ? 1 : 0,
            failed: code === 'KNOWLEDGE' ? 1 : 0,
            completedRecent: [14, 9, 21, 17, 2, 4, 1, 0, 26, 3][i] ?? 0,
            lastCompletedAt: now,
          })),
      });
    }
    if (path.endsWith('/members')) return json(members);
    if (path.endsWith('/invitations')) return json([]);
    if (path.endsWith('/workspaces'))
      return json(
        ['运营管理中心', '职能保障中心', '门店培训'].map((name, i) => ({
          id: id(60 + i),
          tenantId: tenant,
          name,
          kind: 'SHARED',
          version: 0,
          memberCount: [5, 3, 4][i],
          ownerId: members[i].accountId,
          ownerName: members[i].displayName,
          description: '',
        })),
      );
    if (path.endsWith('/tenants') || path.includes('/tenants?')) return json(tenants);
    if (path.endsWith('/staff'))
      return json([{ id: person, displayName: '平台管理员', loginName: 'platform@example.test', status: 'ACTIVE', administrator: true, version: 0 }]);
    if (process.env.PREVIEW_DEBUG) console.log('unmocked', path + url.search);
    return route.fulfill({ status: 404, json: { contractVersion: '1.0', code: 'UNAVAILABLE' } });
  });
}

const shots: [string, string][] = [
  ['tenant-overview', `/tenant-admin/#tenant=${tenant}`],
  ['tenant-members', `/tenant-admin/#tenant=${tenant}&admin=members`],
  ['platform-overview', `/platform-admin/`],
  ['platform-enterprises', `/platform-admin/#admin=tenants`],
  ['platform-engine', `/platform-admin/#admin=engine`],
  ['tenant-engine', `/tenant-admin/#tenant=${tenant}&admin=engine`],
];
await withVite(port, async (base) => {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, path] of shots) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await mock(context);
    const page = await context.newPage();
    await page.goto(base + path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}.png` });
    await context.close();
  }
  await browser.close();
  console.log('Screenshots saved to', out);
});
