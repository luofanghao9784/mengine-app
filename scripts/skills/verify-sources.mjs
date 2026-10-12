import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const prepared = new Set(['pptx-generator', 'web-dashboard']);
const expected = new Set([...prepared, 'personal-space-organizer', 'infographic', 'meeting-minutes']);
const digest = /^[a-f0-9]{64}$/;
const safePath = (value) => typeof value === 'string' && value.length > 0 &&
  !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..');
const fail = (message) => { throw new Error(`SKILL_SOURCE_INVALID: ${message}`); };

/** Offline provenance/integrity check only. Never installs or executes upstream code. */
export async function verifySources(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const base = resolve(root, 'engine/skill-sources');
  const regular = async (path) => {
    const full = resolve(root, path);
    if (!full.startsWith(resolve(root) + sep)) fail(`outside root: ${path}`);
    let current = resolve(root);
    for (const part of relative(root, full).split(sep)) {
      current = resolve(current, part);
      if ((await lstat(current)).isSymbolicLink()) fail(`symlink: ${path}`);
    }
    if (!(await lstat(full)).isFile()) fail(`not a file: ${path}`);
    return readFile(full);
  };
  const lock = JSON.parse(await regular('engine/skill-sources/sources.lock.json'));
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.items) || lock.items.length !== expected.size)
    fail('manifest schema');
  const seen = new Set(), localPaths = new Set();
  for (const item of lock.items) {
    if (!expected.has(item.id) || seen.has(item.id) || item.runtimeEnabled !== false ||
        !/^[a-f0-9]{40}$/.test(item.commit) ||
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.repository) ||
        !Array.isArray(item.files) || !item.files.length) fail('invalid source entry');
    seen.add(item.id);
    const isPrepared = prepared.has(item.id);
    if (item.stage !== (isPrepared ? 'source-prepared' : 'candidate')) fail(`stage: ${item.id}`);
    if (item.id === 'personal-space-organizer') {
      if (item.license !== null || item.licenseStatus !== 'review-required') fail('organizer license unresolved');
    } else if (!['MIT', 'MIT-0', 'Apache-2.0'].includes(item.license) || item.licenseStatus !== 'declared') {
      fail(`license: ${item.id}`);
    }
    const paths = new Set();
    for (const file of item.files) {
      if (!safePath(file.upstreamPath) || paths.has(file.upstreamPath) || !digest.test(file.sha256) ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 1) fail(`file metadata: ${item.id}`);
      paths.add(file.upstreamPath);
      const rawRoot = item.repository.replace('https://github.com/', 'https://raw.githubusercontent.com/');
      if (file.url !== `${rawRoot}/${item.commit}/${file.upstreamPath}`) fail('unpinned URL');
      if (isPrepared) {
        const local = `engine/skill-sources/upstream/${item.id}/${file.upstreamPath}`;
        if (file.localPath !== local || localPaths.has(local)) fail('local path');
        localPaths.add(local);
        const bytes = await regular(local);
        if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
          fail(`hash mismatch: ${local}`);
      } else if (file.localPath !== undefined) fail('candidate must not be bundled');
    }
    const entrypoint = `${item.directory ? item.directory + '/' : ''}SKILL.md`;
    if (!paths.has(entrypoint)) fail(`missing SKILL.md: ${item.id}`);
    if (isPrepared && ![...paths].some((path) => /(^|\/)LICENSE(\.txt)?$/.test(path)))
      fail(`missing license file: ${item.id}`);
  }
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) fail('unlisted symlink');
      if (entry.isDirectory()) await walk(path);
      else if (!entry.isFile() || !localPaths.has(relative(root, path).split(sep).join('/')))
        fail(`unlisted upstream file: ${entry.name}`);
    }
  };
  await walk(resolve(base, 'upstream'));
  return { sources: seen.size, preparedBundles: prepared.size, verifiedFiles: localPaths.size, runtimeEnabled: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await verifySources(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
