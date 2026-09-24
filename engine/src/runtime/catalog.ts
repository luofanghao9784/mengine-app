import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
export type SkillReceipt = { id: string; version: string; sha256: string };
export type Skill = SkillReceipt & {
  title: string;
  file: string;
  tools: string[];
  source: string;
  license: string;
};
/** Only the release-owned directory is loaded. No task-provided paths, imports or install scripts. */
export class TrustedCatalog {
  private constructor(
    private readonly root: URL,
    readonly items: readonly Skill[],
  ) {}
  static async load(root = new URL('../../catalog/', import.meta.url)) {
    const manifestFile = new URL('manifest.json', root);
    const stat = await lstat(manifestFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
      throw new RuntimeError('INVALID_CATALOG');
    const manifest: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (
      !isRecord(manifest) ||
      manifest.version !== '1.0' ||
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
        typeof item.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        item.file !== `${item.id}.md` ||
        typeof item.title !== 'string' ||
        item.title.length > 100 ||
        item.source !== 'dreamcore-bundled' ||
        item.license !== 'project-internal' ||
        !Array.isArray(item.tools) ||
        !item.tools.length ||
        item.tools.some(
          (t) =>
            ![
              'search_sources',
              'public_search',
              'read_public_page',
              'candidate_tool',
              'process_original',
            ].includes(String(t)),
        )
      )
        throw new RuntimeError('INVALID_CATALOG');
      seen.add(item.id);
    }
    return new TrustedCatalog(
      root,
      Object.freeze(
        (structuredClone(manifest.items) as Skill[]).map((item) => {
          Object.freeze(item.tools);
          return Object.freeze(item);
        }),
      ),
    );
  }
  available(allowed: ReadonlySet<string>) {
    return this.items
      .filter((item) => item.tools.every((t) => allowed.has(t)))
      .map((item) => structuredClone(item));
  }
  async activate(id: string, version: string, allowed: ReadonlySet<string>) {
    const item = this.available(allowed).find((s) => s.id === id && s.version === version);
    if (!item) throw new RuntimeError('SKILL_NOT_AVAILABLE');
    const path = new URL(item.file, this.root),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
      throw new RuntimeError('SKILL_INTEGRITY_FAILED');
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
      throw new RuntimeError('SKILL_INTEGRITY_FAILED');
    return { item, instructions: bytes.toString('utf8') };
  }
}
