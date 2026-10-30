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

// Expected counts come from CheckTaskController's Java strip/codePointCount contract,
// not from the production helper. Keep request contents unchanged for server processing.
const boundaryCases: [string, string, string, number, number, boolean][] = [
  ['BMP材料上限', '文'.repeat(20_000), '', 20_000, 0, true],
  ['BMP材料超限', '文'.repeat(20_001), '', 20_001, 0, false],
  ['补充平面材料上限', '😀'.repeat(20_000), '', 20_000, 0, true],
  ['补充平面材料超限', '😀'.repeat(20_001), '', 20_001, 0, false],
  ['原审查复现10001表情', '😀'.repeat(10_001), '', 10_001, 0, true],
  [
    '首尾空白材料标题均达上限',
    ' \n' + '文'.repeat(20_000) + '\t ',
    '  ' + '题'.repeat(200) + '  ',
    20_000,
    200,
    true,
  ],
  ['首尾空白不抵消文中空格', '文'.repeat(19_999) + ' 文', '', 20_001, 0, false],
  ['空材料', '', '', 0, 0, false],
  [
    '全Java空白',
    '\t\n\u000b\f\r\u001c\u001d\u001e\u001f \u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200a\u2028\u2029\u205f\u3000',
    '',
    0,
    0,
    false,
  ],
  ['JS不去掉的控制空白在Java会去掉', '\u001c文\u001f', '\u001d题\u001e', 1, 1, true],
  ['NBSP不是Java空白', '\u00a0', '', 1, 0, true],
  ['NBSP包围材料超限', '\u00a0' + '文'.repeat(20_000) + '\u00a0', '', 20_002, 0, false],
  ['figure space不去掉', '\u2007', '', 1, 0, true],
  ['narrow NBSP不去掉', '\u202f', '', 1, 0, true],
  ['BOM不去掉', '\ufeff', '', 1, 0, true],
  ['NEL不去掉', '\u0085', '', 1, 0, true],
  ['BMP标题上限', '文', '题'.repeat(200), 1, 200, true],
  ['BMP标题超限', '文', '题'.repeat(201), 1, 201, false],
  ['补充平面标题上限', '文', '😀'.repeat(200), 1, 200, true],
  ['补充平面标题超限', '文', '😀'.repeat(201), 1, 201, false],
  ['标题全Java空白允许', '文', '\u001c \n\u3000', 1, 0, true],
  ['标题NBSP不得裁掉', '文', '\u00a0' + '题'.repeat(200), 1, 201, false],
  ['组合表情不是单码点', '👩‍💻', 'e\u0301', 3, 2, true],
];

for (const [name, materialText, title, materialLength, titleLength, valid] of boundaryCases) {
  test(`与后端输入边界一致：${name}`, async (t) => {
    const { qualityCheckInputState } = await import('../src/identity/quality-check-input.ts');
    assert.deepEqual(qualityCheckInputState(materialText, title), { materialLength, titleLength, valid });
    const posts: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
      if (String(path).endsWith('/csrf'))
        return new Response(JSON.stringify({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' }));
      posts.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          taskId: '00000000-0000-4000-8000-000000000043',
          status: 'COMPLETED',
          result: { verdict: 'NO_ISSUES', issues: [] },
        }),
        { status: 201 },
      );
    });
    if (valid) {
      await submitQualityCheck(materialText, title);
      assert.deepEqual(posts, [{ materialText, ...(title ? { title } : {}) }]);
    } else {
      await assert.rejects(submitQualityCheck(materialText, title), (error: unknown) => {
        assert.ok(error instanceof IdentityError);
        assert.equal(error.code, 'INVALID_REQUEST');
        assert.equal(error.status, 400);
        return true;
      });
      assert.equal(posts.length, 0);
    }
  });
}
