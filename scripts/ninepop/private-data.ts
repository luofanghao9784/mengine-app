import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export function localDemoRequest(req: IncomingMessage) {
  const address = req.socket.remoteAddress;
  const host = req.headers.host || '';
  const origin = req.headers.origin;
  return (
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '') &&
    /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) &&
    (!origin || origin === `http://${host}`) &&
    !['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site'] || '')) &&
    req.headers['x-dreamcore-local-demo'] === '1'
  );
}
export function privateDemoHandler(dataDir?: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.url || '/').replaceAll('\\', '/');
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    if (/(?:^|\/)customer-data(?:\/|$)/.test(decoded) || (dataDir && decoded.includes(dataDir))) {
      res.statusCode = 403;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    // The explicit data route is the only supported way to read the private package.
    if (!pathname.startsWith('/__private-demo/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!dataDir || pathname !== '/__private-demo/ninepop') {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method !== 'GET' || !localDemoRequest(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    try {
      const bundle = JSON.parse(readFileSync(join(dataDir, '03-36张卡片数据.json'), 'utf8'));
      const { materials } = JSON.parse(readFileSync(join(dataDir, '09-资料阅读内容.json'), 'utf8'));
      // Do not return the raw source registry, which contains private filesystem paths.
      const body = JSON.stringify({
        schema_version: bundle.schema_version,
        dataset_id: bundle.dataset_id,
        generated_at: bundle.generated_at,
        spaces: bundle.spaces,
        cards: bundle.cards,
        suggested_first_screen: bundle.suggested_first_screen,
        materials,
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(body);
    } catch {
      res.statusCode = 503;
      res.end('资料包不可用，请先执行资料准备。');
    }
  };
}
export function privateNinepopDemo(dataDir?: string): Plugin {
  return {
    name: 'private-ninepop-demo',
    configResolved(config) {
      if (
        dataDir &&
        config.command === 'serve' &&
        ![undefined, false, '127.0.0.1', 'localhost', '::1'].includes(config.server.host)
      )
        throw new Error('9POP内部资料仅允许绑定本机地址。');
    },
    configureServer(server) {
      server.middlewares.use(privateDemoHandler(dataDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(privateDemoHandler());
    },
  };
}
