import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGovernanceItem,
  isGovernancePage,
  createGovernanceClient,
} from '../src/material/governance-client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const item = {
  id,
  workspaceId: id,
  workspaceName: '共享资料',
  name: '合成.txt',
  version: 1,
  revision: 0,
  canEdit: false,
  canRedact: false,
  source: 'NOT_CHECKED',
  quality: null,
  issues: [],
  tags: [],
  reviewAt: null,
  checkedAt: null,
};
const page = {
  tenantId: id,
  summary: { total: 1, checked: 0, attention: 0, sensitive: 0, average: null },
  filteredTotal: 1,
  items: [item],
  hasMore: false,
};
test('unchecked has no fabricated score and invalid score or item is rejected', () => {
  assert.ok(isGovernanceItem(item));
  assert.ok(isGovernancePage(page));
  assert.equal(isGovernanceItem({ ...item, quality: 101 }), false);
  assert.equal(isGovernanceItem({ ...item, version: 0 }), false);
  assert.equal(isGovernancePage({ ...page, filteredTotal: 2 }), false);
});
test('governance response must belong to requested enterprise', async () => {
  const client = createGovernanceClient(
    (async () =>
      new Response(JSON.stringify({ ...page, tenantId: '00000000-0000-4000-8000-000000000002' }), {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  );
  await assert.rejects(client.list(id, '', 'all', 'all', 'priority', 0));
});
test('mutation uses csrf and the provided stable request and version guards', async () => {
  let payload: any, headers: any;
  const client = createGovernanceClient((async (url, init) => {
    if (String(url).endsWith('/csrf'))
      return new Response(JSON.stringify({ token: 'test-csrf', headerName: 'X-CSRF-TOKEN' }));
    payload = JSON.parse(String(init?.body));
    headers = init?.headers;
    return new Response(
      JSON.stringify({
        reportId: id,
        version: 2,
        revision: 2,
        source: 'ORIGINAL_TEXT',
        issues: [],
        tags: [],
        reviewAt: null,
        redacted: true,
      }),
    );
  }) as typeof fetch);
  const body = { requestId: id, expectedVersion: 1, expectedRevision: 1, tags: [], reviewAt: null };
  await client.change(id, id, body, true);
  assert.deepEqual(payload, body);
  assert.equal(headers['X-CSRF-TOKEN'], 'test-csrf');
});
