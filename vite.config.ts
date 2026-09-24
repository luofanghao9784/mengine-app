import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
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
    proxy: { '/api': { target: process.env.DREAMCORE_DEV_API_URL || 'http://127.0.0.1:18181' } },
  },
});
