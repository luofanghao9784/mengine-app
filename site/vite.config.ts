import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 官网直接使用仓库根目录的客户端源码（工作空间的真实界面、登录页的组件），不另抄一份。
const dreamcore = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@dreamcore': dreamcore },
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: ['..'] } },
  build: {
    assetsDir: 'website-assets',
    rollupOptions: { input: ['index.html', 'demo/index.html', 'login/index.html', 'login/admin.html', 'login/platform.html'] },
  },
});
