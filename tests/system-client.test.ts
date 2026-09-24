import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoSystemClient,
  createHttpSystemClient,
  SystemClientError,
} from '../src/data/systemClient.ts';

test('live client accepts the shared contract and never accepts Demo data from a server', async () => {
  const demo = await createDemoSystemClient().getInfo();
  const live = { ...demo, dataSource: 'live' };
  const fetcher = async (input: RequestInfo | URL) => {
    assert.equal(input, '/api/v1/system/info');
    return Response.json(live);
  };
  assert.deepEqual(await createHttpSystemClient('/api/v1/', fetcher).getInfo(), live);
  await assert.rejects(
    createHttpSystemClient('/api/v1', async () => Response.json(demo)).getInfo(),
    (e: unknown) => e instanceof SystemClientError && e.code === 'CONTRACT_MISMATCH',
  );
});

test('network, HTTP and incompatible responses are explicit errors, with no demo fallback', async () => {
  const demo = await createDemoSystemClient().getInfo();
  for (const [fetcher, code] of [
    [
      async () => {
        throw new Error('offline');
      },
      'NETWORK_ERROR',
    ],
    [async () => new Response('down', { status: 503 }), 'HTTP_ERROR'],
    [async () => Response.json({ ...demo, dataSource: 'live', contractVersion: '2.0' }), 'CONTRACT_MISMATCH'],
    [async () => new Response('<html>proxy error</html>'), 'CONTRACT_MISMATCH'],
  ] as const) {
    await assert.rejects(
      createHttpSystemClient('/api/v1', fetcher).getInfo(),
      (e: unknown) => e instanceof SystemClientError && e.code === code,
    );
  }
  for (const [status, code, retryable] of [
    [503, 'ENGINE_UNAVAILABLE', true],
    [502, 'ENGINE_INCOMPATIBLE', false],
  ] as const) {
    const fetcher = async () =>
      Response.json(
        {
          contractVersion: '1.0',
          code,
          retryable,
          message: 'internal upstream detail',
        },
        { status },
      );
    await assert.rejects(
      createHttpSystemClient('/api/v1', fetcher).getInfo(),
      (e: unknown) =>
        e instanceof SystemClientError &&
        e.code === code &&
        e.retryable === retryable &&
        !e.message.includes('internal upstream detail'),
    );
  }
});

test('caller cancellation and timeout have different recoverable behavior', async () => {
  const waitingFetch: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const waitingBodyFetch: typeof fetch = async (_input, init) =>
    new Response(
      new ReadableStream({
        start(stream) {
          if (init?.signal?.aborted) stream.error(new Error('aborted'));
          else
            init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')), { once: true });
        },
      }),
    );
  for (const fetcher of [waitingFetch, waitingBodyFetch]) {
    const controller = new AbortController();
    const request = createHttpSystemClient('/api/v1', fetcher).getInfo(controller.signal);
    await Promise.resolve();
    controller.abort();
    await assert.rejects(
      request,
      (e: unknown) => e instanceof SystemClientError && e.code === 'CANCELLED' && !e.retryable,
    );
    await assert.rejects(
      createHttpSystemClient('/api/v1', fetcher, 10).getInfo(),
      (e: unknown) => e instanceof SystemClientError && e.code === 'TIMEOUT' && e.retryable,
    );
  }
});
