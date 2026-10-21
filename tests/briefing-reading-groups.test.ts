import test from 'node:test';
import assert from 'node:assert/strict';
import { readingGroups } from '../src/briefing-live/reading-groups.ts';
test('roles group new content of any length and order without losing untagged paragraphs', () => {
  const result = readingGroups(['建议访谈', '已记录需求', '可能有机会', '需确认能力', '补充资料', '第二个方案'], [
    { paragraphIndex: 0, role: 'ACTION' }, { paragraphIndex: 1, role: 'OBSERVATION' },
    { paragraphIndex: 2, role: 'INTERPRETATION' }, { paragraphIndex: 3, role: 'CAUTION' },
    { paragraphIndex: 5, role: 'OPTION' },
  ]);
  assert.deepEqual(result, { facts: ['已记录需求','补充资料'], judgments: ['可能有机会'], actions: ['建议访谈','第二个方案'], cautions: ['需确认能力'], structured: true });
});
test('facts do not invent advice and archived prefixes need no title match', () => {
  assert.deepEqual(readingGroups(['经营信号：历史事实','最小行动：核对记录']).actions, ['核对记录']);
  const facts = readingGroups(['事实'], [{paragraphIndex: 0, role:'OBSERVATION'}]);
  assert.deepEqual(facts.actions, []); assert.deepEqual(facts.judgments, []);
  assert.equal(readingGroups(['普通旧正文']).structured, false);
});
