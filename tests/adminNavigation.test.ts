import test from 'node:test';
import assert from 'node:assert/strict';
import { adminPage, adminHref, tenantPages, platformPages } from '../src/admin/navigation.ts';
const tenant = '00000000-0000-4000-8000-000000000001';
test('admin surfaces retain distinct destinations and own defaults', () => {
  assert.equal(tenantPages.length, 8);
  assert.equal(platformPages.length, 10);
  assert.equal(adminPage('tenant', ''), 'overview');
  assert.equal(adminPage('platform', ''), 'overview');
  assert.equal(adminPage('tenant', '#admin=settings'), 'overview');
  assert.equal(adminPage('platform', '#admin=settings'), 'settings');
});
test('legacy destinations retain their business group', () => {
  for (const [hash, page] of Object.entries({
    '#manage=business&tab=spaces': 'members',
    '#manage=sources': 'database',
    '#manage=profiles': 'company',
    '#manage=business&tab=records': 'company',
    '#manage=operations': 'engine',
    '#admin=engine&detail=usage': 'usage',
    '#admin=usage': 'usage',
    '#view=library&scope=enterprise': 'materials',
    '#manage=experiences': 'experience',
  }))
    assert.equal(adminPage('tenant', hash), page);
});
test('customer admin keeps return context, platform does not carry tenant or client context', () => {
  const back = '#tenant=' + tenant + '&view=conversations';
  const hash = '#' + new URLSearchParams({ tenant, back, tab: 'members' });
  const enterprise = new URLSearchParams(adminHref('tenant', 'database', hash).slice(1));
  assert.equal(enterprise.get('tenant'), tenant);
  assert.equal(enterprise.get('back'), back);
  assert.equal(enterprise.get('tab'), null);
  const platform = new URLSearchParams(
    adminHref('platform', 'accounts', hash, { tenant, back, tab: 'query' }).slice(1),
  );
  assert.equal(platform.get('tenant'), null);
  assert.equal(platform.get('back'), null);
  assert.equal(platform.get('admin'), 'accounts');
});
