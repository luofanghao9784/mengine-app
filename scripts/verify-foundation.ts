/** Starts only owned processes on temporary ports; no model, business data or external service. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { createHttpSystemClient, SystemClientError } from '../src/data/systemClient.ts';

const root = new URL('../', import.meta.url);
const children: ChildProcess[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let logs = '';
const readJson = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

function start(command: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.on('error', (error) => {
    logs = (logs + error.message).slice(-12000);
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (data) => {
      logs = (logs + data.toString()).slice(-12000);
    });
  }
  return child;
}

async function waitReady(url: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Owned service exited before readiness');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* startup */
    }
    await delay(200);
  }
  throw new Error('Service readiness timeout');
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(50);
  }
  child.kill('SIGKILL');
}

try {
  const used = new Set<number>();
  while (used.size < 3) used.add(await freePort());
  const [enginePort, apiPort, webPort] = [...used];
  let engine = start(process.execPath, ['engine/dist/main.js'], {
    ENGINE_PORT: String(enginePort),
    ENGINE_HOST: '127.0.0.1',
  });
  await waitReady(`http://127.0.0.1:${enginePort}/healthz`, engine);
  const api = start('java', ['-jar', 'apps/api/target/workspace-api-0.1.0-SNAPSHOT.jar'], {
    API_PORT: String(apiPort),
    API_HOST: '127.0.0.1',
    ENGINE_BASE_URL: `http://127.0.0.1:${enginePort}`,
    ENGINE_TIMEOUT_MS: '1000',
  });
  await waitReady(`http://127.0.0.1:${apiPort}/actuator/health`, api);
  const client = createHttpSystemClient(`http://127.0.0.1:${apiPort}/api/v1`);
  const info = await client.getInfo();
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(await readJson('contracts/engine-api/capabilities.schema.json'));
  const validate = ajv.compile(await readJson('contracts/public-api/system-info.schema.json'));
  assert.ok(validate(info), JSON.stringify(validate.errors));
  assert.equal(info.integrations.harness, 'not-configured');
  const web = start(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort)],
    {
      DREAMCORE_DEV_API_URL: `http://127.0.0.1:${apiPort}`,
    },
  );
  await waitReady(`http://127.0.0.1:${webPort}`, web);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${webPort}/#/library/enterprise`);
  await page
    .getByRole('group', { name: '资料范围' })
    .getByRole('button', { name: '企业资料库', exact: true })
    .waitFor();
  // Exercise the actual browser module and Vite proxy, not a separately reimplemented fetch.
  const inBrowser = await page.evaluate(async () => {
    const modulePath = '/src/data/systemClient.ts';
    const { createHttpSystemClient } = await import(modulePath);
    return createHttpSystemClient().getInfo();
  });
  assert.deepEqual(inBrowser, info);
  await stop(engine);
  await assert.rejects(
    client.getInfo(),
    (error: unknown) => error instanceof SystemClientError && error.status === 503,
  );
  const failureCode = await page.evaluate(async () => {
    const modulePath = '/src/data/systemClient.ts';
    const { createHttpSystemClient } = await import(modulePath);
    try {
      await createHttpSystemClient().getInfo();
      return 'unexpected-success';
    } catch (error) {
      return (error as { status: number }).status;
    }
  });
  assert.equal(failureCode, 503);
  engine = start(process.execPath, ['engine/dist/main.js'], {
    ENGINE_PORT: String(enginePort),
    ENGINE_HOST: '127.0.0.1',
  });
  await waitReady(`http://127.0.0.1:${enginePort}/healthz`, engine);
  assert.deepEqual(await client.getInfo(), info);
  console.log(
    'PASS: browser → platform → independent engine; schema, stopped-engine error, restart recovery; no model call.',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  for (const child of [...children].reverse()) await stop(child);
}
