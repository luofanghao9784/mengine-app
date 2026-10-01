import assert from 'node:assert/strict';
import test from 'node:test';
import {
  briefingConversationHref,
  readBriefingContext,
  retainConversationContext,
} from '../src/conversation/briefing-context.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = { conversationId: id(2), workspaceId: id(3), taskId: id(4), taskRevision: 7, attempt: 2 };
test('briefing links carry exact version references and open an editable conversation', () => {
  const href = briefingConversationHref(id(1), task);
  assert.deepEqual(readBriefingContext(href), task);
  assert.equal(new URLSearchParams(href.slice(1)).has('task'), false);
  assert.equal(readBriefingContext(href.replace('briefingRevision=7', 'briefingRevision=NaN')), undefined);
  assert.equal(readBriefingContext(href.replace('briefingAttempt=2', 'briefingAttempt=-1')), undefined);
});
test('only the same tenant and conversation retain a briefing result reference', () => {
  const previous = briefingConversationHref(id(1), task);
  const next = '#tenant=' + id(1) + '&view=conversations&conversation=' + id(2);
  assert.deepEqual(readBriefingContext(retainConversationContext(next, previous)), task);
  const different = retainConversationContext(next.replace(id(2), id(9)), previous);
  assert.equal(readBriefingContext(different), undefined);
  assert.equal(new URLSearchParams(different.slice(1)).get('from'), 'briefing');
  const otherTenant = next.replace(id(1), id(8));
  assert.equal(retainConversationContext(otherTenant, previous), otherTenant);
});
