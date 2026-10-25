import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDnsBootstrap, publicDnsResolver } from '../dist/runtime/public-routing.js';

test('Google DoH bootstrap pins its public endpoint and preserves the TLS hostname', async () => {
  let calls = 0;
  const bootstrap = publicDnsBootstrap(async (url, address) => {
    calls++;
    assert.equal(url.origin, 'https://dns.google');
    assert.equal(url.pathname, '/resolve');
    assert.equal(url.searchParams.get('name'), 'publisher.example.org');
    assert.deepEqual(address, { address: '8.8.8.8', family: 4 });
    return { status: 200, headers: { 'content-type': 'application/json' }, bytes: Buffer.from(JSON.stringify({
      Status: 0, Question: [{ name: 'publisher.example.org.' }], Answer: [{ type: 1, data: '93.184.216.34' }],
    })) };
  });
  const signal = AbortSignal.timeout(1000);
  assert.deepEqual(await publicDnsResolver(bootstrap)('publisher.example.org', signal), [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(bootstrap.fetch('https://other.example.org/', signal), /PUBLIC_DNS_FAILED/);
  assert.equal(calls, 1);
});

test('DoH answers retain private and fake-IP rejection before publisher access', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '198.18.0.1']) {
    const bootstrap = publicDnsBootstrap(async () => ({ status: 200, headers: { 'content-type': 'application/json' },
      bytes: Buffer.from(JSON.stringify({ Status: 0, Question: [{ name: 'publisher.example.org' }], Answer: [{ type: 1, data: address }] })),
    }));
    await assert.rejects(publicDnsResolver(bootstrap)('publisher.example.org'), /PUBLIC_ADDRESS_DENIED/);
  }
});
