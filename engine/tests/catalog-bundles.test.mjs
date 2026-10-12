import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { TrustedCatalog, skillBundleDigest } from '../dist/runtime/catalog.js';
const ready = new Set(['artifact-transfer-v1', 'pptx-renderer-v1']),
  allowed = new Set(['run_javascript']);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dreamcore-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'ppt/refs'), { recursive: true });
  const content = {
    'ppt/SKILL.md': 'Use reviewed resources.',
    'ppt/LICENSE': 'MIT synthetic fixture',
    'ppt/refs/guide.md': 'Pinned guide.',
    'ppt/run.sh': 'exit 1',
  };
  const files = [];
  for (const [path, body] of Object.entries(content)) {
    await writeFile(join(root, path), body);
    files.push({
      path,
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
    });
  }
  const item = {
    id: 'ppt',
    version: '1.0.0',
    title: 'PPT',
    file: 'ppt/SKILL.md',
    source: 'https://github.com/example/skills',
    license: 'MIT',
    upstreamCommit: 'a'.repeat(40),
    tools: ['run_javascript'],
    requires: [...ready],
    files,
  };
  item.sha256 = skillBundleDigest(item);
  const save = () =>
    writeFile(join(root, 'manifest.json'), JSON.stringify({ version: '2.0', items: [item] }));
  await save();
  return { root, item, save, url: pathToFileURL(root + '/') };
}
test('bundle dependencies, tool gates, pinned resources and immutable metadata', async (t) => {
  const f = await fixture(t);
  assert.equal((await TrustedCatalog.load(f.url)).available(allowed).length, 0);
  const catalog = await TrustedCatalog.load(f.url, ready);
  assert.equal(catalog.available(new Set()).length, 0);
  assert.equal((await catalog.activate('ppt', '1.0.0', allowed)).instructions, 'Use reviewed resources.');
  assert.equal(await catalog.readResource('ppt', '1.0.0', 'ppt/refs/guide.md', allowed), 'Pinned guide.');
  const copy = catalog.available(allowed);
  copy[0].files[0].sha256 = '0'.repeat(64);
  assert.notEqual(catalog.items[0].files[0].sha256, copy[0].files[0].sha256);
  for (const path of ['ppt/run.sh', '../other.md', 'ppt/unlisted.md'])
    await assert.rejects(catalog.readResource('ppt', '1.0.0', path, allowed), {
      code: 'SKILL_RESOURCE_NOT_AVAILABLE',
    });
});
test('tampered supporting file blocks whole bundle and resource reads', async (t) => {
  const f = await fixture(t),
    catalog = await TrustedCatalog.load(f.url, ready);
  await writeFile(join(f.root, 'ppt/refs/guide.md'), 'Changed guide');
  await assert.rejects(catalog.activate('ppt', '1.0.0', allowed), { code: 'SKILL_INTEGRITY_FAILED' });
  await assert.rejects(catalog.readResource('ppt', '1.0.0', 'ppt/refs/guide.md', allowed), {
    code: 'SKILL_INTEGRITY_FAILED',
  });
});
test('symlinked resource directory and changed provenance are rejected', async (t) => {
  const f = await fixture(t),
    catalog = await TrustedCatalog.load(f.url, ready);
  await rm(join(f.root, 'ppt/refs'), { recursive: true });
  await symlink(f.root, join(f.root, 'ppt/refs'));
  await assert.rejects(catalog.activate('ppt', '1.0.0', allowed), { code: 'SKILL_INTEGRITY_FAILED' });
  f.item.license = 'MIT-0';
  await f.save();
  await assert.rejects(TrustedCatalog.load(f.url, ready), { code: 'INVALID_CATALOG' });
});
