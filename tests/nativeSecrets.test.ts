import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets } from '../src/native-conversation/chat/secrets.ts';

test('known credential shapes are masked but keep a short prefix', () => {
  const out = maskSecrets('key sk-abcdefghijklmnopqrstuvwx and AKIAABCDEFGHIJKLMNOP');
  assert.equal(out.includes('abcdefghijklmnop'), false);
  assert.equal(out.includes('ABCDEFGHIJKLMNOP'), false);
  assert.match(out, /sk-a•+/);
  assert.match(out, /AKIA•+/);
});

test('labelled passwords are masked in Chinese and English', () => {
  assert.equal(maskSecrets('密码：Hunter2024!').includes('Hunter2024'), false);
  assert.equal(maskSecrets('password=letmein99').includes('letmein99'), false);
  assert.match(maskSecrets('密码：Hunter2024!'), /^密码：Hunt•+$/);
});

test('ordinary text is left alone', () => {
  const text = '帮我复核荔星中心店十月收款，金额 12,480.50 元，token 数不用管。';
  assert.equal(maskSecrets(text), text);
});
