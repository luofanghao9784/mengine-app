// Builds the isolated design preview; never changes the authenticated client or calls an API.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = process.argv[2];
if (!destination) throw new Error('Pass the output directory for the standalone design preview');
await mkdir(destination, { recursive: true });
const result = await build({
  configFile: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    lib: { entry: 'src/skills/prototype-entry.tsx', name: 'DreamcoreSkillsPreview', formats: ['iife'] },
    minify: true,
  },
});
const files = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const js = files
  .filter((f) => f.type === 'chunk')
  .map((f) => f.code)
  .join('\n')
  .replaceAll('</script', '<\\/script');
const css = files
  .filter((f) => f.type === 'asset' && f.fileName.endsWith('.css'))
  .map((f) => f.source)
  .join('\n');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>梦擎 · 技能中心设计预览</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
await writeFile(resolve(destination, '技能中心-交互原型.html'), html);
console.log('Saved standalone skill center preview');
