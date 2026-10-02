import { rememberTenant, rememberedTenant } from '../src/identity/entry.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { managementHref, returnToWorkspaceHref, workspaceReturnHash } from '../src/identity/navigation.ts';
import {
  readViewState,
  reconcileViewStates,
  viewStateKey,
  writeViewState,
} from '../src/shared/view-state.ts';

const tenant = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const space = '30000000-0000-4000-8000-000000000001';
class TabStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}
test('management navigation keeps the selected enterprise and workspace; return strips content and secrets', () => {
  const source = `#tenant=${tenant}&view=library&scope=${space}&q=private+words&invite=secret`;
  const href = managementHref('tenant-admin', tenant, source);
  const target = new URL(href, 'https://workspace.example');
  const params = new URLSearchParams(target.hash.slice(1));
  assert.equal(params.get('tenant'), tenant);
  assert.equal(params.get('scope'), space);
  assert.equal(params.get('manage'), null);
  assert.equal(
    returnToWorkspaceHref(target.hash, tenant),
    `/workspace/#tenant=${tenant}&view=library&scope=${space}`,
  );
  assert.ok(!href.includes('secret') && !href.includes('private'));
});
test('return references cannot redirect externally, cross enterprise, or restore retired experience routes', () => {
  for (const back of [
    'https://attacker.example',
    `#tenant=${other}&view=conversations`,
    `#tenant=${tenant}&view=experiences`,
  ]) {
    const hash = '#' + new URLSearchParams({ tenant, back });
    assert.equal(returnToWorkspaceHref(hash, tenant), `/workspace/#tenant=${tenant}&view=briefing`);
  }
  assert.equal(workspaceReturnHash('#tenant=invalid&view=briefing', 'invalid'), undefined);
});
test('return preserves exact conversation and cited task versions without accepting arbitrary parameters', () => {
  const hash = `#tenant=${tenant}&view=conversations&conversation=${space}&task=${other}&briefingRevision=4&briefingAttempt=2&from=briefing&prompt=not-in-url`;
  const actual = workspaceReturnHash(hash, tenant)!;
  assert.ok(actual.includes('briefingRevision=4') && actual.includes('briefingAttempt=2'));
  assert.ok(actual.includes('task=' + other) && actual.includes('from=briefing'));
  assert.ok(!actual.includes('prompt'));
});
test('tab view state survives navigation but is isolated by account/tenant and purged on revocation/logout', () => {
  const storage = new TabStorage();
  const current = viewStateKey('alice', tenant, 'library');
  const revoked = viewStateKey('alice', other, 'library');
  const foreign = viewStateKey('bob', tenant, 'library');
  const valid = (v: unknown): v is string => typeof v === 'string';
  for (const key of [current, revoked, foreign]) writeViewState(key, 'saved position', storage);
  storage.setItem('unrelated', 'retain');
  reconcileViewStates('alice', [tenant], storage);
  assert.equal(readViewState(current, '', valid, storage), 'saved position');
  assert.equal(readViewState(foreign, '', valid, storage), '');
  assert.equal(readViewState(revoked, '', valid, storage), '');
  writeViewState(revoked, 'late callback', storage);
  assert.equal(storage.getItem(revoked), null);
  storage.setItem(current, '{broken');
  assert.equal(readViewState(current, 'fallback', valid, storage), 'fallback');
  reconcileViewStates(null, [], storage);
  writeViewState(current, 'late cleanup', storage);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem('unrelated'), 'retain');
});

test('last enterprise is isolated by surface, tab and account instead of a shared browser preference', () => {
  const clientTab = new TabStorage(),
    managementTab = new TabStorage();
  rememberTenant('alice', tenant, 'workspace', clientTab);
  rememberTenant('alice', other, 'tenant-admin', clientTab);
  rememberTenant('alice', other, 'workspace', managementTab);
  assert.equal(rememberedTenant('alice', 'workspace', clientTab), tenant);
  assert.equal(rememberedTenant('alice', 'tenant-admin', clientTab), other);
  assert.equal(rememberedTenant('alice', 'workspace', managementTab), other);
  assert.equal(rememberedTenant('bob', 'workspace', clientTab), null);
});
