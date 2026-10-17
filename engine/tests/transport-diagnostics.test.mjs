import test from 'node:test';
import assert from 'node:assert/strict';
import { chatFrames } from '../dist/runtime/chat-stream.js';

test('connection and TLS diagnostics disclose only allowlisted codes, never URLs, credentials or bodies', async () => {
  const originalFetch = globalThis.fetch, originalWarn = console.warn;
  try {
    for (const [code, nested, expected] of [
      ['UND_ERR_CONNECT_TIMEOUT', true, 'UND_ERR_CONNECT_TIMEOUT'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', false, 'ERR_TLS_CERT_ALTNAME_INVALID'],
      ['CERT_HAS_EXPIRED', true, 'CERT_HAS_EXPIRED'],
      ['private-untrusted-error-code', false, 'TRANSPORT_ERROR'],
    ]) {
      const logs = [];
      console.warn = value => logs.push(JSON.parse(value));
      globalThis.fetch = async () => {
        const error = new Error('private-body private-token https://private-host');
        if (nested) error.cause = { code, message: 'private-body' };
        else error.code = code;
        throw error;
      };
      await assert.rejects(async () => {
        for await (const _ of chatFrames(new URL('https://private-host'), 'private-token', { text: 'private-body' }, new AbortController().signal, 1000)) {}
      }, { code: 'MODEL_NETWORK_ERROR' });
      assert.deepEqual(logs, [{ event: 'MODEL_TRANSPORT_FAILED', timedOut: false, cancelled: false, code: expected }]);
      assert.doesNotMatch(JSON.stringify(logs), /private/);
    }
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; }
});
