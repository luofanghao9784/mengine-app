import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const dataDir = resolve(process.env.NINEPOP_DEMO_DATA_DIR || 'customer-data/9pop-demo-2026-09-24');
if (!existsSync(dataDir)) throw new Error('未找到9POP内部资料包，请设置NINEPOP_DEMO_DATA_DIR。');
const prepare = spawnSync('python3', ['scripts/ninepop/prepare.py', dataDir], { stdio: 'inherit' });
if (prepare.status !== 0) process.exit(prepare.status || 1);
const port = process.env.NINEPOP_DEMO_PORT || '5196';
if (!/^\d+$/.test(port)) throw new Error('NINEPOP_DEMO_PORT必须为数字');
console.log(`9POP内部试用：http://127.0.0.1:${port}/?scenario=ninepop`);
const child = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'],
  {
    stdio: 'inherit',
    env: { ...process.env, NINEPOP_PRIVATE_DATA: dataDir },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
