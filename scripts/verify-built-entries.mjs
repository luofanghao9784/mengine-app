import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// An HTTP 200 can be an SPA fallback. Require each real entry and its assets.
for (const entry of ['workspace', 'tenant-admin', 'tenant-admin/prototype', 'tenant-admin/support', 'platform-admin']) {
  const file = resolve('dist', entry, 'index.html');
  assert.ok(existsSync(file), `Missing production entry: ${entry}`);
  const html = readFileSync(file, 'utf8');
  assert.ok(!html.includes('src="/src/'), `Unbuilt entry: ${entry}`);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)];
  assert.ok(assets.length > 0, `No built assets: ${entry}`);
  for (const [, asset] of assets) assert.ok(existsSync(resolve('dist', asset.slice(1))), `Missing asset: ${asset}`);
}
const scene = readFileSync('dist/tenant-admin/prototype/index.html', 'utf8');
assert.ok(!scene.includes('data-surface="tenant-admin"'), 'Scene entry must not render the enclosing tenant shell');
console.log('Production entries and referenced assets verified.');
