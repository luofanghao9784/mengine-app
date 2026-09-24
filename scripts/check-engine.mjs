/** Read-only preflight. No tasks, model calls or tenant content. Credentials come from the environment. */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'expected-version': { type: 'string' },
    mode: { type: 'string', default: 'source-lookup' },
    'allow-legacy-090': { type: 'boolean', default: false },
  },
});
try {
  const url = new URL(values.url);
  if (
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('invalid endpoint');
  if (
    !/^[A-Za-z0-9.\-]{1,64}$/.test(values['expected-version'] || '') ||
    !['source-lookup', 'agent-verification', 'agent-live'].includes(values.mode)
  )
    throw Error('invalid selection');
  const token = process.env.TASK_ENGINE_TOKEN;
  if (!token || token.length < 32) throw Error('missing token');
  async function get(path) {
    const response = await fetch(new URL(path, url), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16384) throw Error('response limit');
      chunks.push(chunk);
    }
    return { status: response.status, body: Buffer.concat(chunks).toString() };
  }
  let response = await get('/internal/v1/runtime'),
    value;
  if (response.status === 404 && values['allow-legacy-090']) {
    response = await get('/internal/v1/capabilities');
    if (response.status !== 200) throw Error('legacy unavailable');
    const old = JSON.parse(response.body);
    const schema = JSON.parse(
      await readFile(new URL('../contracts/engine-api/capabilities.schema.json', import.meta.url), 'utf8'),
    );
    if (!new Ajv2020().compile(schema)(old) || old.engineVersion !== '0.9.0') throw Error('unknown legacy');
    value = {
      contractVersion: '1.0',
      engineVersion: old.engineVersion,
      runtimeMode: old.runtimeMode,
      protocols: { sourceLookup: '1.0', agentTask: '1.4', platformCallbacks: '1.3' },
    };
  } else {
    if (response.status !== 200) throw Error('runtime unavailable');
    value = JSON.parse(response.body);
  }
  const schema = JSON.parse(
    await readFile(new URL('../contracts/engine-api/runtime.schema.json', import.meta.url), 'utf8'),
  );
  if (!new Ajv2020().compile(schema)(value) || value.engineVersion !== values['expected-version'])
    throw Error('incompatible release');
  if (
    values.mode === 'source-lookup'
      ? value.runtimeMode === 'contract-only' || value.protocols.sourceLookup !== '1.0'
      : value.runtimeMode !== values.mode ||
        value.protocols.agentTask !== '1.4' ||
        !['1.3', '1.4'].includes(value.protocols.platformCallbacks)
  )
    throw Error('incompatible task mode');
  console.log(JSON.stringify({ status: 'compatible', ...value }));
} catch {
  console.error(
    'Engine preflight rejected: check endpoint, service credential, selected release and task protocols. No task was submitted.',
  );
  process.exitCode = 1;
}
