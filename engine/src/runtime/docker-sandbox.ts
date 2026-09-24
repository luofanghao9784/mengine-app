import { randomUUID, createHash } from 'node:crypto';
import { DockerApi, jobArchive, dockerStdout } from './docker-api.js';
import { packagePath } from './candidate-archive.js';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
import type { PackageSandbox, TaskFile, SandboxResult } from './sandbox.js';
const label = 'io.dreamcore.executor';
const safeName = (v: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v);
export const executorLimits = Object.freeze({
  memory: 201326592,
  tmp: 8388608,
  outputs: 4194304,
  pids: 32,
  nanoCpus: 500000000,
  timeoutMs: 10000,
  ttlMs: 60000,
});
export interface DockerSandboxConfig {
  socketPath: string;
  image: string;
  scope: string;
  timeoutMs?: number;
}
/** Linux OCI validation backend. Rootless cgroup v2 is required; never falls back to host execution. */
export class DockerSandbox implements PackageSandbox {
  readonly isolation = 'linux-rootless-oci-prototype';
  private api: DockerApi;
  private active = 0;
  constructor(readonly config: DockerSandboxConfig) {
    if (
      !/^sha256:[a-f0-9]{64}$/.test(config.image) ||
      !/^dc-[a-z0-9-]{8,48}$/.test(config.scope) ||
      !Number.isInteger(config.timeoutMs ?? 10000) ||
      (config.timeoutMs ?? 10000) < 100 ||
      (config.timeoutMs ?? 10000) > 15000
    )
      throw new RuntimeError('INVALID_EXECUTOR_CONFIG');
    this.api = new DockerApi(config.socketPath);
  }
  async check(signal?: AbortSignal) {
    const info = await this.api.json('GET', '/info', undefined, signal);
    if (
      info.OSType !== 'linux' ||
      info.CgroupVersion !== '2' ||
      info.CgroupDriver !== 'systemd' ||
      !Array.isArray(info.SecurityOptions) ||
      !info.SecurityOptions.includes('name=rootless') ||
      !info.SecurityOptions.some((s: unknown) => typeof s === 'string' && s.startsWith('name=seccomp,'))
    )
      throw new RuntimeError('EXECUTOR_POLICY_UNAVAILABLE');
    const image = await this.api.json(
      'GET',
      '/images/' + encodeURIComponent(this.config.image) + '/json',
      undefined,
      signal,
    );
    if (image.Id !== this.config.image) throw new RuntimeError('EXECUTOR_IMAGE_MISMATCH');
  }
  /** A stable scope belongs to one executor deployment. No pruning of other deployments or unlabelled resources. */
  async reapExpired(now = Date.now(), signal?: AbortSignal) {
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]);
    const filters = encodeURIComponent(
      JSON.stringify({ label: [label + '.scope=' + this.config.scope, label + '.managed=1'] }),
    );
    const entries = await this.api.json(
      'GET',
      '/containers/json?all=1&filters=' + filters,
      undefined,
      bounded,
    );
    if (!Array.isArray(entries) || entries.length > 256) throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    let removed = 0;
    for (const item of entries) {
      if (
        !isRecord(item) ||
        typeof item.Id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.Id) ||
        !isRecord(item.Labels)
      )
        throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
      const tags = item.Labels,
        expires = Number(tags[label + '.expires']);
      if (
        tags[label + '.scope'] !== this.config.scope ||
        tags[label + '.managed'] !== '1' ||
        !Number.isSafeInteger(expires) ||
        expires <= 0
      )
        continue;
      if (expires <= now) {
        await this.remove(item.Id, bounded);
        removed++;
      }
    }
    const volumes = await this.api.json('GET', '/volumes?filters=' + filters, undefined, bounded);
    if (!isRecord(volumes) || (volumes.Volumes !== null && !Array.isArray(volumes.Volumes)))
      throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    const listed = (volumes.Volumes ?? []) as { Name: string; Labels: Record<string, string> }[];
    if (listed.length > 256) throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    for (const volume of listed) {
      if (
        !volume ||
        typeof volume.Name !== 'string' ||
        !/^dc-input-[a-f0-9-]{36}$/.test(volume.Name) ||
        !isRecord(volume.Labels)
      )
        continue;
      const tags = volume.Labels,
        expires = Number(tags[label + '.expires']);
      if (
        tags[label + '.scope'] === this.config.scope &&
        tags[label + '.managed'] === '1' &&
        Number.isSafeInteger(expires) &&
        expires > 0 &&
        expires <= now
      ) {
        await this.api.call('DELETE', '/volumes/' + volume.Name, undefined, bounded, [204, 404]);
        removed++;
      }
    }
    return removed;
  }
  private async remove(id: string, signal?: AbortSignal) {
    await this.api.call(
      'DELETE',
      '/containers/' + id + '?force=1&v=1',
      undefined,
      signal ?? AbortSignal.timeout(8000),
      [204, 404],
    );
  }
  async run(script: string, files: readonly TaskFile[], signal: AbortSignal) {
    return this.runInstalled(script, files, [], signal);
  }
  async runInstalled(
    script: string,
    files: readonly TaskFile[],
    installed: readonly TaskFile[],
    signal: AbortSignal,
  ): Promise<SandboxResult> {
    if (signal.aborted) throw new RuntimeError('CANCELLED');
    if (
      !script.trim() ||
      Buffer.byteLength(script) > 16384 ||
      files.length > 10 ||
      files.some((f) => !safeName(f.handle)) ||
      new Set(files.map((f) => f.handle)).size !== files.length ||
      files.reduce((n, f) => n + f.bytes.length, 0) > 1048576
    )
      throw new RuntimeError('INVALID_SANDBOX_INPUT');
    if (
      installed.length > 64 ||
      installed.some((f) => !packagePath(f.handle)) ||
      new Set(installed.map((f) => f.handle.toLowerCase())).size !== installed.length ||
      installed.reduce((n, f) => n + f.bytes.length, 0) > 524288
    )
      throw new RuntimeError('INVALID_PACKAGE_GRANT');
    if (this.active >= 2) throw new RuntimeError('EXECUTOR_BUSY');
    this.active++;
    const job = randomUUID(),
      name = 'dc-job-' + job,
      stage = name + '-stage',
      volume = 'dc-input-' + job;
    let created = false;
    const timeoutMs = this.config.timeoutMs ?? 10000;
    try {
      await this.check(signal);
      await this.reapExpired(Date.now(), signal);
      signal.throwIfAborted();
      const expires = Date.now() + executorLimits.ttlMs;
      const payload = {
        Image: this.config.image,
        User: '65532:65532',
        WorkingDir: '/job/outputs',
        Entrypoint: ['node', '/opt/dreamcore/runner.mjs'],
        Cmd: [],
        Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', 'TMPDIR=/tmp', 'LANG=C.UTF-8'],
        Tty: false,
        NetworkDisabled: true,
        Labels: {
          [label + '.managed']: '1',
          [label + '.scope']: this.config.scope,
          [label + '.expires']: String(expires),
        },
        HostConfig: {
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          Memory: executorLimits.memory,
          MemorySwap: executorLimits.memory,
          PidsLimit: executorLimits.pids,
          NanoCpus: executorLimits.nanoCpus,
          ShmSize: 65536,
          Init: false,
          RestartPolicy: { Name: 'no' },
          LogConfig: { Type: 'json-file', Config: { 'max-size': '256k', 'max-file': '1' } },
          Ulimits: [
            { Name: 'nofile', Soft: 64, Hard: 64 },
            { Name: 'core', Soft: 0, Hard: 0 },
          ],
          Tmpfs: {
            '/tmp': `rw,noexec,nosuid,nodev,size=${executorLimits.tmp},mode=700,uid=65532,gid=65532`,
            '/job/outputs': `rw,noexec,nosuid,nodev,size=${executorLimits.outputs},mode=700,uid=65532,gid=65532`,
          },
        },
      };
      // The stopped staging container only copies bounded bytes. Task code only sees a read-only volume.
      created = true;
      await this.api.json('POST', '/volumes/create', { Name: volume, Labels: payload.Labels }, signal);
      const mount = {
        Type: 'volume',
        Source: volume,
        Target: '/job',
        ReadOnly: false,
        VolumeOptions: { NoCopy: true },
      };
      await this.api.json(
        'POST',
        '/containers/create?name=' + stage,
        {
          ...payload,
          Entrypoint: ['/bin/false'],
          HostConfig: { ...payload.HostConfig, Tmpfs: {}, Mounts: [mount] },
        },
        signal,
      );
      const archive = jobArchive([
        { handle: 'script.mjs', bytes: Buffer.from(script) },
        {
          handle: 'limits.json',
          bytes: Buffer.from(JSON.stringify({ ...executorLimits, timeoutMs, expires })),
        },
        ...files.map((f) => ({ handle: 'inputs/' + f.handle, bytes: f.bytes })),
        ...installed.map((f) => ({ handle: 'modules/candidate/' + f.handle, bytes: f.bytes })),
      ]);
      await this.api.call('PUT', '/containers/' + stage + '/archive?path=/job', archive, signal);
      await this.api.json(
        'POST',
        '/containers/create?name=' + name,
        { ...payload, HostConfig: { ...payload.HostConfig, Mounts: [{ ...mount, ReadOnly: true }] } },
        signal,
      );
      await this.remove(stage);

      await this.api.call('POST', '/containers/' + name + '/start', undefined, signal);
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5000)]);
      try {
        await this.api.json(
          'POST',
          '/containers/' + name + '/wait?condition=not-running',
          undefined,
          bounded,
        );
      } catch (error) {
        if (bounded.aborted && !signal.aborted) throw new RuntimeError('TIME_LIMIT');
        throw error;
      }
      const state = await this.api.json('GET', '/containers/' + name + '/json', undefined, signal);
      if (state.State?.OOMKilled) throw new RuntimeError('MEMORY_LIMIT');
      if (state.State?.ExitCode !== 0) throw new RuntimeError('SCRIPT_FAILED');
      const raw = dockerStdout(
        await this.api.call('GET', '/containers/' + name + '/logs?stdout=1&stderr=1', undefined, signal),
      );
      let result: unknown;
      try {
        result = JSON.parse(raw);
      } catch {
        throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
      }
      if (!isRecord(result) || result.version !== '1.0') throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
      if (result.ok !== true) {
        const codes = [
          'TIME_LIMIT',
          'SCRIPT_FAILED',
          'OUTPUT_LIMIT',
          'INVALID_ARTIFACT',
          'MEMORY_LIMIT',
          'EXECUTOR_POLICY_UNAVAILABLE',
        ];
        throw new RuntimeError(
          typeof result.code === 'string' && codes.includes(result.code) ? result.code : 'SCRIPT_FAILED',
        );
      }
      if (
        typeof result.stdout !== 'string' ||
        Buffer.byteLength(result.stdout) > 65536 ||
        !Array.isArray(result.artifacts) ||
        result.artifacts.length > 8
      )
        throw new RuntimeError('INVALID_ARTIFACT');
      let total = 0;
      const names = new Set<string>();
      const artifacts: SandboxResult['artifacts'] = [];
      for (const f of result.artifacts) {
        if (
          !isRecord(f) ||
          typeof f.name !== 'string' ||
          !safeName(f.name) ||
          names.has(f.name) ||
          typeof f.contentBase64 !== 'string' ||
          f.contentBase64.length > 90000
        )
          throw new RuntimeError('INVALID_ARTIFACT');
        const bytes = Buffer.from(f.contentBase64, 'base64');
        total += bytes.length;
        names.add(f.name);
        if (
          total > 65536 ||
          bytes.toString('base64') !== f.contentBase64 ||
          createHash('sha256').update(bytes).digest('hex') !== f.sha256
        )
          throw new RuntimeError('INVALID_ARTIFACT');
        artifacts.push({ name: f.name, sha256: f.sha256 as string, bytes });
      }
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      return { stdout: result.stdout, artifacts };
    } catch (error) {
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      throw error;
    } finally {
      try {
        if (created) {
          const cleanup = await Promise.allSettled([this.remove(name), this.remove(stage)]);
          await this.api.call(
            'DELETE',
            '/volumes/' + volume,
            undefined,
            AbortSignal.timeout(8000),
            [204, 404],
          );
          if (cleanup.some((r) => r.status === 'rejected')) throw new RuntimeError('EXECUTOR_CLEANUP_FAILED');
        }
      } catch {
        throw new RuntimeError('EXECUTOR_CLEANUP_FAILED');
      } finally {
        this.active--;
      }
    }
  }
}
