import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationClient } from '../src/conversation/client.ts';
import { IdentityError } from '../src/identity/client.ts';
import { briefingConversationHref, readBriefingContext } from '../src/conversation/briefing-context.ts';
const tenant = '00000000-0000-4000-8000-000000000001',
  space = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003';
const conversation = {
  id,
  tenantId: tenant,
  workspaceId: space,
  title: 'synthetic',
  updatedAt: '2026-09-23T00:00:00Z',
};
const chunk = {
  id,
  tenantId: tenant,
  workspaceId: space,
  materialId: id,
  versionId: id,
  runId: id,
  version: 1,
  filename: 'test.md',
  locator: '第 1 行',
  method: 'TEXT',
  content: 'hello',
};
const task = {
  id,
  reply: null,
  executionClass: null,
  modelName: null,
  originals: [],
  artifacts: [],
  publicQuery: null,
  webSources: [],
  skills: [],
  prompt: 'hello',
  mode: 'SOURCE_LOOKUP',
  status: 'SUCCEEDED',
  revision: 2,
  attempt: 1,
  summaryCode: 'SOURCES_FOUND',
  errorCode: null,
  engineVersion: '0.2.0',
  sourcesUnavailable: false,
  sources: [chunk],
  createdAt: '2026-09-23T00:00:00Z',
};
const detail = { conversation, tasks: [task], cursor: 3, hasMore: false };
const response = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
test('historical result requires the exact successful task in the original conversation', async () => {
  const successful = {
    ...task,
    mode: 'AGENT',
    executionClass: 'verification',
    reply: '旧回复',
    modelName: 'fixture',
  };
  const anchored = { ...detail, tasks: [successful] };
  const accepted = await createConversationClient(async (url) => {
    assert.ok(String(url).endsWith(`/conversations/${id}/tasks/${id}`));
    return response(anchored);
  }).historical(tenant, id, id);
  assert.equal(accepted.tasks[0].reply, '旧回复');
  for (const tasks of [
    [],
    [successful, successful],
    [{ ...successful, id: space }],
    [{ ...successful, status: 'QUEUED' }],
  ])
    await assert.rejects(
      createConversationClient(async () => response({ ...detail, tasks })).historical(tenant, id, id),
    );
});
test('conversation reads reject foreign tenant, conversation and source scope', async () => {
  for (const v of [
    { ...detail, conversation: { ...conversation, tenantId: id } },
    { ...detail, conversation: { ...conversation, id: space } },
    { ...detail, tasks: [{ ...task, sources: [{ ...chunk, workspaceId: id }] }] },
    { ...detail, tasks: [{ ...task, status: 'IMAGINED_SUCCESS' }] },
  ])
    await assert.rejects(
      createConversationClient(async () => response(v)).detail(tenant, id),
      (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
    );
  assert.deepEqual(await createConversationClient(async () => response(detail)).detail(tenant, id), detail);
});
test('events reject cursor rollback and unsorted sequences', async () => {
  const event = { seq: 4, taskId: id, kind: 'SUCCEEDED', revision: 2 };
  for (const v of [
    { conversationId: id, cursor: 2, items: [], hasMore: false },
    { conversationId: id, cursor: 4, items: [event, event], hasMore: false },
    { conversationId: space, cursor: 4, items: [event], hasMore: false },
  ])
    await assert.rejects(createConversationClient(async () => response(v)).events(tenant, id, 3));
});
test('card discussion sends only version references while retaining display geometry and draft identity', async () => {
  const reference = { conversationId: id, taskId: id, workspaceId: space, taskRevision: 2, attempt: 1 };
  const displayed = { ...reference, presentation: { size: '2×2' as const, unit: 294.75 } };
  const context = readBriefingContext(briefingConversationHref(tenant, displayed))!;
  for (const destination of [undefined, id]) {
    let sends = 0;
    let sent: Record<string, unknown> | undefined;
    const body = { requestId: id, workspaceId: space, prompt: '合成画报数据缺口追问',
      mode: 'AGENT' as const, sourceScope: 'AUTHORIZED_LIBRARY' as const, briefingContext: context };
    const before = structuredClone(body);
    const api = createConversationClient(async (path, init) => {
      if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
      sends++;
      assert.equal(String(path), `/api/v1/tenants/${tenant}/conversations${destination ? `/${destination}/tasks` : ''}`);
      sent = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
      if ('presentation' in (sent!.briefingContext as object))
        return new Response(JSON.stringify({ code: 'INVALID_REQUEST' }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      return response(detail);
    });
    await api.send(tenant, destination, body);
    assert.deepEqual(sent, { ...body, briefingContext: reference });
    assert.equal(sends, 1);
    assert.deepEqual(body, before);
    assert.deepEqual(context.presentation, displayed.presentation);
  }
});

test('send retains caller request ID, uses CSRF and never automatically replays lost response', async () => {
  let sends = 0;
  const api = createConversationClient(async (path, init) => {
    if (String(path).endsWith('/csrf')) return response({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
    sends++;
    assert.equal(new Headers(init?.headers).get('X-CSRF-TOKEN'), 'synthetic');
    assert.equal(JSON.parse(String(init?.body)).requestId, id);
    throw new TypeError('lost reply');
  });
  await assert.rejects(
    api.send(tenant, undefined, {
      requestId: id,
      workspaceId: space,
      prompt: 'hello',
      mode: 'SOURCE_LOOKUP',
    }),
    (e) => e instanceof IdentityError && e.code === 'UNCERTAIN_RESULT',
  );
  assert.equal(sends, 1);
});
test('Agent results require explicit execution class and bounded artifact metadata', async () => {
  const valid = {
    ...task,
    mode: 'AGENT',
    executionClass: 'verification',
    reply: '合成回复',
    modelName: 'fixture',
    artifacts: [],
  };
  assert.equal(
    (await createConversationClient(async () => response({ ...detail, tasks: [valid] })).detail(tenant, id))
      .tasks[0].executionClass,
    'verification',
  );
  for (const value of [
    { ...valid, executionClass: null },
    { ...valid, executionClass: 'simulation-disguised-as-live' },
    { ...valid, artifacts: [{ id, filename: '../../private', sha256: '0'.repeat(64), bytes: 1 }] },
  ])
    await assert.rejects(
      createConversationClient(async () => response({ ...detail, tasks: [value] })).detail(tenant, id),
    );
});
test('artifact download verifies bytes and digest and does not follow redirects', async () => {
  const bytes = new TextEncoder().encode('result'),
    digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const artifact = { id, filename: 'result.txt', sha256: digest, bytes: bytes.length };
  const download = (content: string, status = 200) =>
    createConversationClient(async (path, init) => {
      assert.ok(String(path).endsWith(`/tasks/${id}/artifacts/${id}`));
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'same-origin');
      return new Response(content, {
        status,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="result.txt"',
          'x-content-sha256': digest,
        },
      });
    }).download(tenant, id, id, artifact);
  assert.equal(await (await download('result')).text(), 'result');
  await assert.rejects(
    download('tamper'),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
  await assert.rejects(
    download('x'.repeat(65537)),
    (e) => e instanceof IdentityError && e.code === 'CONTRACT_MISMATCH',
  );
  await assert.rejects(download('denied', 401), (e) => e instanceof IdentityError && e.status === 401);
});
test('public snapshots render only bounded HTTPS data and require Agent mode', async () => {
  const source = {
    id,
    url: 'https://example.com/article',
    title: '<script>untrusted</script>',
    excerpt: 'plain text',
    sha256: '0'.repeat(64),
    retrievedAt: '2026-09-23T00:00:00Z',
    kind: 'PAGE',
    truncated: false,
  };
  const valid = {
    ...task,
    mode: 'AGENT',
    executionClass: 'verification',
    publicQuery: 'public topic',
    webSources: [source],
    skills: [{ id: 'public-research', version: '1.1.0', sha256: '0'.repeat(64) }],
  };
  assert.equal(
    (await createConversationClient(async () => response({ ...detail, tasks: [valid] })).detail(tenant, id))
      .tasks[0].webSources[0].title,
    source.title,
  );
  for (const value of [
    { ...valid, webSources: [{ ...source, url: 'javascript:alert(1)' }] },
    { ...valid, webSources: [{ ...source, url: 'https://user:secret@example.com/' }] },
    { ...valid, webSources: [{ ...source, excerpt: 'x'.repeat(4001) }] },
    { ...valid, skills: [{ id: '../unknown', version: '1.0.0', sha256: '0'.repeat(64) }] },
    { ...task, webSources: [source] },
  ])
    await assert.rejects(
      createConversationClient(async () => response({ ...detail, tasks: [value] })).detail(tenant, id),
    );
});

test('original metadata rejects invalid version identities, duplicate grants and excessive byte counts', async () => {
  const original = {
    materialId: id,
    versionId: id,
    filename: 'full.csv',
    version: 1,
    bytes: 2,
    sha256: 'a'.repeat(64),
    read: true,
  };
  const valid = { ...task, mode: 'AGENT', executionClass: 'verification', originals: [original] };
  assert.deepEqual(
    (await createConversationClient(async () => response({ ...detail, tasks: [valid] })).detail(tenant, id))
      .tasks[0].originals,
    [original],
  );
  for (const originals of [
    [{ ...original, versionId: 'latest' }],
    [original, original],
    [{ ...original, bytes: 262145 }],
    [{ ...original, read: 'yes' }],
  ])
    await assert.rejects(
      createConversationClient(async () => response({ ...detail, tasks: [{ ...valid, originals }] })).detail(
        tenant,
        id,
      ),
    );
});

test('off-mode task can wait with no execution class; active task cannot invent an absent mode', async () => {
  const waiting = {
    ...task,
    mode: 'AGENT',
    status: 'WAITING_CAPABILITY',
    executionClass: null,
    attempt: 0,
    sources: [],
    summaryCode: null,
    waitReason: 'MODEL_NOT_CONFIGURED',
    requiredInput: null,
    reconciliationRequired: false,
  };
  assert.equal(
    (await createConversationClient(async () => response({ ...detail, tasks: [waiting] })).detail(tenant, id))
      .tasks[0].status,
    'WAITING_CAPABILITY',
  );
  await assert.rejects(
    createConversationClient(async () =>
      response({ ...detail, tasks: [{ ...waiting, status: 'RUNNING' }] }),
    ).detail(tenant, id),
  );
});
test('attempt history rejects mixed identity, invalid status and unbounded tools', async () => {
  const attempt = {
    number: 1,
    status: 'WAITING_INPUT',
    input: 'work',
    reply: 'partial',
    summaryCode: null,
    errorCode: null,
    engineVersion: '0.11.0',
    modelName: 'fixture',
    tools: [],
    sources: [],
    artifacts: [],
    startedAt: null,
    finishedAt: null,
    provenance: 'RECORDED',
    reconciliationCode: null,
  };
  assert.equal(
    (
      await createConversationClient(async () =>
        response({ taskId: id, items: [attempt], hasMore: false }),
      ).attempts(tenant, id, id)
    ).items[0].status,
    'WAITING_INPUT',
  );
  for (const bad of [
    { taskId: space, items: [attempt], hasMore: false },
    { taskId: id, items: [{ ...attempt, status: 'BUSINESS_DONE' }], hasMore: false },
    {
      taskId: id,
      items: [
        {
          ...attempt,
          tools: Array.from({ length: 9 }, () => ({ callId: 'a', name: 'search', status: 'succeeded' })),
        },
      ],
      hasMore: false,
    },
  ])
    await assert.rejects(createConversationClient(async () => response(bad)).attempts(tenant, id, id));
});

test('exact task detail accepts actionable waits but rejects another task or conversation', async () => {
  const waiting = {
    ...task,
    mode: 'AGENT',
    status: 'WAITING_INPUT',
    executionClass: 'verification',
    waitReason: 'INPUT_REQUIRED',
    requiredInput: '请补充截止日期',
  };
  const value = await createConversationClient(async () =>
    response({ ...detail, tasks: [waiting] }),
  ).taskDetail(tenant, id, id);
  assert.equal(value.tasks[0].status, 'WAITING_INPUT');
  for (const invalid of [
    { ...detail, tasks: [{ ...waiting, id: space }] },
    { ...detail, conversation: { ...conversation, id: space }, tasks: [waiting] },
  ])
    await assert.rejects(createConversationClient(async () => response(invalid)).taskDetail(tenant, id, id));
});

test('new task responses accept empty supplemental input while rejecting invalid types and oversized text', async () => {
  for (const supplementalInput of [undefined, null, '', '补充要求']) {
    const payload = { ...detail, tasks: [{ ...task, supplementalInput }] };
    const client = createConversationClient(async (url) => String(url).endsWith('/auth/csrf')
      ? response({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' }) : response(payload));
    assert.equal((await client.detail(tenant, id)).tasks[0].supplementalInput, supplementalInput);
    assert.equal((await client.send(tenant, undefined, { requestId: id, workspaceId: space, prompt: 'hello', mode: 'SOURCE_LOOKUP' })).conversation.id, id);
  }
  for (const supplementalInput of [false, 0, {}, 'x'.repeat(12001)]) {
    await assert.rejects(createConversationClient(async () => response({ ...detail, tasks: [{ ...task, supplementalInput }] })).detail(tenant, id),
      (error) => error instanceof IdentityError && error.code === 'CONTRACT_MISMATCH');
  }
});

test('conversation management metadata and receipts reject invalid or foreign responses', async () => {
  const page={tenantId:tenant,enabled:true,agentMode:'off',publicWebEnabled:false,hasMore:false,items:[{...conversation,managementRevision:0,running:true,unread:true,replyRevision:2,latestReplyTaskId:id,trashedAt:null}]};
  assert.equal((await createConversationClient(async()=>response(page)).list(tenant)).items[0].unread,true);
  for(const change of [{running:'yes'},{replyRevision:-1},{managementRevision:0.5},{latestReplyTaskId:'invalid'},{trashedAt:'bad-date'}]) {
    await assert.rejects(createConversationClient(async()=>response({...page,items:[{...page.items[0],...change}]})).list(tenant));
  }
  const body={requestId:id,expectedRevision:0,action:'TRASH' as const,stopRunning:true};
  for(const receipt of [{id:space,revision:1,trashedAt:null},{id,revision:-1,trashedAt:null},{id,revision:1,trashedAt:'bad-date'}])
    await assert.rejects(createConversationClient(async(url)=>response(String(url).endsWith('/csrf')?{headerName:'X-CSRF-TOKEN',token:'fixture'}:receipt)).manage(tenant,id,body));
  for(const receipt of [{id:space,readReplyRevision:2},{id,readReplyRevision:1}])
    await assert.rejects(createConversationClient(async(url)=>response(String(url).endsWith('/csrf')?{headerName:'X-CSRF-TOKEN',token:'fixture'}:receipt)).read(tenant,id,2));
  let path='';await createConversationClient(async(url)=>{path=String(url);return response({...page,items:[]});}).list(tenant,0,undefined,true);
  assert.ok(path.includes('/conversations/trash?'));
});

test('conversation list validates the persisted briefing discussion marker and tolerates older servers', async () => {
  for (const briefingDiscussion of [undefined, false, true]) {
    const page = await createConversationClient(async () => response({
      tenantId: tenant, enabled: true, agentMode: 'off', publicWebEnabled: false,
      items: [{ ...conversation, briefingDiscussion }], hasMore: false,
    })).list(tenant);
    assert.equal(page.items[0].briefingDiscussion, briefingDiscussion);
  }
  await assert.rejects(createConversationClient(async () => response({
    tenantId: tenant, enabled: true, agentMode: 'off', publicWebEnabled: false,
    items: [{ ...conversation, briefingDiscussion: 'true' }], hasMore: false,
  })).list(tenant));
});
