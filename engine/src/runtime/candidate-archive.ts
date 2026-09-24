import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
import type { TaskFile } from './sandbox.js';
export const packageName = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
export const packageVersion = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$/.test(v);
export const packagePath = (v: string) =>
  v.length <= 180 && v.split('/').every((p) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(p));
export type InstalledPackage = {
  files: TaskFile[];
  main: string;
  archiveSha256: string;
  licenseText: string;
  licenseSha256: string;
};
function reject(code = 'CANDIDATE_ARCHIVE_REJECTED'): never {
  throw new RuntimeError(code);
}
export function packagePolicy(value: unknown, name: string, version: string, license: string) {
  if (
    !isRecord(value) ||
    value.name !== name ||
    value.version !== version ||
    value.license !== license ||
    !['MIT', 'ISC'].includes(license)
  )
    reject('CANDIDATE_METADATA_REJECTED');
  for (const key of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ]) {
    if (value[key] !== undefined && (!isRecord(value[key]) || Object.keys(value[key]).length))
      reject('CANDIDATE_DEPENDENCIES_UNSUPPORTED');
  }
  if (value.bin || value.gypfile || value.os || value.cpu) reject('CANDIDATE_NATIVE_UNSUPPORTED');
  if (value.scripts !== undefined && !isRecord(value.scripts)) reject('CANDIDATE_METADATA_REJECTED');
  const scripts = value.scripts;
  if (
    isRecord(scripts) &&
    ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'].some(
      (k) => k in scripts,
    )
  )
    reject('CANDIDATE_INSTALL_SCRIPT_REJECTED');
  const main = typeof value.main === 'string' ? value.main.replace(/^\.\//, '') : 'index.js';
  if (
    !packagePath(main) ||
    !/\.(c?js|mjs)$/.test(main) ||
    (value.type !== undefined && !['module', 'commonjs'].includes(String(value.type)))
  )
    reject('CANDIDATE_ENTRY_UNSUPPORTED');
  return main;
}
/** Deliberately supports only bounded regular USTAR files. Never invokes tar/npm or any package script. */
export function unpackCandidate(
  compressed: Uint8Array,
  integrity: string,
  name: string,
  version: string,
  license: string,
): InstalledPackage {
  if (compressed.byteLength > 524288 || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity))
    reject('CANDIDATE_INTEGRITY_FAILED');
  if ('sha512-' + createHash('sha512').update(compressed).digest('base64') !== integrity)
    reject('CANDIDATE_INTEGRITY_FAILED');
  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: 1048576 });
  } catch {
    return reject();
  }
  if (tar.length % 512 || tar.length < 1024) reject();
  const files: TaskFile[] = [];
  const names = new Set<string>();
  let total = 0,
    offset = 0,
    ended = false,
    entries = 0;
  const string = (b: Buffer) => b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString('utf8');
  const octal = (b: Buffer) => {
    const value = string(b).trim();
    if (!/^[0-7]+$/.test(value)) return reject();
    return parseInt(value, 8);
  };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((b) => b === 0)) {
      if (tar.length - offset < 512 || !tar.subarray(offset).every((b) => b === 0)) reject();
      ended = true;
      break;
    }
    if (++entries > 80 || !string(header.subarray(257, 263)).startsWith('ustar')) reject();
    const checksum = octal(header.subarray(148, 156)),
      check = Buffer.from(header);
    check.fill(32, 148, 156);
    if (check.reduce((a, b) => a + b, 0) !== checksum) reject();
    const prefix = string(header.subarray(345, 500)),
      base = string(header.subarray(0, 100));
    const path = (prefix ? prefix + '/' : '') + base,
      size = octal(header.subarray(124, 136)),
      type = header[156];
    if (!path.startsWith('package/') || size > 524288 || offset + size > tar.length) reject();
    const relative = path.slice(8).replace(/\/$/, '');
    if (!packagePath(relative) || names.has(relative.toLowerCase())) reject();
    names.add(relative.toLowerCase());
    if (type === 53) {
      if (size !== 0) reject();
      continue;
    }
    if (type !== 0 && type !== 48) reject();
    if (
      !/\.(?:js|cjs|mjs|json|md|txt)$/i.test(relative) &&
      !/^(?:LICENSE|LICENCE|COPYING|README)$/i.test(relative)
    )
      reject('CANDIDATE_FILE_UNSUPPORTED');
    total += size;
    if (total > 524288 || files.length >= 64) reject();
    files.push({ handle: relative, bytes: Buffer.from(tar.subarray(offset, offset + size)) });
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended) reject();
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      Buffer.from(files.find((f) => f.handle === 'package.json')!.bytes).toString('utf8'),
    );
  } catch {
    return reject('CANDIDATE_METADATA_REJECTED');
  }
  const main = packagePolicy(metadata, name, version, license);
  if (!files.some((f) => f.handle === main)) reject('CANDIDATE_ENTRY_UNSUPPORTED');
  const licenseFile = files.find((f) => /^(?:LICENSE|LICENCE)(?:\.md|\.txt)?$/i.test(f.handle));
  if (!licenseFile || licenseFile.bytes.length < 40 || licenseFile.bytes.length > 4096)
    reject('CANDIDATE_LICENSE_MISSING');
  return {
    files,
    main,
    archiveSha256: createHash('sha256').update(compressed).digest('hex'),
    licenseText: Buffer.from(licenseFile!.bytes).toString('utf8'),
    licenseSha256: createHash('sha256').update(licenseFile!.bytes).digest('hex'),
  };
}
