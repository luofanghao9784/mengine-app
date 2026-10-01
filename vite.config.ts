import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { privateNinepopDemo } from './scripts/ninepop/private-data.ts';
export default defineConfig({
  plugins: [react(), privateNinepopDemo(process.env.NINEPOP_PRIVATE_DATA)],
  build: {
    rollupOptions: {
      input: ['index.html', 'workspace/index.html', 'tenant-admin/index.html', 'platform-admin/index.html'],
    },
  },
  preview: {
    proxy: { '/api': { target: process.env.DREAMCORE_DEV_API_URL || 'http://127.0.0.1:18181' } },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { deny: ['**/.env*', '**/*.{crt,pem,key}', '**/.git/**', '**/customer-data/**'] },
    proxy: { '/api': { target: process.env.DREAMCORE_DEV_API_URL || 'http://127.0.0.1:18181' } },
  },
});
