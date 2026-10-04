import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReplyBlocks } from '../src/conversation/reply-blocks.ts';

test('reply sections retain explicit paragraph boundaries without empty spacer paragraphs', () => {
  assert.deepEqual(parseReplyBlocks('一、数据说明'), [{kind: 'heading', level: 1, text: '一、数据说明'}]);
  assert.deepEqual(parseReplyBlocks('## 数据说明\n第一行\n第二行\n\n结论\n\n'), [
    { kind: 'heading', level: 2, text: '数据说明' },
    { kind: 'paragraph', text: '第一行\n第二行' },
    { kind: 'paragraph', text: '结论' },
  ]);
});
test('ordered sections contain indented details and preserve actual numbering', () => {
  const result = parseReplyBlocks('1. **口径**：保持原文\n2. **门店情况**\n  - 周一：100元\n  - 周二：缺记录\n3. **解释**：需核实\n\n**结论**：不能自动补零');
  assert.equal(result.length, 2);
  const list = result[0];
  assert.equal(list.kind, 'list');
  if (list.kind !== 'list') throw new Error('missing ordered list');
  assert.equal(list.ordered, true);
  assert.deepEqual(list.items.map(item => item.number), [1, 2, 3]);
  const nested = list.items[1].blocks[1];
  assert.equal(nested.kind, 'list');
  if (nested.kind !== 'list') throw new Error('missing nested list');
  assert.equal(nested.ordered, false);
  assert.deepEqual(nested.items.map(item => item.blocks[0]), [
    {kind: 'paragraph', text: '周一：100元'}, {kind: 'paragraph', text: '周二：缺记录'},
  ]);
  const skipped = parseReplyBlocks('3. 第三项\n5. 第五项')[0];
  assert.equal(skipped.kind, 'list');
  if (skipped.kind === 'list') assert.deepEqual(skipped.items.map(item => item.number), [3, 5]);
});
test('code, tables, and quotes retain source text without interpreting embedded HTML', () => {
  const text = '<script>alert(1)</script>\n\n> 引文\n> 第二行\n\n|门店|金额|\n|---|---|\n|合成店|100|\n\n```text\n1. 保留代码中的编号\n  <b>原样显示</b>\n```';
  assert.deepEqual(parseReplyBlocks(text), [
    {kind:'paragraph',text:'<script>alert(1)</script>'},
    {kind:'quote',text:'引文\n第二行'},
    {kind:'table',text:'|门店|金额|\n|---|---|\n|合成店|100|'},
    {kind:'code',text:'1. 保留代码中的编号\n  <b>原样显示</b>'},
  ]);
});
test('streaming fragments and deeply nested content remain renderable', () => {
  assert.deepEqual(parseReplyBlocks('让我\n'), [{kind:'paragraph',text:'让我'}]);
  assert.deepEqual(parseReplyBlocks('```js\nconst sample = '), [{kind:'code',text:'const sample = '}]);
  assert.doesNotThrow(() => parseReplyBlocks('1. '.repeat(2000) + 'text'));
});
