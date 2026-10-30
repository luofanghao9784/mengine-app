import test from 'node:test';
import assert from 'node:assert/strict';
import { roleLabel } from '../src/identity/role-labels.ts';

test('角色身份只映射已知中文值，负责人和总部优先于成员角色', () => {
  assert.equal(roleLabel({ role: 'OWNER' }), '企业负责人');
  assert.equal(roleLabel({ role: 'TENANT_ADMIN', owner: true, canConfigure: false }), '企业负责人');
  assert.equal(roleLabel({ role: 'TENANT_ADMIN' }), '企业管理员');
  assert.equal(roleLabel({ role: 'ADMIN' }), '企业管理员');
  assert.equal(roleLabel({ role: 'TENANT_ADMIN', canConfigure: false }), '企业管理员（权限受限）');
  assert.equal(roleLabel({ role: 'MEMBER' }), '成员');
  assert.equal(roleLabel({ role: 'MEMBER', canMaintain: true }), '成员 · 可维护空间');
  assert.equal(roleLabel({ role: 'OWNER', platformAdmin: true }), '总部管理员');
  assert.equal(roleLabel({ realm: 'platform' }), '总部管理员');
  assert.equal(roleLabel({ realm: 'agent' }), '总部管理员');
  assert.equal(roleLabel({ role: 'UNKNOWN_ROLE', canMaintain: true }), undefined);
  assert.equal(roleLabel({}), undefined);
});
