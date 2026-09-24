// Run as a separate operator-owned process/service, never inside a task container.
import { setTimeout as delay } from 'node:timers/promises';
import { DockerSandbox } from '../dist/runtime/docker-sandbox.js';
const watch = process.argv[2] === '--watch';
if (process.argv.length > 3 || (process.argv[2] && !['--watch', '--once'].includes(process.argv[2])))
  throw Error('Use --once or --watch');
const executor = new DockerSandbox({
  socketPath: process.env.DREAMCORE_EXECUTOR_SOCKET ?? '',
  image: process.env.DREAMCORE_EXECUTOR_IMAGE ?? '',
  scope: process.env.DREAMCORE_EXECUTOR_SCOPE ?? '',
});
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop.abort());
do {
  try {
    const removed = await executor.reapExpired(Date.now(), stop.signal);
    if (removed || !watch) console.log(JSON.stringify({ removed }));
  } catch {
    if (stop.signal.aborted) break;
    console.error('EXECUTOR_REAP_FAILED');
    if (!watch) process.exitCode = 1;
  }
  if (!watch) break;
  await delay(5000, undefined, { signal: stop.signal }).catch(() => {});
} while (!stop.signal.aborted);
