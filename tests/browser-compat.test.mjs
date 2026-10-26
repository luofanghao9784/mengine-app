import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../public/browser-compat.js', import.meta.url), 'utf8');
test('LAN fallback uses secure entropy and sets UUID v4 version and variant', () => {
  let calls = 0;
  const crypto = { getRandomValues(bytes) { calls++; bytes.fill(255); return bytes; } };
  runInNewContext(source, { crypto, Uint8Array });
  assert.equal(crypto.randomUUID(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(calls, 1);
});
test('preserves native implementation and remains idempotent', () => {
  const native = () => 'native';
  const crypto = { randomUUID: native };
  runInNewContext(source, { crypto });
  assert.equal(crypto.randomUUID, native);
  const fallback = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  runInNewContext(source, { crypto: fallback, Uint8Array });
  const first = fallback.randomUUID;
  runInNewContext(source, { crypto: fallback, Uint8Array });
  assert.equal(fallback.randomUUID, first);
  const values = Array.from({ length: 1000 }, () => first());
  assert.equal(new Set(values).size, 1000);
  assert.ok(values.every(v => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)));
});
test('does not invent insecure randomness when Web Crypto is absent', () => {
  const crypto = {};
  runInNewContext(source, { crypto });
  assert.equal(crypto.randomUUID, undefined);
});
