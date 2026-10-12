import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySources } from '../../scripts/skills/verify-sources.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dreamq-skill-sources-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'engine/skill-sources'), join(dir, 'engine/skill-sources'), { recursive: true });
  const path = join(dir, 'engine/skill-sources/sources.lock.json');
  return { dir, path, lock: JSON.parse(await readFile(path, 'utf8')) };
}
test('pinned preparation bundles verify without enabling runtime skills', async () => {
  const result = await verifySources(root);
  assert.equal(result.sources, 5);
  assert.equal(result.preparedBundles, 2);
  assert.equal(result.runtimeEnabled, false);
  assert.ok(result.verifiedFiles > 2);
});
test('modified upstream bytes are rejected', async (t) => {
  const { dir, lock } = await fixture(t);
  await writeFile(join(dir, lock.items[0].files[0].localPath), 'tampered');
  await assert.rejects(verifySources(dir), /hash mismatch/);
});
test('candidate cannot silently become enabled', async (t) => {
  const { dir, path, lock } = await fixture(t);
  lock.items[2].runtimeEnabled = true;
  await writeFile(path, JSON.stringify(lock));
  await assert.rejects(verifySources(dir), /invalid source entry/);
});
test('unpinned source URL is rejected', async (t) => {
  const { dir, path, lock } = await fixture(t);
  lock.items[0].files[0].url = lock.items[0].files[0].url.replace(lock.items[0].commit, 'main');
  await writeFile(path, JSON.stringify(lock));
  await assert.rejects(verifySources(dir), /unpinned URL/);
});
test('extra executable in source bundle is rejected', async (t) => {
  const { dir } = await fixture(t);
  await writeFile(join(dir, 'engine/skill-sources/upstream/install.sh'), 'echo unexpected');
  await assert.rejects(verifySources(dir), /unlisted upstream file/);
});
test('source file symlink is rejected', async (t) => {
  const { dir, lock } = await fixture(t);
  const path = join(dir, lock.items[0].files[0].localPath);
  await rm(path);
  await symlink(join(dir, 'engine/skill-sources/sources.lock.json'), path);
  await assert.rejects(verifySources(dir), /symlink/);
});
