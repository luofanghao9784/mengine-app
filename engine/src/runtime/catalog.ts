import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
export type SkillReceipt = { id: string; version: string; sha256: string };
export type SkillFile = { path: string; bytes: number; sha256: string };
export type Skill = SkillReceipt & {
  title: string;
  file: string;
  tools: string[];
  source: string;
  license: string;
  files?: SkillFile[];
  requires?: string[];
  upstreamCommit?: string;
};
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const safePath = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 240 &&
  /^[A-Za-z0-9_./-]+$/.test(v) &&
  v.split('/').every((p) => p && p !== '.' && p !== '..');
const tools = new Set([
  'search_sources',
  'public_search',
  'read_public_page',
  'candidate_tool',
  'process_original',
  'read_original',
  'run_javascript',
  'render_presentation',
]);
const capabilities = new Set(['artifact-transfer-v1', 'pptx-renderer-v1', 'web-renderer-v1']);
/** Hash binds content AND the release-owned provenance, permissions and dependency requirements. */
export function skillBundleDigest(item: Omit<Skill, 'sha256'>): string {
  return hash(
    JSON.stringify({
      id: item.id,
      version: item.version,
      title: item.title,
      file: item.file,
      source: item.source,
      license: item.license,
      upstreamCommit: item.upstreamCommit,
      tools: [...item.tools].sort(),
      requires: [...(item.requires ?? [])].sort(),
      files: [...(item.files ?? [])]
        .sort((a, b) => a.path.localeCompare(b.path, 'en'))
        .map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
    }),
  );
}
/** Release-owned paths only. No URL loading, extraction, installation or upstream script execution. */
export class TrustedCatalog {
  private constructor(
    private readonly root: string,
    readonly items: readonly Skill[],
    private readonly ready: ReadonlySet<string>,
  ) {}
  private static async bytes(root: string, path: string, limit: number, code: string): Promise<Buffer> {
    try {
      if (!safePath(path) || (await lstat(root)).isSymbolicLink()) throw new Error();
      let current = root;
      for (const part of path.split('/')) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error();
      }
      const stat = await lstat(current);
      if (!stat.isFile() || stat.size > limit) throw new Error();
      const bytes = await readFile(current);
      if (bytes.length > limit) throw new Error();
      return bytes;
    } catch {
      throw new RuntimeError(code);
    }
  }
  static async load(
    root = new URL('../../catalog/', import.meta.url),
    ready: ReadonlySet<string> = new Set(),
  ) {
    const originalRoot = fileURLToPath(root);
    if ((await lstat(originalRoot)).isSymbolicLink()) throw new RuntimeError('INVALID_CATALOG');
    const base = await realpath(originalRoot);
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        (await this.bytes(base, 'manifest.json', 262144, 'INVALID_CATALOG')).toString('utf8'),
      );
    } catch {
      throw new RuntimeError('INVALID_CATALOG');
    }
    if (
      !isRecord(manifest) ||
      !['1.0', '2.0'].includes(String(manifest.version)) ||
      !Array.isArray(manifest.items) ||
      manifest.items.length > 20
    )
      throw new RuntimeError('INVALID_CATALOG');
    const seen = new Set();
    for (const item of manifest.items) {
      if (
        !isRecord(item) ||
        typeof item.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) ||
        seen.has(item.id) ||
        typeof item.version !== 'string' ||
        !/^[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$/.test(item.version) ||
        !digest(item.sha256) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 100 ||
        !Array.isArray(item.tools) ||
        !item.tools.length ||
        new Set(item.tools).size !== item.tools.length ||
        item.tools.some((t) => typeof t !== 'string' || !tools.has(t))
      )
        throw new RuntimeError('INVALID_CATALOG');
      if (item.files === undefined) {
        if (
          item.file !== `${item.id}.md` ||
          item.source !== 'dreamcore-bundled' ||
          item.license !== 'project-internal' ||
          item.requires !== undefined ||
          item.upstreamCommit !== undefined
        )
          throw new RuntimeError('INVALID_CATALOG');
      } else {
        if (
          manifest.version !== '2.0' ||
          item.file !== `${item.id}/SKILL.md` ||
          typeof item.source !== 'string' ||
          !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(item.source) ||
          typeof item.upstreamCommit !== 'string' ||
          !/^[a-f0-9]{40}$/.test(item.upstreamCommit) ||
          !['MIT', 'MIT-0', 'Apache-2.0'].includes(String(item.license)) ||
          !Array.isArray(item.requires) ||
          !item.requires.length ||
          new Set(item.requires).size !== item.requires.length ||
          item.requires.some((c) => typeof c !== 'string' || !capabilities.has(c)) ||
          !Array.isArray(item.files) ||
          !item.files.length ||
          item.files.length > 128
        )
          throw new RuntimeError('INVALID_CATALOG');
        const paths = new Set();
        let total = 0;
        for (const file of item.files) {
          if (
            !isRecord(file) ||
            !safePath(file.path) ||
            !file.path.startsWith(`${item.id}/`) ||
            paths.has(file.path.toLowerCase()) ||
            !digest(file.sha256) ||
            typeof file.bytes !== 'number' ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 1 ||
            file.bytes > 1048576
          )
            throw new RuntimeError('INVALID_CATALOG');
          paths.add(file.path.toLowerCase());
          total += file.bytes;
        }
        if (
          total > 2097152 ||
          !item.files.some((f) => f.path === item.file) ||
          !item.files.some((f) => /\/(LICENSE|LICENSE.txt)$/.test(f.path)) ||
          skillBundleDigest(item as unknown as Skill) !== item.sha256
        )
          throw new RuntimeError('INVALID_CATALOG');
      }
      seen.add(item.id);
    }
    const items = (structuredClone(manifest.items) as Skill[]).map((item) => {
      Object.freeze(item.tools);
      if (item.requires) Object.freeze(item.requires);
      if (item.files) {
        item.files.forEach(Object.freeze);
        Object.freeze(item.files);
      }
      return Object.freeze(item);
    });
    return new TrustedCatalog(base, Object.freeze(items), new Set(ready));
  }
  available(allowed: ReadonlySet<string>) {
    return this.items
      .filter(
        (item) =>
          item.tools.every((t) => allowed.has(t)) && (item.requires ?? []).every((c) => this.ready.has(c)),
      )
      .map((item) => structuredClone(item));
  }
  private selected(id: string, version: string, allowed: ReadonlySet<string>) {
    const item = this.available(allowed).find((s) => s.id === id && s.version === version);
    if (!item) throw new RuntimeError('SKILL_NOT_AVAILABLE');
    return item;
  }
  async activate(id: string, version: string, allowed: ReadonlySet<string>) {
    const item = this.selected(id, version, allowed);
    let entry: Buffer | undefined;
    for (const file of item.files ?? [{ path: item.file, bytes: 0, sha256: item.sha256 }]) {
      const bytes = await TrustedCatalog.bytes(
        this.root,
        file.path,
        item.files ? 1048576 : 16384,
        'SKILL_INTEGRITY_FAILED',
      );
      if ((item.files && bytes.length !== file.bytes) || hash(bytes) !== file.sha256)
        throw new RuntimeError('SKILL_INTEGRITY_FAILED');
      if (file.path === item.file) entry = bytes;
    }
    if (!entry || entry.length > 65536) throw new RuntimeError('SKILL_INTEGRITY_FAILED');
    return { item, instructions: entry.toString('utf8') };
  }
  async readResource(id: string, version: string, path: string, allowed: ReadonlySet<string>) {
    const item = this.selected(id, version, allowed);
    const file = item.files?.find((f) => f.path === path);
    if (!file || !/\.(md|txt|json)$/.test(path) || file.bytes > 65536)
      throw new RuntimeError('SKILL_RESOURCE_NOT_AVAILABLE');
    const bytes = await TrustedCatalog.bytes(this.root, path, 65536, 'SKILL_INTEGRITY_FAILED');
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
      throw new RuntimeError('SKILL_INTEGRITY_FAILED');
    return bytes.toString('utf8');
  }
}
