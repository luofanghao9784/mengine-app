import test from 'node:test';
import assert from 'node:assert/strict';
import { submitQualityCheck, qualityCheckFailureMessage } from '../src/identity/quality-check-client.ts';
import { IdentityError } from '../src/identity/client.ts';

const uncertain = '未收到确定的检查结果，结果尚不确定；重试可能再次提交材料，请谨慎操作';

test('10秒未收到结果仅报告不确定，不自动再次提交', async (t) => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' }));
    posts++;
    return new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    });
  });
  await assert.rejects(submitQualityCheck('问题：尺寸超差'), (error: unknown) => {
    assert.ok(error instanceof IdentityError);
    assert.equal(error.reason, 'timeout');
    assert.equal(qualityCheckFailureMessage(error), uncertain);
    return true;
  });
  assert.equal(posts, 1);
});

test('已提交后的网络中断同样不能确定结果', async (t) => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (String(path).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' }));
    posts++;
    throw new TypeError('Synthetic network failure');
  });
  await assert.rejects(submitQualityCheck('问题:尺寸超差'), (error: unknown) => {
    assert.equal(qualityCheckFailureMessage(error), uncertain);
    return true;
  });
  assert.equal(posts, 1);
});

test('调用方取消仍保持取消语义', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    submitQualityCheck('问题：尺寸超差', undefined, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof IdentityError);
      assert.equal(error.code, 'CANCELLED');
      return true;
    },
  );
});
