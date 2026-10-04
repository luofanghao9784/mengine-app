import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsClient } from '../src/platform/settings-client.ts';
import { IdentityError } from '../src/identity/client.ts';
test('password change uses platform CSRF and a one-time body without replay on lost response', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const api = createSettingsClient(async (path, init) => {
    calls.push({ path: String(path), init });
    if (String(path).endsWith('/csrf'))
      return Response.json({ token: 'platform-only', headerName: 'X-CSRF-TOKEN' });
    throw new TypeError('synthetic lost response');
  });
  await assert.rejects(
    api.password('old-synthetic', 'new-synthetic'),
    (e: unknown) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/platform-admin/v1/auth/csrf');
  assert.equal(calls[1].path, '/api/platform-admin/v1/auth/password');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    currentPassword: 'old-synthetic',
    password: 'new-synthetic',
  });
});
test('records reject invalid outcome/category, timestamp and unsafe identity ids', async () => {
  const record = {
    id: 1,
    category: 'SECURITY',
    action: 'PLATFORM_LOGIN',
    outcome: 'SUCCESS',
    actorId: null,
    actorName: null,
    targetId: null,
    targetName: null,
    tenantId: null,
    tenantName: null,
    createdAt: '2026-10-04T00:00:00Z',
    internalReason: null,
    publicReason: null,
  };
  for (const invalid of [
    { category: 'CONVERSATIONS' },
    { createdAt: 'unknown' },
    { outcome: 'PENDING' },
    { targetId: '../customer' },
  ]) {
    const api = createSettingsClient(async () => Response.json([{ ...record, ...invalid }]));
    await assert.rejects(
      api.records('', '', 0),
      (e: unknown) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  }
  assert.deepEqual(await createSettingsClient(async () => Response.json([record])).records('', '', 0), [
    record,
  ]);
  const experience = {
    ...record,
    category: 'EXPERIENCE',
    action: 'GENERAL_EXPERIENCE_STOP',
    internalReason: '合成原因',
  };
  assert.deepEqual(
    await createSettingsClient(async () => Response.json([experience])).records('EXPERIENCE', '', 0),
    [experience],
  );
});
