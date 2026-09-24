// Synthetic registry/archive fixture only. No download or package code runs in the host process.
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PublicReader } from '../../dist/runtime/public-web.js';
import { NpmCandidates } from '../../dist/runtime/candidate-tools.js';
export function tarball(entries) {
  const parts = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes ?? ''),
      header = Buffer.alloc(512);
    header.write(entry.path);
    header.write('0000444\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(
      header
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148,
    );
    parts.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
export const parserCode = `exports.parse = text => { const root=Object.create(null);let target=root;for(const line of text.split(/\\r?\\n/)){if(!line || line.startsWith(';'))continue;if(line.startsWith('[')){target=root[line.slice(1,-1)]={};continue;}const equal=line.indexOf('=');if(equal<0)continue;let key=line.slice(0,equal),value=line.slice(equal+1);if(value==='true')value=true;if(key.endsWith('[]')){key=key.slice(0,-2);(target[key]??=[]).push(value);}else target[key]=value;}return root;};`;
export function packageFixture({
  name = 'synthetic-ini',
  version = '1.0.0',
  code = parserCode,
  metadata = {},
} = {}) {
  const manifest = { name, version, license: 'MIT', main: 'index.js', ...metadata };
  const archive = tarball([
    { path: 'package/package.json', bytes: JSON.stringify(manifest) },
    { path: 'package/index.js', bytes: code },
    {
      path: 'package/LICENSE',
      bytes:
        'Synthetic fixture license text; generated for tests only, not a distributed third-party package.',
    },
  ]);
  return {
    archive,
    metadata: {
      ...manifest,
      dist: {
        tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
        integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
      },
    },
  };
}
export function registryFixture(options = {}) {
  const pkg = packageFixture(options),
    requests = [];
  const reader = new PublicReader(
    async () => [{ address: '104.16.25.34', family: 4 }],
    async (url, address, signal) => {
      requests.push(url.href);
      signal.throwIfAborted();
      const search = url.pathname === '/-/v1/search';
      return {
        status: 200,
        headers: {
          'content-type': url.pathname.endsWith('.tgz') ? 'application/octet-stream' : 'application/json',
        },
        bytes: url.pathname.endsWith('.tgz')
          ? pkg.archive
          : Buffer.from(
              JSON.stringify(
                search
                  ? { objects: [{ package: { name: pkg.metadata.name, version: pkg.metadata.version } }] }
                  : pkg.metadata,
              ),
            ),
      };
    },
  );
  return { registry: new NpmCandidates(reader), requests, pkg };
}
