import { request } from 'node:http';
import { RuntimeError } from './ports.js';
/** Operator-configured local socket only. Never passed into a task container. */
export class DockerApi {
  constructor(readonly socketPath: string) {
    if (!socketPath.startsWith('/') || socketPath.includes('\0'))
      throw new RuntimeError('INVALID_EXECUTOR_CONFIG');
  }
  async call(
    method: string,
    path: string,
    body?: Buffer | object,
    signal?: AbortSignal,
    allowed = [200, 201, 204],
  ) {
    const bytes =
      body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const req = request(
          {
            socketPath: this.socketPath,
            method,
            path: '/v1.47' + path,
            signal: bounded,
            headers: bytes
              ? {
                  'content-type': Buffer.isBuffer(body) ? 'application/x-tar' : 'application/json',
                  'content-length': bytes.length,
                }
              : {},
          },
          (res) => {
            let size = 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 1048576) req.destroy(new RuntimeError('EXECUTOR_RESPONSE_LIMIT'));
              else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () =>
              allowed.includes(res.statusCode ?? 0)
                ? resolve(Buffer.concat(chunks))
                : reject(new RuntimeError('EXECUTOR_REQUEST_FAILED')),
            );
          },
        );
        req.on('error', reject);
        req.end(bytes);
      });
    } catch (error) {
      if (signal?.aborted) throw new RuntimeError('CANCELLED');
      throw error instanceof RuntimeError ? error : new RuntimeError('EXECUTOR_UNAVAILABLE');
    }
  }
  async json(method: string, path: string, body?: object, signal?: AbortSignal) {
    const bytes = await this.call(method, path, body, signal);
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    }
  }
}
/** Encode only validated job paths. No host filesystem or external tar process. */
export function jobArchive(files: readonly { handle: string; bytes: Uint8Array }[]) {
  const parts: Buffer[] = [];
  const dirs = new Set<string>(['inputs', 'modules', 'modules/candidate', 'outputs']);
  for (const f of files) {
    const segments = f.handle.split('/');
    segments.pop();
    for (let i = 1; i <= segments.length; i++) dirs.add(segments.slice(0, i).join('/'));
  }
  const entries = [
    ...[...dirs].sort().map((handle) => ({ handle, bytes: Buffer.alloc(0), directory: true })),
    ...files.map((f) => ({ ...f, directory: false })),
  ];
  for (const file of entries) {
    const header = Buffer.alloc(512);
    let name = file.handle,
      prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const i = name.lastIndexOf('/');
      prefix = name.slice(0, i);
      name = name.slice(i + 1);
    }
    if (name.length > 100 || prefix.length > 155) throw new RuntimeError('INVALID_PACKAGE_GRANT');
    header.write(name, 0);
    header.write(file.directory ? '0000555\0' : '0000444\0', 100);
    header.write('0177774\0', 108);
    header.write('0177774\0', 116);
    header.write(file.bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = file.directory ? 53 : 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(prefix, 345);
    header.write(
      header
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148,
    );
    parts.push(header, Buffer.from(file.bytes), Buffer.alloc((512 - (file.bytes.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
export function dockerStdout(bytes: Buffer) {
  const result: Buffer[] = [];
  let offset = 0,
    total = 0;
  while (offset < bytes.length) {
    if (
      offset + 8 > bytes.length ||
      ![1, 2].includes(bytes[offset]) ||
      bytes.subarray(offset + 1, offset + 4).some((b) => b !== 0)
    )
      throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    const length = bytes.readUInt32BE(offset + 4);
    if (offset + 8 + length > bytes.length) throw new RuntimeError('EXECUTOR_RESPONSE_INVALID');
    if (bytes[offset] === 1) {
      total += length;
      if (total > 196608) throw new RuntimeError('OUTPUT_LIMIT');
      result.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += 8 + length;
  }
  return Buffer.concat(result).toString('utf8');
}
