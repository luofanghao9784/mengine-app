import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { privateNinepopDemo } from './scripts/ninepop/private-data.ts';
export default defineConfig({
  plugins: [react(), privateNinepopDemo(process.env.NINEPOP_PRIVATE_DATA)],
  build: {
    rollupOptions: {
      input: [
        'index.html',
        'workspace/index.html',
        'tenant-admin/index.html',
        'tenant-admin/prototype/index.html',
        'tenant-admin/governance/index.html',
        'tenant-admin/support/index.html',
        'platform-admin/index.html',
        'agent-admin/index.html',
      ],
    },
  },
  preview: {
    proxy: {
      '/mengine-api': {
        target: process.env.MENGINE_API_URL || 'http://127.0.0.1:4400',
        timeout: 240000,
        proxyTimeout: 240000,
        rewrite: (path) => path.replace(/^\/mengine-api/, '/api'),
        bypass(req, res) {
          const path = (req.url || '').split('?')[0];
          const allowed =
            (req.method === 'GET' &&
              (/^\/mengine-api\/scene-foundation(?:\/[^/]+)?$/.test(path) ||
                /^\/mengine-api\/scene-knowledge(?:\/[^/]+\/source)?$/.test(path))) ||
            (req.method === 'POST' &&
              (/^\/mengine-api\/scene-foundation(?:\/scan|\/[^/]+\/actions)$/.test(path) ||
                path === '/mengine-api/scene-knowledge/sync' ||
                path === '/mengine-api/auth/login'));
          if (!allowed) {
            if (res) {
              res.statusCode = 404;
              res.end(JSON.stringify({ message: '此管理端不提供该操作' }));
            }
            return false;
          }
        },
      },
      '/api': { target: process.env.DREAMCORE_DEV_API_URL || 'http://127.0.0.1:18181' },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { deny: ['**/.env*', '**/*.{crt,pem,key}', '**/.git/**', '**/customer-data/**'] },
    proxy: {
      '/mengine-api': {
        target: process.env.MENGINE_API_URL || 'http://127.0.0.1:4400',
        timeout: 240000,
        proxyTimeout: 240000,
        rewrite: (path) => path.replace(/^\/mengine-api/, '/api'),
        bypass(req, res) {
          const path = (req.url || '').split('?')[0];
          const allowed =
            (req.method === 'GET' &&
              (/^\/mengine-api\/scene-foundation(?:\/[^/]+)?$/.test(path) ||
                /^\/mengine-api\/scene-knowledge(?:\/[^/]+\/source)?$/.test(path))) ||
            (req.method === 'POST' &&
              (/^\/mengine-api\/scene-foundation(?:\/scan|\/[^/]+\/actions)$/.test(path) ||
                path === '/mengine-api/scene-knowledge/sync' ||
                path === '/mengine-api/auth/login'));
          if (!allowed) {
            if (res) {
              res.statusCode = 404;
              res.end(JSON.stringify({ message: '此管理端不提供该操作' }));
            }
            return false;
          }
        },
      },
      '/api': { target: process.env.DREAMCORE_DEV_API_URL || 'http://127.0.0.1:18181' },
    },
  },
});
