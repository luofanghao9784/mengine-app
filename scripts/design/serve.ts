/** Starts a private Vite dev server for design previews and stops it afterwards. */
import { spawn } from 'node:child_process';

export async function withVite<T>(port: number, run: (base: string) => Promise<T>) {
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: 'ignore' },
  );
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base + '/workspace/')).ok) break;
      } catch {}
      if (i > 100) throw new Error('Vite did not start on ' + base);
      await new Promise((r) => setTimeout(r, 200));
    }
    return await run(base);
  } finally {
    server.kill();
  }
}
