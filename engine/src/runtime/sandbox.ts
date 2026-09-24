import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagePath } from './candidate-archive.js';
import { RuntimeError } from './ports.js';

export interface TaskFile {
  handle: string;
  bytes: Uint8Array;
}
export interface SandboxResult {
  stdout: string;
  artifacts: { name: string; sha256: string; bytes: Uint8Array }[];
}
export interface TaskSandbox {
  run(script: string, files: readonly TaskFile[], signal: AbortSignal): Promise<SandboxResult>;
}
export interface PackageSandbox extends TaskSandbox {
  readonly isolation?: string;
  runInstalled(
    script: string,
    files: readonly TaskFile[],
    installed: readonly TaskFile[],
    signal: AbortSignal,
  ): Promise<SandboxResult>;
}
const safeName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name);

/** Local validation backend. Deliberately unavailable on other operating systems. */
export class LocalNodeSandbox implements PackageSandbox {
  readonly isolation = 'local-macos-prototype';
  constructor(private readonly config: { python: string; timeoutMs?: number }) {
    if (
      !config.python.startsWith('/') ||
      !Number.isInteger(config.timeoutMs ?? 10000) ||
      (config.timeoutMs ?? 10000) < 1 ||
      (config.timeoutMs ?? 10000) > 15000
    )
      throw new RuntimeError('INVALID_SANDBOX_CONFIG');
  }
  async run(script: string, files: readonly TaskFile[], signal: AbortSignal): Promise<SandboxResult> {
    return this.execute(script, files, [], signal);
  }
  async runInstalled(
    script: string,
    files: readonly TaskFile[],
    installed: readonly TaskFile[],
    signal: AbortSignal,
  ) {
    return this.execute(script, files, installed, signal);
  }
  private async execute(
    script: string,
    files: readonly TaskFile[],
    installed: readonly TaskFile[],
    signal: AbortSignal,
  ): Promise<SandboxResult> {
    if (signal.aborted) throw new RuntimeError('CANCELLED');
    if (
      installed.length > 64 ||
      new Set(installed.map((f) => f.handle.toLowerCase())).size !== installed.length ||
      installed.some((f) => !packagePath(f.handle)) ||
      installed.reduce((n, f) => n + f.bytes.byteLength, 0) > 524288
    )
      throw new RuntimeError('INVALID_PACKAGE_GRANT');
    if (process.platform !== 'darwin') throw new RuntimeError('SANDBOX_UNAVAILABLE');
    if (
      !script.trim() ||
      Buffer.byteLength(script) > 16384 ||
      files.length > 10 ||
      files.some((f) => !safeName(f.handle)) ||
      new Set(files.map((f) => f.handle)).size !== files.length ||
      files.reduce((n, f) => n + f.bytes.byteLength, 0) > 1048576
    )
      throw new RuntimeError('INVALID_SANDBOX_INPUT');
    const job = await realpath(await mkdtemp(join(tmpdir(), 'dreamcore-task-')));
    await chmod(job, 0o700);
    const outputDir = join(job, 'outputs');
    try {
      for (const name of ['inputs', 'outputs', 'tmp']) await mkdir(join(job, name), { mode: 0o700 });
      for (const file of files)
        await writeFile(join(job, 'inputs', file.handle), file.bytes, { mode: 0o400, flag: 'wx' });
      for (const file of installed) {
        const path = join(job, 'modules', 'candidate', file.handle);
        await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true, mode: 0o700 });
        await writeFile(path, file.bytes, { mode: 0o400, flag: 'wx' });
      }
      await writeFile(join(job, 'script.mjs'), script, { mode: 0o400, flag: 'wx' });
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      const child = spawn(
        this.config.python,
        [
          '-I',
          '-B',
          fileURLToPath(new URL('../../workers/node-sandbox.py', import.meta.url)),
          process.execPath,
          job,
        ],
        {
          cwd: job,
          detached: true,
          env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const kill = () => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      };
      let failure = '',
        bytes = 0;
      const stdout: Buffer[] = [];
      const stop = (code: string) => {
        failure ||= code;
        kill();
      };
      const cancel = () => stop('CANCELLED');
      signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => stop('TIME_LIMIT'), this.config.timeoutMs ?? 10000);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) stop('OUTPUT_LIMIT');
        else stdout.push(chunk);
      });
      // Bound stderr too, but never return raw runtime errors to the caller/model.
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) stop('OUTPUT_LIMIT');
      });
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', () => reject(new RuntimeError('SANDBOX_UNAVAILABLE')));
          child.once('close', resolve);
          if (signal.aborted) cancel();
        });
        if (failure) throw new RuntimeError(failure);
        if (code !== 0) throw new RuntimeError(code === 70 ? 'SANDBOX_UNAVAILABLE' : 'SCRIPT_FAILED');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        kill();
      }
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      const names = await readdir(outputDir);
      if (names.length > 8) throw new RuntimeError('OUTPUT_LIMIT');
      const artifacts: SandboxResult['artifacts'] = [];
      let total = 0;
      for (const name of names.sort()) {
        const path = join(outputDir, name),
          stat = await lstat(path);
        if (!safeName(name) || !stat.isFile() || stat.nlink !== 1 || (await realpath(path)) !== path)
          throw new RuntimeError('INVALID_ARTIFACT');
        total += stat.size;
        if (total > 65536) throw new RuntimeError('OUTPUT_LIMIT');
        const content = await readFile(path);
        artifacts.push({ name, sha256: createHash('sha256').update(content).digest('hex'), bytes: content });
      }
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      return { stdout: Buffer.concat(stdout).toString('utf8'), artifacts };
    } finally {
      await rm(job, { recursive: true, force: true });
    }
  }
}
