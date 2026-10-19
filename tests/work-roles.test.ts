import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkAudience, isWorkRoles } from '../src/identity/work-roles.ts';
const c = {
  version: '1.0',
  key: 'a'.repeat(32),
  role: 'MEMBER',
  roleLabel: '工作人员',
  department: '门店',
  jobTitle: '美容师',
  responsibilities: '核对预约',
  focus: ['SERVICE'],
  focusLabels: ['服务'],
  starters: ['今天先做什么？'],
  configured: true,
  authority: false,
};
test('personal role responses are bounded metadata, not authority grants', () => {
  assert.ok(isWorkAudience(c));
  for (const bad of [
    { ...c, authority: true },
    { ...c, role: 'SUPERUSER' },
    { ...c, starters: [null] },
    { ...c, focus: 'all' },
    { ...c, responsibilities: undefined },
  ])
    assert.ok(!isWorkAudience(bad));
});
test('member editor validates each row and catalog before rendering', () => {
  const p = {
    canMaintain: true,
    members: [
      {
        accountId: 'worker',
        name: '合成员工',
        systemRole: 'MEMBER',
        department: '门店',
        jobTitle: '美容师',
        responsibilities: '核对预约',
        focus: ['SERVICE'],
        revision: 1,
      },
    ],
    choices: [{ key: 'SERVICE', label: '服务', keywords: ['预约'], starter: '今天先做什么？' }],
  };
  assert.ok(isWorkRoles(p));
  assert.ok(!isWorkRoles({ ...p, members: [{ ...p.members[0], revision: -1 }] }));
  assert.ok(!isWorkRoles({ ...p, choices: [{ ...p.choices[0], keywords: [null] }] }));
});
