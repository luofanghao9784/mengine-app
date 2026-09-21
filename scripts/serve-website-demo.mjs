import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prebuilt website + Demo; no installed packages or backend are needed.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port')) {
  console.error('用法：node scripts/serve-website-demo.mjs [--port 4318]');
  process.exit(1);
}
const portText = args[1] ?? '4318';
const port = Number(portText);
if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('端口必须是 1—65535 之间的整数。');
  process.exit(1);
}

let root;
try {
  root = await realpath(resolve(projectRoot, 'dist'));
  if (!(await stat(resolve(root, 'index.html'))).isFile()) throw new Error('Missing index');
} catch {
  console.error('缺少 dist/index.html。请先完整解压官网与 Demo 演示包。');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8',
};
function insideRoot(path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const server = createServer(async (request, response) => {
  function reply(status, message, headers = {}) {
    response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...headers,
    });
    response.end(request.method === 'HEAD' ? undefined : message);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  let url, pathname;
  try {
    url = new URL(request.url, 'http://127.0.0.1');
    pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
  } catch {
    reply(400, 'Invalid URL');
    return;
  }
  const requested = resolve(root, `.${pathname}`);
  if (!insideRoot(requested)) return reply(403, 'Forbidden');
  try {
    let path = await realpath(requested);
    if (!insideRoot(path)) return reply(403, 'Forbidden');
    if ((await stat(path)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        // Encode segments to keep redirects local, including unusual filenames.
        const location = '/' + pathname.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/' + url.search;
        return reply(301, 'Moved', { Location: location });
      }
      path = await realpath(resolve(path, 'index.html'));
      if (!insideRoot(path)) return reply(403, 'Forbidden');
    }
    if (!(await stat(path)).isFile()) return reply(404, 'Not found');
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    reply(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Unable to read file');
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请换端口：node scripts/serve-website-demo.mjs --port ${port === 65535 ? 4318 : port + 1}`);
  } else console.error(`启动失败：${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`AI Dreamcore 官网：http://127.0.0.1:${port}/`);
  console.log(`工作台 Demo：http://127.0.0.1:${port}/demo/`);
  console.log('仅供当前电脑访问。保持此终端运行，按 Ctrl+C 停止。');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
