import { test, expect, type BrowserContext } from '@playwright/test';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = id(1),
  admin = id(2),
  member = id(3),
  execution = id(4);
async function fixture(context: BrowserContext, authorized = true, conflict = false) {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const person = {
    accountId: member,
    displayName: '合成后页成员',
    email: null,
    phone: '+8619900000001',
    role: 'MEMBER',
    status: 'ACTIVE',
    accountStatus: 'ACTIVE',
    version: 11,
  };
  let started = false;
  const result = () => ({
    execution: {
      id: execution,
      tenantId: tenant,
      kind: 'MEMBER_OFFBOARD',
      targetAccountId: member,
      state: 'ISOLATING',
      revision: 1,
      effectiveAt: '2026-10-04T00:00:00Z',
      deadline: '2026-11-03T00:00:00Z',
      completedAt: null,
      errorCode: null,
    },
    targetName: person.displayName,
    reason: '合成离职原因',
    policyKey: 'OFFBOARD_ISOLATION',
    policyRevision: 0,
    stopComplete: false,
    isolationComplete: false,
    materialsComplete: false,
    objectsComplete: false,
    cancelledAt: null,
    workerAttempts: 0,
    backupState: 'PENDING_VERIFICATION',
    canCancel: true,
    canRetry: true,
    exportGrants: [],
    materialProgress: null,
    coverage: ['合成范围说明'],
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    reads.push(url.pathname + url.search);
    const json = (v: unknown) => route.fulfill({ json: v });
    if (path.endsWith('/csrf')) return json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    if (path === '/api/v1/me')
      return json({
        account: { id: admin, displayName: '合成管理员', email: 'synthetic@example.test' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成企业', role: 'TENANT_ADMIN' }],
      });
    if (path.endsWith('/phone/configuration')) return json({ delivery: 'DISABLED', localPreview: false });
    if (path.endsWith('/governance'))
      return json({
        tenantId: tenant,
        ownerId: admin,
        revision: 0,
        owner: true,
        canConfigure: true,
        canEnterManagement: true,
        canAcceptInitialResponsibility: false,
        pendingHandover: null,
        capabilities: [],
      });
    if (path.endsWith('/overview'))
      return json({
        tenantId: tenant,
        name: '合成企业',
        version: 0,
        activeMemberCount: 2,
        disabledMemberCount: 0,
        sharedWorkspaceCount: 0,
        invitationDelivery: 'DISABLED',
      });
    if (path.endsWith('/members')) return json([person]);
    if (path.endsWith(`/members/${member}`))
      return json({
        tenantId: tenant,
        member: person,
        owner: false,
        canOffboard: authorized,
        offboarded: started,
        departureId: started ? execution : null,
      });
    if (path.endsWith('/departures/options'))
      return json({
        tenantRevision: 0,
        members: [],
        membersHaveMore: false,
        responsibilities: [],
        responsibilitiesHaveMore: false,
        canOffboard: authorized,
        canExit: true,
        selectedMember: url.searchParams.has('targetAccountId')
          ? { id: member, name: person.displayName, status: person.status, revision: person.version }
          : null,
        selectedOwner: false,
        currentExecutionId: started ? execution : null,
        isolationDays: 30,
      });
    if (path.endsWith('/departures/offboard')) {
      writes.push(route.request().postDataJSON());
      if (conflict)
        return route.fulfill({
          status: 409,
          json: { contractVersion: '1.0', code: 'DEPARTURE_REVISION_CONFLICT' },
        });
      started = true;
      person.status = 'DISABLED';
      return route.fulfill({ status: 201, json: result() });
    }
    if (path.endsWith(`/departures/${execution}`)) return json(result());
    if (path.endsWith('/departures')) return json({ items: [], hasMore: false });
    return route.fulfill({ status: 404, json: { code: 'UNAVAILABLE' } });
  });
  return { writes, reads };
}
test('member list opens detail, hides emergency action, and carries fixed selection into offboarding', async ({
  context,
  page,
}) => {
  const { writes } = await fixture(context);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=members`);
  await expect(page.getByRole('button', { name: '紧急安全停用', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '查看成员 合成后页成员' }).click();
  await expect(page.getByRole('heading', { name: '合成后页成员' })).toBeVisible();
  await expect(page.getByRole('button', { name: '紧急安全停用', exact: true })).not.toBeVisible();
  await page.getByRole('link', { name: '办理离职', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '离职员工' })).toHaveCount(0);
  await expect(page.getByText('当前私人内容隔离期为 30 天', { exact: false })).toBeVisible();
  await page.getByLabel('执行原因').fill('合成离职原因');
  await expect(page.getByRole('button', { name: '确认办理离职' })).toBeDisabled();
  await page.getByLabel('我已核对共享责任与正在发生的业务', { exact: false }).check();
  await page.setViewportSize({ width: 360, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/member-departure-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '确认办理离职' }).click();
  await expect(page.getByRole('heading', { name: '员工离职 · 合成后页成员 正在隔离' })).toBeVisible();
  expect(writes[0].targetAccountId).toBe(member);
  expect(writes[0].expectedMemberRevision).toBe(11);
  await page.reload();
  await expect(page.getByRole('heading', { name: '员工离职 · 合成后页成员 正在隔离' })).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复本企业身份' })).toBeDisabled();
});
test('offboarding authority stays explicit and company exit does not expose member actions', async ({
  context,
  page,
}) => {
  const { reads } = await fixture(context, false);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=members&detail=member&member=${member}`);
  await expect(page.getByText('正式离职需由已获离职办理资格的人员处理。')).toBeVisible();
  await expect(page.getByRole('link', { name: '办理离职', exact: true })).toHaveCount(0);
  await page.goto(`/tenant-admin/#tenant=${tenant}&admin=company&detail=retention`);
  await expect(page.getByRole('button', { name: '办理企业退出' })).toBeVisible();
  await expect(page.getByRole('button', { name: '办理员工离职' })).toHaveCount(0);
  expect(reads.some((p) => p.includes('/departures?') && p.includes('kind=TENANT_EXIT'))).toBe(true);
});

test('a confirmed conflict preserves the reason and error instead of losing them to parent refresh', async ({
  context,
  page,
}) => {
  await fixture(context, true, true);
  await page.goto(
    `/tenant-admin/#tenant=${tenant}&admin=members&detail=member&member=${member}&flow=offboard`,
  );
  await page.getByLabel('执行原因').fill('保留这次说明');
  await page.getByLabel('我已核对共享责任与正在发生的业务', { exact: false }).check();
  await page.getByRole('button', { name: '确认办理离职' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('执行原因')).toHaveValue('保留这次说明');
  await expect(page.getByRole('heading', { name: '员工离职 · 合成后页成员 正在隔离' })).toHaveCount(0);
});
