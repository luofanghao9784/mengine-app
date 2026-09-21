import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only Node built-ins: the prebuilt demo needs no npm install or network access.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port')) {
  console.error('用法：node scripts/serve-demo.mjs [--port 4173]');
  process.exit(1);
}
const portText = args[1] ?? '4173';
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
  console.error('缺少 dist/index.html。请完整解压演示包；从源码运行时先执行 npm ci 和 npm run build。');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8',
};
function insideRoot(path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const server = createServer(async (request, response) => {
  function reply(status, message, headers = {}) {
    response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    response.end(request.method === 'HEAD' ? undefined : message);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
  } catch {
    reply(400, 'Invalid URL');
    return;
  }
  const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!insideRoot(requested)) {
    reply(403, 'Forbidden');
    return;
  }
  try {
    const path = await realpath(requested);
    if (!insideRoot(path)) {
      reply(403, 'Forbidden');
      return;
    }
    if (!(await stat(path)).isFile()) {
      reply(404, 'Not found');
      return;
    }
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    reply(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, 'Unable to read file');
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请换一个端口，例如：node scripts/serve-demo.mjs --port ${port === 65535 ? 4173 : port + 1}`);
  } else {
    console.error(`启动失败：${error.message}`);
  }
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`企业 AI 工作空间 Demo 已启动：http://127.0.0.1:${port}/`);
  console.log('仅供当前电脑访问。保持此终端运行，按 Ctrl+C 停止。');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
