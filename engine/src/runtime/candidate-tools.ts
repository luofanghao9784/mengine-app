import { createHash, randomUUID } from 'node:crypto';
import { PublicReader } from './public-web.js';
import { isRecord } from './http-json.js';
import { RuntimeError, type Json } from './ports.js';
import {
  packageName,
  packageVersion,
  packagePolicy,
  unpackCandidate,
  type InstalledPackage,
} from './candidate-archive.js';
import type { PackageSandbox, TaskFile } from './sandbox.js';
const registry = 'https://registry.npmjs.org';
export type Candidate = {
  id: string;
  name: string;
  version: string;
  status: 'DISCOVERED' | 'READY' | 'REJECTED' | 'USED';
  code?: string;
  license?: string;
  integrity?: string;
  archiveSha256?: string;
  licenseSha256?: string;
  validationSha256?: string;
  inputHandles?: string[];
};
export class NpmCandidates {
  constructor(private readonly reader = new PublicReader()) {}
  private async get(path: string, signal: AbortSignal) {
    return (await this.reader.fetch(registry + path, signal, false)).response;
  }
  async discover(query: string, signal: AbortSignal) {
    if (!query.trim() || query.length > 200 || /^https?:/i.test(query))
      throw new RuntimeError('CANDIDATE_QUERY_UNSUPPORTED');
    const response = await this.get(
      '/-/v1/search?' + new URLSearchParams({ text: query, size: '3' }),
      signal,
    );
    let value: unknown;
    try {
      value = JSON.parse(response.bytes.toString('utf8'));
    } catch {
      throw new RuntimeError('CANDIDATE_REGISTRY_FAILED');
    }
    if (!isRecord(value) || !Array.isArray(value.objects))
      throw new RuntimeError('CANDIDATE_REGISTRY_FAILED');
    const found: Candidate[] = [];
    for (const item of value.objects.slice(0, 3)) {
      const pkg = isRecord(item) ? item.package : undefined;
      if (
        isRecord(pkg) &&
        packageName(pkg.name) &&
        packageVersion(pkg.version) &&
        !found.some((c) => c.name === pkg.name)
      )
        found.push({ id: randomUUID(), name: pkg.name, version: pkg.version, status: 'DISCOVERED' });
    }
    return found;
  }
  async prepare(candidate: Candidate, signal: AbortSignal) {
    if (!packageName(candidate.name) || !packageVersion(candidate.version))
      throw new RuntimeError('CANDIDATE_NOT_GRANTED');
    const response = await this.get(`/${candidate.name}/${candidate.version}`, signal);
    let metadata: unknown;
    try {
      metadata = JSON.parse(response.bytes.toString('utf8'));
    } catch {
      throw new RuntimeError('CANDIDATE_METADATA_REJECTED');
    }
    if (
      !isRecord(metadata) ||
      typeof metadata.license !== 'string' ||
      !isRecord(metadata.dist) ||
      typeof metadata.dist.integrity !== 'string'
    )
      throw new RuntimeError('CANDIDATE_METADATA_REJECTED');
    packagePolicy(metadata, candidate.name, candidate.version, metadata.license);
    const path = `/${candidate.name}/-/${candidate.name}-${candidate.version}.tgz`;
    if (metadata.dist.tarball !== registry + path) throw new RuntimeError('CANDIDATE_ORIGIN_REJECTED');
    const archive = await this.get(path, signal);
    const installed = unpackCandidate(
      archive.bytes,
      metadata.dist.integrity,
      candidate.name,
      candidate.version,
      metadata.license,
    );
    return { installed, license: metadata.license, integrity: metadata.dist.integrity };
  }
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const artifact = (name: string, bytes: Uint8Array) => ({
  name,
  sha256: sha(bytes),
  contentBase64: Buffer.from(bytes).toString('base64'),
});
const sample =
  '; synthetic-only\nroot=plain\n[section]\nname=hello\ncount=3\nactive=true\nitems[]=one\nitems[]=two\n';
const expected = {
  root: 'plain',
  section: { name: 'hello', count: '3', active: true, items: ['one', 'two'] },
};
const normalize = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(normalize)
    : isRecord(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, normalize(v[k])]),
        )
      : v;
const script = (main: string, handle: string, output: string) =>
  `import fs from 'node:fs'; import * as namespace from ${JSON.stringify('./modules/candidate/' + main)}; const parser=namespace.default??namespace; if(typeof parser.parse!=='function')throw Error('unsupported'); const parsed=parser.parse(fs.readFileSync(${JSON.stringify('../inputs/' + handle)},'utf8')); fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(parsed));`;
/** Task-local only. Trial sees one fixed synthetic input, never granted business files. */
export class CandidateSession {
  private candidates: Candidate[] = [];
  private prepared = new Map<string, InstalledPackage>();
  private licenses = new Map<string, string>();
  private searched = false;
  private trials = 0;
  private uses = 0;
  private busy = false;
  constructor(
    private readonly query: string,
    private readonly registry: NpmCandidates,
    private readonly sandbox: PackageSandbox,
  ) {}
  async execute(
    args: { action: string; id?: string; inputHandle?: string },
    files: readonly TaskFile[],
    signal: AbortSignal,
  ): Promise<Json> {
    if (this.busy) throw new RuntimeError('CANDIDATE_BUSY');
    this.busy = true;
    try {
      signal.throwIfAborted();
      if (args.action === 'discover') {
        if (args.id || args.inputHandle) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
        if (!this.searched) {
          this.candidates = await this.registry.discover(this.query, signal);
          this.searched = true;
        }
        return {
          items: this.snapshot(),
          recipe: 'ini-to-json-v1',
          limitations:
            'Only dependency-free MIT/ISC JavaScript INI parsers; task-local verification, not global trust.',
        };
      }
      const candidate = this.candidates.find((c) => c.id === args.id);
      if (!candidate) throw new RuntimeError('CANDIDATE_NOT_GRANTED');
      if (args.action === 'trial') {
        if (args.inputHandle) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
        if (candidate.status !== 'DISCOVERED') return { ...candidate };
        if (this.trials++ >= 2) throw new RuntimeError('CANDIDATE_TRIAL_LIMIT');
        try {
          const { installed, license, integrity } = await this.registry.prepare(candidate, signal);
          this.licenses.set(candidate.id, installed.licenseText);
          Object.assign(candidate, {
            license,
            integrity,
            archiveSha256: installed.archiveSha256,
            licenseSha256: installed.licenseSha256,
          });
          const result = await this.sandbox.runInstalled(
            script(installed.main, 'synthetic.ini', 'validation.json'),
            [{ handle: 'synthetic.ini', bytes: Buffer.from(sample) }],
            installed.files,
            signal,
          );
          const output = result.artifacts.find((a) => a.name === 'validation.json');
          if (
            result.artifacts.length !== 1 ||
            !output ||
            JSON.stringify(normalize(JSON.parse(Buffer.from(output.bytes).toString('utf8')))) !==
              JSON.stringify(normalize(expected))
          )
            throw new RuntimeError('CANDIDATE_VALIDATION_FAILED');
          signal.throwIfAborted();
          candidate.status = 'READY';
          candidate.validationSha256 = sha(output.bytes);
          this.prepared.set(candidate.id, installed);
        } catch (error) {
          if (signal.aborted) throw new RuntimeError('CANCELLED');
          candidate.status = 'REJECTED';
          candidate.code = error instanceof RuntimeError ? error.code : 'CANDIDATE_VALIDATION_FAILED';
        }
        return { ...candidate };
      }
      if (args.action !== 'run') throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const installed = this.prepared.get(candidate.id),
        file = files.find((f) => f.handle === args.inputHandle);
      if (!installed || !['READY', 'USED'].includes(candidate.status))
        throw new RuntimeError('CANDIDATE_NOT_READY');
      if (!file || file.bytes.byteLength > 16384) throw new RuntimeError('INPUT_NOT_GRANTED');
      if (this.uses++ >= 2) throw new RuntimeError('CANDIDATE_USE_LIMIT');
      const outputName = `converted-${this.uses}.json`;
      try {
        const result = await this.sandbox.runInstalled(
          script(installed.main, file.handle, outputName),
          [file],
          installed.files,
          signal,
        );
        const output = result.artifacts.find((a) => a.name === outputName);
        if (result.artifacts.length !== 1 || !output) throw new RuntimeError('CANDIDATE_OUTPUT_INVALID');
        if (!isRecord(JSON.parse(Buffer.from(output.bytes).toString('utf8'))))
          throw new RuntimeError('CANDIDATE_OUTPUT_INVALID');
        signal.throwIfAborted();
        candidate.status = 'USED';
        candidate.inputHandles = [...new Set([...(candidate.inputHandles ?? []), file.handle])];
        return {
          candidate: { ...candidate },
          scope: 'authorized-excerpt-only',
          artifacts: [artifact(outputName, output.bytes)],
        };
      } catch (error) {
        if (signal.aborted) throw new RuntimeError('CANCELLED');
        candidate.status = 'REJECTED';
        candidate.code = error instanceof RuntimeError ? error.code : 'CANDIDATE_OUTPUT_INVALID';
        this.prepared.delete(candidate.id);
        return { ...candidate };
      }
    } finally {
      this.busy = false;
    }
  }
  snapshot() {
    return structuredClone(this.candidates);
  }
  report() {
    return artifact(
      'candidate-report.json',
      Buffer.from(
        JSON.stringify(
          {
            schemaVersion: '1.0',
            registry: 'https://registry.npmjs.org',
            executionClass: 'verification',
            recipe: 'ini-to-json-v1',
            isolation: this.sandbox.isolation ?? 'verification-adapter',
            globallyTrusted: false,
            limitations: [
              'Synthetic probe is not a security or complete-file-quality certificate',
              'No production admission or shared installation',
            ],
            items: this.snapshot().map((item) => ({
              ...item,
              metadataUrl: registry + '/' + item.name + '/' + item.version,
              archiveUrl: registry + '/' + item.name + '/-/' + item.name + '-' + item.version + '.tgz',
            })),
            licenses: [...this.licenses].map(([id, text]) => ({ id, text })),
          },
          null,
          2,
        ),
      ),
    );
  }
  close() {
    this.prepared.clear();
    this.licenses.clear();
  }
}
