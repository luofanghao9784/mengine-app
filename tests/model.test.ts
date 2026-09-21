import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seed,
  editMaterial,
  latest,
  publishSnapshot,
  requestShare,
  resolveRequest,
  applyDream,
  renameDemoProfile,
  upgradeDemoProfile,
} from '../src/model.ts';

test('无维护权限的修订留在个人空间，共享原件与确认标记不变', () => {
  const s = seed();
  const original = structuredClone(s.materials.find((d) => d.id === 'price')!);
  const edited = editMaterial(s, 'price', '个人修订', '服务价格表修订', '修订的简介', '调整说明');
  assert.equal(edited.space, 'personal');
  assert.equal(edited.sourceId, 'price');
  assert.equal(edited.confirmed, undefined);
  assert.deepEqual(
    s.materials.find((d) => d.id === 'price'),
    original,
  );
});
test('个人新版本不自动改变共享版，重复发布同一版本幂等', () => {
  const s = seed();
  const personal = s.materials.find((d) => d.id === 'proposal')!;
  const shared = publishSnapshot(
    s,
    personal.id,
    personal.title,
    latest(personal),
    personal.summary,
    'sales',
    '空间成员',
  );
  const originalContent = latest(shared).content;
  const sharedId = shared.id;
  publishSnapshot(s, personal.id, personal.title, latest(personal), personal.summary, 'sales', '空间成员');
  assert.equal(shared.versions.length, 1);
  editMaterial(s, personal.id, '新内容', personal.title, '新简介', '修改');
  assert.equal(latest(shared).content, originalContent);
  const updated = publishSnapshot(
    s,
    personal.id,
    personal.title,
    latest(personal),
    personal.summary,
    'sales',
    '空间成员',
  );
  assert.equal(updated.id, sharedId);
  assert.equal(updated.versions.length, 2);
  assert.equal(latest(updated).content, '新内容');
});
test('权限批准只发布申请时的快照，重复批准不会再次写入', () => {
  const s = seed();
  const personal = s.materials.find((d) => d.id === 'proposal')!;
  const before = latest(personal).content;
  const req = requestShare(s, personal.id, 'finance', '空间成员');
  assert.equal(requestShare(s, personal.id, 'finance', '空间成员').id, req.id);
  editMaterial(s, personal.id, '申请之后的新草稿', personal.title, '新的简介', '继续修订');
  resolveRequest(s, req.id, true);
  resolveRequest(s, req.id, true);
  const shared = s.materials.filter((d) => d.space === 'finance' && d.sourceId === personal.id);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].versions.length, 1);
  assert.equal(latest(shared[0]).content, before);
  assert.equal(s.spaces.find((s) => s.id === 'finance')!.canEdit, false);
});
test('同一版本调整查看范围不产生重复版本，共享条目原位管理保留身份', () => {
  const s = seed();
  const personal = s.materials.find((d) => d.id === 'proposal')!;
  const shared = publishSnapshot(
    s,
    personal.id,
    personal.title,
    latest(personal),
    personal.summary,
    'sales',
    '空间成员',
  );
  publishSnapshot(
    s,
    personal.id,
    personal.title,
    latest(personal),
    personal.summary,
    'sales',
    '仅空间负责人',
  );
  assert.equal(shared.visibility, '仅空间负责人');
  assert.equal(shared.versions.length, 1);
  publishSnapshot(s, shared.id, shared.title, latest(shared), shared.summary, 'sales', '空间成员');
  assert.equal(shared.visibility, '空间成员');
  assert.equal(shared.versions.length, 1);
});
test('拒绝权限申请不会改写共享资料', () => {
  const s = seed();
  const before = structuredClone(s.materials.filter((d) => d.space !== 'personal'));
  const req = requestShare(s, 'proposal', 'finance', '仅空间负责人');
  resolveRequest(s, req.id, false);
  resolveRequest(s, req.id, true);
  assert.equal(req.status, 'rejected');
  assert.deepEqual(
    s.materials.filter((d) => d.space !== 'personal'),
    before,
  );
});
test('个人修订获准后更新同一共享资料身份并保留历史', () => {
  const s = seed();
  const edited = editMaterial(s, 'price', '获准的新内容', '服务价格表', '新的摘要', '修订');
  const req = requestShare(s, edited.id, 'finance', '空间成员');
  resolveRequest(s, req.id, true);
  assert.equal(s.materials.filter((d) => d.id === 'price').length, 1);
  const original = s.materials.find((d) => d.id === 'price')!;
  assert.equal(original.versions.length, 4);
  assert.equal(latest(original).content, '获准的新内容');
  assert.equal(original.confirmed, 'price-v3');
});
test('梦境旧方案不可执行，当前批次执行一次并保留内容与报价', () => {
  const s = seed();
  const price = structuredClone(s.materials.find((d) => d.id === 'price'));
  s.dream.scheme = '按客户';
  s.dream.revision = 2;
  assert.equal(applyDream(s, 1), false);
  assert.equal(applyDream(s, 2), true);
  assert.equal(applyDream(s, 2), false);
  assert.deepEqual(s.materials.find((d) => d.id === 'proposal')!.tags, ['客户 A']);
  assert.deepEqual(
    s.materials.find((d) => d.id === 'price'),
    price,
  );
  assert.equal(s.activities.filter((a) => a.text.includes('梦境')).length, 1);
});
test('共享应用只发布申请快照，个人试填记录和草稿不被公开', () => {
  const s = seed();
  const app = {
    id: 'private',
    name: '私人试用',
    description: '应用配置',
    space: 'personal',
    hasDate: true,
    published: false,
  };
  s.apps.push(app);
  s.records.push({
    id: 'private-record',
    app: app.id,
    customer: '个人记录',
    owner: s.profile.name,
    status: '待跟进',
    note: '不随配置公开',
    date: '2026-09-17',
  });
  s.requests.push({
    id: 'request',
    kind: 'app',
    sourceId: app.id,
    title: app.name,
    target: 'sales',
    visibility: '空间成员',
    status: 'pending',
    summary: '',
    appSnapshot: structuredClone(app),
  });
  app.name = '申请后的草稿';
  resolveRequest(s, 'request', true);
  resolveRequest(s, 'request', true);
  assert.equal(app.space, 'personal');
  assert.equal(app.name, '申请后的草稿');
  const shared = s.apps.filter((a) => a.sourceId === app.id);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].name, '私人试用');
  assert.equal(s.records.filter((r) => r.app === shared[0].id).length, 0);
});

import {
  startCollaboration,
  submitCollaboration,
  actOnCollaboration,
  colleagueMaterials,
  updateBriefFromText,
} from '../src/colleagues.ts';

test('同事资料视图引用原条目，排除个人资料和无权查看的共享条目', () => {
  const s = seed();
  const price = s.materials.find((d) => d.id === 'price')!;
  const privateDoc = s.materials.find((d) => d.id === 'notes')!;
  privateDoc.owner = '周宁';
  assert.equal(
    colleagueMaterials(s, 'zhou').find((d) => d.id === 'price'),
    price,
  );
  assert.equal(
    colleagueMaterials(s, 'zhou').some((d) => d.id === 'notes'),
    false,
  );
  price.visibility = '仅空间负责人';
  assert.equal(
    colleagueMaterials(s, 'zhou').some((d) => d.id === 'price'),
    false,
  );
  price.visibility = '空间成员';
  s.spaces.find((x) => x.id === 'finance')!.members = ['周宁'];
  assert.equal(colleagueMaterials(s, 'zhou').length, 0);
});

test('同事协作必须按授权、生成、交付顺序推进，申请人不能代替接收方批准', () => {
  const s = seed();
  const before = structuredClone(s.materials);
  const spaces = structuredClone(s.spaces);
  const r = startCollaboration(s, 'finance-report');
  assert.equal(actOnCollaboration(s, r.id, 'generate', 'receiver'), false);
  assert.equal(actOnCollaboration(s, r.id, 'deliver', 'receiver'), false);
  assert.equal(submitCollaboration(s, r.id, { ...r.brief, purpose: ' ' }), false);
  assert.equal(submitCollaboration(s, r.id, { ...r.brief, month: '2026-13' }), false);
  assert.equal(submitCollaboration(s, r.id, r.brief), true);
  assert.equal(actOnCollaboration(s, r.id, 'authorize', 'requester'), false);
  assert.equal(r.status, 'pending');
  assert.equal(actOnCollaboration(s, r.id, 'authorize', 'receiver'), true);
  assert.equal(actOnCollaboration(s, r.id, 'generate', 'receiver'), true);
  assert.equal(r.status, 'review');
  assert.deepEqual(s.materials, before);
  assert.equal(
    s.chats.find((c) => c.id === r.chatId)!.messages.some((m) => !!m.doc),
    false,
  );
  assert.equal(actOnCollaboration(s, r.id, 'deliver', 'receiver'), true);
  assert.equal(actOnCollaboration(s, r.id, 'deliver', 'receiver'), false);
  assert.equal(s.materials.length, before.length + 1);
  const delivered = s.materials.find((d) => d.id === r.resultDocId)!;
  assert.equal(delivered.space, 'personal');
  assert.equal(delivered.visibility, '仅自己');
  assert.equal(delivered.confirmed, latest(delivered).id);
  assert.deepEqual(s.spaces, spaces);
  assert.equal(
    s.chats.find((c) => c.id === r.chatId)!.messages.filter((m) => m.doc === delivered.id).length,
    1,
  );
});

test('退回补充需要重新提交，生成采用获准需求快照，同会话不重复创建进行中的请求', () => {
  const s = seed();
  const r = startCollaboration(s, 'finance-report', 'client');
  assert.equal(startCollaboration(s, 'finance-report', 'client').id, r.id);
  submitCollaboration(s, r.id, r.brief);
  actOnCollaboration(s, r.id, 'clarify', 'receiver', '请说明销售范围');
  assert.equal(r.status, 'changes_requested');
  assert.equal(actOnCollaboration(s, r.id, 'authorize', 'receiver'), false);
  updateBriefFromText(r, '2026年7月销售业务，用于预算复盘');
  assert.equal(r.brief.month, '2026-07');
  assert.equal(r.brief.scope, '销售业务');
  submitCollaboration(s, r.id, r.brief);
  assert.equal(r.revision, 2);
  actOnCollaboration(s, r.id, 'authorize', 'receiver');
  const authorized = structuredClone(r.authorizedBrief);
  updateBriefFromText(r, '2026年9月全公司');
  assert.deepEqual(r.brief, authorized);
  r.brief.month = '2026-09'; // Even a later mutation cannot silently change the authorized snapshot.
  actOnCollaboration(s, r.id, 'generate', 'receiver');
  assert.match(r.draftContent!, /2026-07/);
  assert.match(r.draftContent!, /180,000/);
});

test('拒绝或取消后不能授权与交付，已生成草稿在取消时清除', () => {
  for (const outcome of ['reject', 'cancel'] as const) {
    const s = seed();
    const count = s.materials.length;
    const r = startCollaboration(s, 'finance-report');
    submitCollaboration(s, r.id, r.brief);
    if (outcome === 'cancel') {
      actOnCollaboration(s, r.id, 'authorize', 'receiver');
      actOnCollaboration(s, r.id, 'generate', 'receiver');
    }
    assert.equal(actOnCollaboration(s, r.id, outcome, outcome === 'cancel' ? 'requester' : 'receiver'), true);
    assert.equal(actOnCollaboration(s, r.id, 'authorize', 'receiver'), false);
    assert.equal(actOnCollaboration(s, r.id, 'deliver', 'receiver'), false);
    assert.equal(r.draftContent, undefined);
    assert.equal(s.materials.length, count);
  }
});

import { upgradeWorkspaceExamples, workspaceKind } from '../src/workspaceExamples.ts';

test('项目样例增量升级保留旧会话、用户修订和权限，不重复添加或重置空间设置', () => {
  const s = seed();
  s.spaces = s.spaces.filter((x) => !x.id.startsWith('project-'));
  s.chats = s.chats.filter((x) => !x.id.startsWith('project-'));
  s.materials = s.materials.filter((x) => !x.id.startsWith('project-'));
  s.activities = s.activities.filter((x) => !x.id.startsWith('project-'));
  delete s.workspaceExamplesVersion;
  s.spaces.find((x) => x.id === 'sales')!.name = '销售空间';
  s.spaces.find((x) => x.id === 'finance')!.name = '财务空间';
  s.chats.find((x) => x.id === 'client')!.title = '用户修改后的客户会话';
  const draft = s.materials.find((x) => x.id === 'proposal')!;
  latest(draft).content = '需要完整保留的个人修订';
  const original = structuredClone(draft);
  s.spaces.push({
    id: 'custom',
    name: '我自己的持续业务',
    owner: s.profile.name,
    members: [s.profile.name],
    instructions: '保持原样',
    description: '用户创建的空间',
    canEdit: true,
  });
  upgradeWorkspaceExamples(s);
  assert.equal(s.spaces.find((x) => x.id === 'sales')!.name, '销售部门工作空间');
  assert.equal(s.spaces.find((x) => x.id === 'finance')!.name, '财务部门工作空间');
  assert.equal(s.spaces.find((x) => x.id === 'finance')!.canEdit, false);
  assert.equal(workspaceKind(s.spaces.find((x) => x.id === 'custom')!), 'business');
  assert.equal(s.chats.find((x) => x.id === 'client')!.space, 'sales');
  assert.equal(s.chats.find((x) => x.id === 'client')!.title, '用户修改后的客户会话');
  assert.deepEqual(
    s.materials.find((x) => x.id === 'proposal'),
    original,
  );
  s.spaces.find((x) => x.id === 'project-delivery')!.description = '用户在样例上继续工作';
  const snapshot = structuredClone(s);
  upgradeWorkspaceExamples(s);
  assert.deepEqual(s, snapshot);
});

test('项目个人修订显式发布回同一项目身份，源版本与跨部门引用可追溯', () => {
  const s = seed();
  for (const space of s.spaces.filter((x) => x.kind === 'project')) {
    const c = s.chats.find((c) => c.space === space.id)!;
    const draft = s.materials.find((d) => d.id === c.messages.find((m) => m.doc)?.doc)!;
    assert.equal(draft.space, 'personal');
    assert.equal(draft.visibility, '仅自己');
    for (const ref of c.messages.flatMap((m) => m.refs || []))
      assert.ok(s.materials.some((d) => d.id === ref));
    const shared = s.materials.find((d) => d.id === draft.sourceId)!;
    assert.equal(shared.space, space.id);
    assert.equal(shared.versions.length, 2);
    const sharedCount = s.materials.filter((d) => d.space === space.id).length;
    const updated = publishSnapshot(
      s,
      draft.id,
      draft.title,
      latest(draft),
      draft.summary,
      space.id,
      '空间成员',
    );
    assert.equal(updated.id, shared.id);
    assert.equal(updated.versions.length, 3);
    assert.equal(s.materials.filter((d) => d.space === space.id).length, sharedCount);
    assert.equal(draft.space, 'personal');
  }
});

// Directory changes must not change material identity, sharing or version history.
import {
  createFolder,
  folderTrail,
  moveMaterialToFolder,
  canReadMaterial,
  visibleSpaces,
} from '../src/libraryModel.ts';

test('文件夹支持嵌套、同级去重与空间隔离，移动仅改变位置', () => {
  const s = seed();
  const root = createFolder(s, 'personal', '客户 A');
  const child = createFolder(s, 'personal', '交付文档', root.id);
  assert.deepEqual(
    folderTrail(s, 'personal', child.id).map((f) => f.name),
    ['客户 A', '交付文档'],
  );
  assert.throws(() => createFolder(s, 'personal', ' 客户 A '), /同名/);
  assert.throws(() => createFolder(s, 'finance', '私自建目录'), /权限/);
  assert.throws(() => createFolder(s, 'sales', '错误父目录', root.id), /不可用/);
  const doc = s.materials.find((d) => d.id === 'proposal')!;
  const before = structuredClone(doc);
  moveMaterialToFolder(s, doc.id, child.id);
  assert.deepEqual({ ...doc, folderId: undefined }, { ...before, folderId: undefined });
  assert.equal(doc.folderId, child.id);
  const enterprise = createFolder(s, 'sales', '企业目录');
  assert.throws(() => moveMaterialToFolder(s, doc.id, enterprise.id), /不可用/);
  moveMaterialToFolder(s, doc.id);
  assert.equal(doc.folderId, undefined);
});

test('发布与申请保存目标文件夹，重复批准幂等，更新保留企业资料位置', () => {
  const s = seed();
  const folder = createFolder(s, 'sales', '交付文档');
  const doc = s.materials.find((d) => d.id === 'proposal')!;
  const req = requestShare(s, doc.id, 'sales', '空间成员', folder.id);
  assert.equal(requestShare(s, doc.id, 'sales', '空间成员', folder.id).id, req.id);
  editMaterial(s, doc.id, '申请后新写的内容', doc.title, doc.summary, '个人修订');
  resolveRequest(s, req.id, true);
  resolveRequest(s, req.id, true);
  const shared = s.materials.find((d) => d.sourceId === doc.id && d.space === 'sales')!;
  assert.equal(shared.folderId, folder.id);
  assert.equal(shared.versions.length, 1);
  assert.notEqual(latest(shared).content, latest(doc).content);
  publishSnapshot(s, doc.id, doc.title, latest(doc), doc.summary, 'sales', '空间成员');
  assert.equal(shared.folderId, folder.id);
  assert.equal(shared.versions.length, 2);
  publishSnapshot(s, doc.id, doc.title, latest(doc), doc.summary, 'sales', '空间成员', '');
  assert.equal(shared.folderId, undefined);
  assert.equal(shared.versions.length, 2);
  assert.throws(() => requestShare(s, doc.id, 'finance', '空间成员', folder.id), /不可用/);
});

test('申请目标失效时不提前批准，个人修订不携带企业文件夹，列表遵守演示可见范围', () => {
  const s = seed();
  s.spaces.find((x) => x.id === 'finance')!.canEdit = true;
  const folder = createFolder(s, 'finance', '财务资料');
  const price = s.materials.find((d) => d.id === 'price')!;
  price.folderId = folder.id;
  s.spaces.find((x) => x.id === 'finance')!.canEdit = false;
  const revision = editMaterial(s, price.id, '个人修订', '修订', '说明', '修订');
  assert.equal(revision.folderId, undefined);
  const request = requestShare(s, revision.id, 'finance', '空间成员', folder.id);
  s.folders = [];
  assert.throws(() => resolveRequest(s, request.id, true), /不可用/);
  assert.equal(request.status, 'pending');
  price.visibility = '仅空间负责人';
  assert.equal(canReadMaterial(s, price), false);
  s.spaces.find((x) => x.id === 'finance')!.members = [];
  assert.equal(
    visibleSpaces(s).some((x) => x.id === 'finance'),
    false,
  );
  assert.equal(canReadMaterial(s, price), false);
});

import {
  syncBriefing,
  openBriefingChat,
  snapshotOn,
  replyToBriefing,
  cardConfig,
  followupRows,
  canReadCardData,
} from '../src/briefing.ts';

test('画报增量升级保留所有既有资料与会话，来源计数遵循可见空间', () => {
  const s = seed();
  const old = structuredClone(s);
  syncBriefing(s, '2026-09-19T01:00:00.000Z');
  assert.deepEqual(s.chats, old.chats);
  assert.deepEqual(s.materials, old.materials);
  assert.equal(s.briefing!.cards.find((c) => c.id === 'followup:personal')!.data.value, '3');
  assert.equal(s.briefing!.cards.find((c) => c.id === 'followup:sales')!.data.value, '6');
  const n = s.briefing!.cards.length;
  syncBriefing(s, '2026-09-19T02:00:00.000Z');
  assert.equal(s.briefing!.cards.length, n);
  s.spaces.find((x) => x.id === 'sales')!.members = [];
  syncBriefing(s, '2026-09-19T03:00:00.000Z');
  assert.equal(s.briefing!.cards.find((c) => c.id === 'followup:sales')!.active, false);
  assert.equal(followupRows(s, 'personal').length, 0);
  assert.equal(
    canReadCardData(s, s.briefing!.cards.find((c) => c.id === 'insight:guide')!.history[0].data),
    false,
  );
});

test('关注、关闭和布局不刷新内容时间；隐藏期间仍更新，历史快照不被覆写', () => {
  const s = syncBriefing(seed(), '2026-09-18T01:00:00.000Z');
  const card = s.briefing!.cards.find((c) => c.id === 'dream')!;
  const before = structuredClone(card.history[0]);
  card.pinned = true;
  card.hidden = true;
  card.config = { size: '2×2', title: '整理建议', compact: true };
  syncBriefing(s, '2026-09-18T02:00:00.000Z');
  assert.equal(card.updatedAt, before.at);
  assert.equal(card.history.length, 1);
  assert.equal(s.dream.status, 'pending');
  applyDream(s, s.dream.revision);
  syncBriefing(s, '2026-09-19T01:00:00.000Z');
  assert.deepEqual(card.history[0], before);
  assert.equal(card.history.length, 2);
  assert.match(snapshotOn(card, '2026-09-18')!.data.fact, /等待确认/);
  assert.match(snapshotOn(card, '2026-09-19')!.data.fact, /已/);
  assert.equal(snapshotOn(card, '2026-09-17'), undefined);
  assert.equal(card.hidden, true);
  card.hidden = false;
  assert.equal(s.dream.status, 'done');
  assert.equal(card.pinned, true);
});

test('同一事项与优化分别复用会话，回看不覆盖此前消息，归档会话可继续', () => {
  const s = syncBriefing(seed(), '2026-09-18T01:00:00.000Z');
  const card = s.briefing!.cards.find((c) => c.id === 'dream')!;
  const optimizeId = openBriefingChat(s, card.id, 'optimize');
  assert.equal(card.chatId, undefined);
  assert.equal(openBriefingChat(s, card.id, 'optimize'), optimizeId);
  const id = openBriefingChat(s, card.id, 'content');
  assert.notEqual(id, optimizeId);
  assert.equal(openBriefingChat(s, card.id, 'content'), id);
  const chat = s.chats.find((c) => c.id === id)!;
  const messages = structuredClone(chat.messages);
  applyDream(s, s.dream.revision);
  syncBriefing(s, '2026-09-19T01:00:00.000Z');
  openBriefingChat(s, card.id, 'content');
  assert.deepEqual(chat.messages.slice(0, messages.length), messages);
  openBriefingChat(s, card.id, 'content', card.history[0]);
  assert.match(chat.briefingContext!.snapshot.fact, /等待确认/);
  assert.equal(s.dream.status, 'done');
  assert.equal(chat.briefingContext!.asOf, '2026-09-18T01:00:00.000Z');
  chat.archived = true;
  assert.equal(openBriefingChat(s, card.id, 'content'), id);
  assert.equal(chat.archived, false);
});

test('优化会话只修改草案；内容回复不批准申请、不改变任务状态', () => {
  const s = syncBriefing(seed());
  const card = s.briefing!.cards.find((c) => c.id === 'followup:personal')!;
  const config = structuredClone(cardConfig(card));
  const optimizeId = openBriefingChat(s, card.id, 'optimize');
  replyToBriefing(s, optimizeId, '改成 1×2，精简一点，标题改为我的进展');
  assert.deepEqual(cardConfig(card), config);
  assert.deepEqual(s.chats.find((c) => c.id === optimizeId)!.briefingContext!.draft, {
    size: '1×2',
    title: '我的进展',
    compact: true,
  });
  const doc = s.materials.find((d) => d.id === 'proposal')!;
  const request = requestShare(s, doc.id, 'finance', '空间成员');
  syncBriefing(s);
  const requestCard = s.briefing!.cards.find((c) => c.data.sourceId === request.id)!;
  const chatId = openBriefingChat(s, requestCard.id, 'content');
  replyToBriefing(s, chatId, '全部批准并发布');
  assert.equal(request.status, 'pending');
  const histories = requestCard.history.length;
  resolveRequest(s, request.id, true);
  syncBriefing(s);
  assert.equal(requestCard.history.length, histories + 1);
  assert.equal(openBriefingChat(s, requestCard.id, 'content'), chatId);
});

test('跨空间经营快照不因个人归属而绕过当前来源可见范围', () => {
  const s = syncBriefing(seed());
  const card = s.briefing!.cards.find((c) => c.id === 'followup:personal')!;
  const old = structuredClone(card.history[0]);
  s.apps.push({
    id: 'personal-app',
    name: '个人跟进',
    description: '测试',
    space: 'personal',
    hasDate: true,
    published: false,
  });
  s.spaces.find((x) => x.id === 'sales')!.members = [];
  syncBriefing(s);
  assert.equal(card.active, true);
  assert.equal(canReadCardData(s, old.data), false);
  assert.throws(() => openBriefingChat(s, card.id, 'content', old), /不可访问/);
  assert.equal(canReadCardData(s, card.data), true);
});

test('财务版式样例明确合成来源，四周金额与合计一致', () => {
  const s = syncBriefing(seed());
  const d = s.briefing!.cards.find((c) => c.id === 'finance:demo-receipts')!.data;
  assert.match(d.source, /合成/);
  assert.equal(d.unit, '万元');
  assert.equal(
    d.items!.reduce((sum, item) => sum + Number(item.value), 0),
    Number(d.value),
  );
  s.spaces.find((x) => x.id === 'finance')!.members = [];
  syncBriefing(s);
  assert.equal(s.briefing!.cards.find((c) => c.id === d.id)!.active, false);
});

import { hiddenPilePositions, groupBriefingEntries, layoutBriefingSpread } from '../src/briefingLayout.ts';

test('画报拼版按日期分组、视觉与键盘同序、不重叠，手动规格优先且不改内容', () => {
  const s = syncBriefing(seed(), '2026-09-19T01:00:00.000Z');
  const manual = s.briefing!.cards.find((c) => c.id === 'dream')!;
  manual.config = { ...cardConfig(manual), size: '1×2' };
  const before = structuredClone(s);
  const entries = s.briefing!.cards.map((card) => ({ card, data: card.data, at: card.updatedAt }));
  const groups = groupBriefingEntries(entries, '最新');
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups.flatMap((g) => g.entries),
    [...entries].sort((a, b) => b.at.localeCompare(a.at)),
  );
  for (const columns of [1, 2, 3, 4, 5]) {
    for (const group of groups) {
      for (const spread of [group.entries]) {
        const layout = layoutBriefingSpread(spread, columns);
        assert.deepEqual(
          layout.map((p) => p.entry.card.id).sort(),
          spread.map((entry) => entry.card.id).sort(),
        );
        assert.deepEqual(layoutBriefingSpread(spread, columns), layout);
        let previous = -1;
        const occupied = new Set();
        for (const p of layout) {
          assert.ok(p.col + p.width <= columns);
          assert.equal(p.size, `${p.width}×${p.height}`);
          const start = p.row * columns + p.col;
          assert.ok(start > previous);
          previous = start;
          if (p.entry.card.id === manual.id) assert.equal(p.size, '1×2');
          for (let y = 0; y < p.height; y++)
            for (let x = 0; x < p.width; x++) {
              const cell = (p.row + y) * columns + p.col + x;
              assert.equal(occupied.has(cell), false);
              occupied.add(cell);
            }
        }
        const piles = hiddenPilePositions(layout, columns, 3);
        for (const p of piles) {
          const cell = p.row * columns + p.col;
          assert.ok(cell > previous);
          assert.equal(occupied.has(cell), false);
          occupied.add(cell);
          previous = cell;
        }
      }
    }
  }
  assert.deepEqual(s, before);
  for (const view of ['类型', '空间'] as const) {
    for (const group of groupBriefingEntries(entries, view)) {
      assert.equal(new Set(group.entries.map((e) => (view === '类型' ? e.data.type : e.data.space))).size, 1);
      assert.equal(group.day, undefined);
    }
  }
});

test('画报优先用后续卡片补空，只有没有匹配尺寸时才适配默认卡片', () => {
  const base = syncBriefing(seed()).briefing!.cards[0];
  const entries = (sizes: import('../src/briefing.ts').CardSize[]) =>
    sizes.map((size, index) => {
      const card = structuredClone(base);
      card.id = `packing-${index}`;
      card.config = undefined;
      card.data = {
        ...card.data,
        id: card.id,
        size,
        type: '经营数据',
        template: 'number',
        presentation: undefined,
      };
      return { card, data: card.data, at: card.updatedAt };
    });
  const cards = entries(['2×2', '2×2', '2×1', '1×1', '1×1']);
  const before = structuredClone(cards);
  const result = layoutBriefingSpread(cards, 5);
  assert.deepEqual(
    result.map((p) => p.entry.card.id),
    ['packing-0', 'packing-1', 'packing-3', 'packing-4', 'packing-2'],
  );
  assert.deepEqual(
    result.map((p) => p.size),
    ['2×2', '2×2', '1×1', '1×1', '2×1'],
  );
  assert.deepEqual(
    result.slice(2, 4).map((p) => [p.row, p.col]),
    [
      [0, 4],
      [1, 4],
    ],
  );
  assert.deepEqual(cards, before);
  const wide = entries(['2×2', '2×2', '2×2']);
  assert.equal(layoutBriefingSpread(wide, 5)[2].size, '1×2');
  wide[2].card.config = { ...cardConfig(wide[2].card), size: '2×2' };
  assert.equal(layoutBriefingSpread(wide, 5)[2].size, '2×2');
  assert.equal(layoutBriefingSpread(entries(['2×2', '2×2', '2×2']), 5, true)[2].size, '2×2');
});

test('默认画报在一至五列以及隐藏部分卡片后，中途不留空格且不改写数据', () => {
  const s = syncBriefing(seed(), '2026-09-20T00:00:00.000Z');
  const before = structuredClone(s);
  const entries = s
    .briefing!.cards.filter((c) => c.active)
    .map((card) => ({ card, data: card.data, at: card.updatedAt }));
  for (const view of ['最新', '关注', '类型', '空间'] as const)
    for (const group of groupBriefingEntries(entries, view)) {
      for (const columns of [1, 2, 3, 4, 5])
        for (const visible of [group.entries, group.entries.filter((_, i) => i % 3 !== 0)]) {
          const layout = layoutBriefingSpread(visible, columns);
          const occupied = new Set<number>();
          for (const p of layout)
            for (let y = 0; y < p.height; y++)
              for (let x = 0; x < p.width; x++) occupied.add((p.row + y) * columns + p.col + x);
          const last = layout.at(-1);
          if (last)
            for (let cell = 0; cell < last.row * columns + last.col; cell++)
              assert.ok(occupied.has(cell), `${view}/${group.id}/${columns}列空格 ${cell}`);
          assert.equal(new Set(layout.map((p) => p.entry.card.id)).size, visible.length);
        }
    }
  assert.deepEqual(s, before);
});

test('调整尺寸先保留当前卡片行列，其他卡片补位，视觉与键盘同序且不重叠', () => {
  const s = syncBriefing(seed(), '2026-09-20T00:00:00.000Z');
  const before = structuredClone(s);
  const entries = s
    .briefing!.cards.filter((c) => c.active)
    .map((card) => ({ card, data: card.data, at: card.updatedAt }));
  for (const historical of [false, true])
    for (const group of groupBriefingEntries(entries, '最新'))
      for (const columns of [1, 2, 3, 4, 5]) {
        const original = layoutBriefingSpread(group.entries, columns, historical);
        for (const current of original)
          for (const size of ['1×1', '1×2', '2×1', '2×2'] as const) {
            const anchor = { id: current.entry.card.id, row: current.row, col: current.col };
            const result = layoutBriefingSpread(
              group.entries,
              columns,
              historical,
              { [anchor.id]: size },
              anchor,
            );
            const resized = result.find((p) => p.entry.card.id === anchor.id)!;
            assert.deepEqual([resized.row, resized.col], [current.row, current.col]);
            assert.equal(resized.size, columns - current.col === 1 ? `1×${size[2]}` : size);
            assert.deepEqual(
              result.map((p) => p.entry.card.id).sort(),
              original.map((p) => p.entry.card.id).sort(),
            );
            const cells = new Set<number>();
            let previous = -1;
            for (const p of result) {
              const start = p.row * columns + p.col;
              assert.ok(start > previous);
              previous = start;
              assert.ok(p.col + p.width <= columns);
              for (let y = 0; y < p.height; y++)
                for (let x = 0; x < p.width; x++) {
                  const cell = (p.row + y) * columns + p.col + x;
                  assert.equal(cells.has(cell), false);
                  cells.add(cell);
                }
            }
          }
      }
  assert.deepEqual(s, before);
});

test('缩小中间卡片后同组卡片补空，空余留在末尾，隐藏锚点不占位', () => {
  const base = syncBriefing(seed()).briefing!.cards[0];
  const entries = (['2×2', '2×2', '1×1', '1×1', '2×1'] as const).map((size, index) => {
    const card = structuredClone(base);
    card.id = `anchor-${index}`;
    card.data = { ...card.data, id: card.id, size };
    card.config = { ...cardConfig(card), size };
    return { card, data: card.data, at: card.updatedAt };
  });
  const anchor = { id: 'anchor-1', row: 0, col: 2 };
  const result = layoutBriefingSpread(entries, 5, false, { [anchor.id]: '1×1' }, anchor);
  assert.deepEqual(
    result.map((p) => [p.entry.card.id, p.row, p.col]),
    [
      ['anchor-0', 0, 0],
      ['anchor-1', 0, 2],
      ['anchor-2', 0, 3],
      ['anchor-3', 0, 4],
      ['anchor-4', 1, 2],
    ],
  );
  const remaining = entries.filter((e) => e.card.id !== anchor.id);
  assert.deepEqual(layoutBriefingSpread(remaining, 5, false, {}, anchor), layoutBriefingSpread(remaining, 5));
});

test('自动显示规格带入优化草案，但不修改来源尺寸、快照和手动设置', () => {
  const s = syncBriefing(seed());
  const c = s.briefing!.cards.find((c) => c.id === 'deliverable:proposal')!;
  const before = structuredClone(c);
  const id = openBriefingChat(s, c.id, 'optimize', undefined, { ...cardConfig(c), size: '2×1' });
  assert.equal(s.chats.find((c) => c.id === id)!.briefingContext!.draft!.size, '2×1');
  assert.deepEqual(c.history, before.history);
  assert.equal(c.data.size, before.data.size);
  assert.equal(c.config, undefined);
  replyToBriefing(s, id, '改成 1×2');
  openBriefingChat(s, c.id, 'optimize', undefined, { ...cardConfig(c), size: '2×2' });
  assert.equal(s.chats.find((c) => c.id === id)!.briefingContext!.draft!.size, '1×2');
});

import { relativeBriefingDay } from '../src/briefingLayout.ts';
test('画报相对日期按日历日计算，仅为过去一至五天补充小字', () => {
  const today = '2026-09-19';
  assert.equal(relativeBriefingDay('2026-09-18', today), '昨天');
  assert.equal(relativeBriefingDay('2026-09-17', today), '前天');
  assert.equal(relativeBriefingDay('2026-09-16', today), '三天前');
  assert.equal(relativeBriefingDay('2026-09-15', today), '四天前');
  assert.equal(relativeBriefingDay('2026-09-14', today), '五天前');
  assert.equal(relativeBriefingDay('2026-09-13', today), '');
  assert.equal(relativeBriefingDay(today, today), '');
  assert.equal(relativeBriefingDay('2026-09-20', today), '');
  assert.equal(relativeBriefingDay('2026-02-28', '2026-03-01'), '昨天');
  assert.equal(relativeBriefingDay('2025-12-31', '2026-01-02'), '前天');
});

import { briefingPeople, briefingPhoto } from '../src/briefingMedia.ts';
test('画报配图和项目成员为只读呈现，按明确关联和当前可见范围展示成员', () => {
  const s = syncBriefing(seed());
  const before = structuredClone(s);
  const project = s.briefing!.cards.find((c) => c.id === 'project:project-delivery')!;
  assert.deepEqual(briefingPeople(s, project.data), ['许然', s.profile.name, '陈言', '周宁']);
  const news = s.briefing!.cards.find((c) => c.id === 'news:direction')!;
  assert.match(briefingPhoto(news.data)!.src, /^\/images\/briefing\//);
  assert.deepEqual(briefingPeople(s, news.data), []);
  assert.equal(briefingPhoto(project.data), undefined);
  assert.deepEqual(s, before);
  const personalWithProjectReference = { ...news.data, refs: ['project-delivery-plan'] };
  assert.deepEqual(briefingPeople(s, personalWithProjectReference), briefingPeople(s, project.data));
  s.spaces.find((space) => space.id === 'project-delivery')!.members = ['许然'];
  assert.deepEqual(briefingPeople(s, project.data), []);
  assert.deepEqual(briefingPeople(s, personalWithProjectReference), []);
});

test('原卡片逐版本留在消息中，往返历史版本不重复，当前状态不被回看恢复', () => {
  const s = syncBriefing(seed(), '2026-09-18T01:00:00.000Z');
  const card = s.briefing!.cards.find((c) => c.id === 'dream')!;
  const first = structuredClone(card.history[0]);
  const id = openBriefingChat(s, card.id, 'content');
  const chat = s.chats.find((c) => c.id === id)!;
  const reference = structuredClone(chat.messages.find((m) => m.briefing)!.briefing);
  applyDream(s, s.dream.revision);
  syncBriefing(s, '2026-09-19T01:00:00.000Z');
  openBriefingChat(s, card.id, 'content');
  openBriefingChat(s, card.id, 'content', first);
  openBriefingChat(s, card.id, 'content');
  assert.equal(chat.messages.filter((m) => m.briefing).length, 2);
  assert.deepEqual(chat.messages.find((m) => m.briefing)!.briefing, reference);
  assert.equal(s.dream.status, 'done');
});

test('旧版文字背景增量补齐卡片引用，不重复消息或丢失用户讨论', () => {
  const s = syncBriefing(seed());
  const card = s.briefing!.cards.find((c) => c.id === 'finance:demo-receipts')!;
  const id = openBriefingChat(s, card.id, 'content');
  const chat = s.chats.find((c) => c.id === id)!;
  delete chat.messages[0].briefing;
  const originalText = chat.messages[0].text;
  chat.messages.push({ id: 'old-user-message', role: 'user', text: '保留我的分析要求' });
  openBriefingChat(s, card.id, 'content');
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[0].text, originalText);
  assert.equal(chat.messages[0].briefing!.cardId, card.id);
  assert.equal(chat.messages[1].text, '保留我的分析要求');
});

import { briefingDocuments } from '../src/briefingMedia.ts';
test('文档封面按明确来源与一层关联去重，只展示可读文档，不改写卡片快照', () => {
  const s = syncBriefing(seed());
  const data = s.briefing!.cards.find((c) => c.id === 'deliverable:proposal')!.data;
  const before = structuredClone(s);
  assert.deepEqual(
    briefingDocuments(s, s.briefing!.cards.find((c) => c.id === 'dream')!.data).map((d) => d.id),
    ['proposal', 'notes', 'brief'],
  );
  assert.deepEqual(
    briefingDocuments(s, data).map((d) => d.id),
    ['proposal', 'price', 'needs'],
  );
  assert.deepEqual(s, before);
  const price = s.materials.find((d) => d.id === 'price')!;
  price.visibility = '仅空间负责人';
  assert.deepEqual(
    briefingDocuments(s, data).map((d) => d.id),
    ['proposal', 'needs'],
  );
  assert.equal(briefingDocuments(s, { ...data, refs: ['price'] }).length, 0);
  const news = s.briefing!.cards.find((c) => c.id === 'news:direction')!.data;
  assert.deepEqual(briefingDocuments(s, news), []);
});

import { resizeBriefingSize } from '../src/briefingLayout.ts';
test('拖拽尺寸吸附有回差、只产生标准规格，预览不写配置或来源', () => {
  assert.equal(resizeBriefingSize('1×1', '1×1', 157, 0, 100, 5), '2×1');
  assert.equal(resizeBriefingSize('1×1', '1×1', 57, 0, 100, 5), '1×1');
  assert.equal(resizeBriefingSize('1×1', '2×1', 50, 0, 100, 5), '2×1');
  assert.equal(resizeBriefingSize('1×1', '2×1', 41, 0, 100, 5), '1×1');
  assert.equal(resizeBriefingSize('2×2', '2×2', -5000, -5000, 100, 5), '1×1');
  assert.equal(resizeBriefingSize('1×1', '1×1', 5000, 5000, 100, 5), '2×2');
  assert.equal(resizeBriefingSize('1×1', '1×1', 5000, 60, 100, 1), '1×2');
  const s = syncBriefing(seed());
  const before = structuredClone(s);
  const entries = s.briefing!.cards.map((card) => ({ card, data: card.data, at: card.updatedAt }));
  const placement = layoutBriefingSpread(entries, 5, false, { dream: '2×2' });
  assert.equal(placement.find((p) => p.entry.card.id === 'dream')!.size, '2×2');
  assert.deepEqual(s, before);
});

import { briefingExamples, upgradeBriefingExamples } from '../src/briefingExamples.ts';

test('四期画报有 46 张独立内容卡片、34 份可读来源，数字口径与日期一致', () => {
  const s = syncBriefing(seed(), '2026-09-20T00:00:00.000Z');
  const cards = s.briefing!.cards.filter((c) => c.active && c.data.sourceKind !== 'conversation');
  assert.equal(cards.length, 46);
  assert.equal(new Set(cards.map((c) => c.id)).size, 46);
  assert.equal(new Set(cards.map((c) => c.data.type)).size, 8);
  assert.equal(briefingExamples.length, 34);
  const editions: Record<string, number> = {};
  for (const example of briefingExamples) {
    const c = cards.find((c) => c.id === `demo:${example.key}`)!;
    assert.equal(c.updatedAt, new Date(example.at).toISOString());
    assert.equal(c.history.length, 1);
    assert.equal(snapshotOn(c, '2026-09-16'), undefined);
    editions[example.at.slice(0, 10)] = (editions[example.at.slice(0, 10)] || 0) + 1;
    assert.ok(canReadCardData(s, c.data));
    assert.match(c.data.source, /合成演示/);
    assert.ok(c.data.prompts.length >= 2);
    const source = s.materials.find((d) => d.id === c.data.sourceId)!;
    assert.equal(source.space, c.data.space);
    assert.equal(latest(source).date, example.at.slice(0, 10));
    assert.match(latest(source).content, /合成演示材料/);
    assert.ok(latest(source).content.includes(example.detail));
    assert.ok(s.folders!.some((f) => f.id === source.folderId && f.space === source.space));
    if (['chart', 'trend'].includes(c.data.template)) {
      const sum = c.data.items!.reduce((n, item) => n + Number(item.value), 0);
      assert.ok(Math.abs(sum - Number(c.data.value)) < 1e-9);
    }
  }
  assert.deepEqual(editions, { '2026-09-20': 10, '2026-09-19': 8, '2026-09-18': 8, '2026-09-17': 8 });
});

test('旧浏览器只增补新资料和卡片，不改用户偏好、版本、消息及已有历史，重复升级不复活删除资料', () => {
  const s = syncBriefing(seed(), '2026-09-19T01:00:00.000Z');
  delete s.briefingExamplesVersion;
  s.materials = s.materials.filter((d) => !d.id.startsWith('briefing-example-'));
  s.folders = s.folders!.filter((f) => !f.id.startsWith('briefing-examples-'));
  s.briefing!.cards = s.briefing!.cards.filter((c) => !c.id.startsWith('demo:'));
  const original = s.briefing!.cards.find((c) => c.id === 'dream')!;
  original.pinned = true;
  original.hidden = true;
  original.config = { title: '我保留的标题', size: '1×2', compact: true };
  original.chatId = 'dream-chat';
  latest(s.materials.find((d) => d.id === 'proposal')!).content = '不能被覆盖的个人修改';
  const before = structuredClone(s);
  upgradeBriefingExamples(s);
  syncBriefing(s, '2026-09-20T00:00:00.000Z');
  for (const old of before.briefing!.cards)
    assert.deepEqual(
      s.briefing!.cards.find((c) => c.id === old.id),
      old,
    );
  for (const old of before.materials)
    assert.deepEqual(
      s.materials.find((d) => d.id === old.id),
      old,
    );
  for (const key of ['chats', 'spaces', 'records', 'apps', 'requests', 'activities', 'dream'] as const)
    assert.deepEqual(s[key], before[key]);
  const deleted = 'briefing-example-trial-roster';
  s.materials = s.materials.filter((d) => d.id !== deleted);
  upgradeBriefingExamples(s);
  syncBriefing(s, '2026-09-20T01:00:00.000Z');
  assert.ok(!s.materials.some((d) => d.id === deleted));
  assert.equal(s.briefing!.cards.find((c) => c.id === 'demo:trial-roster')!.active, false);
  const once = structuredClone(s);
  upgradeBriefingExamples(s);
  syncBriefing(s, '2026-09-21T00:00:00.000Z');
  assert.deepEqual(s, once);
});

test('新增样例均能进入独立会话并引用来源，读权限变化同时限制卡片和旧快照', () => {
  const s = syncBriefing(seed());
  const materials = structuredClone(s.materials);
  for (const c of s.briefing!.cards.filter((c) => c.id.startsWith('demo:'))) {
    const id = openBriefingChat(s, c.id, 'content');
    assert.equal(openBriefingChat(s, c.id, 'content'), id);
    const chat = s.chats.find((chat) => chat.id === id)!;
    assert.deepEqual(chat.briefingContext!.snapshot, c.data);
    assert.ok(chat.messages.some((m) => m.refs?.includes(c.data.sourceId)));
    replyToBriefing(s, id, c.data.prompts[0]);
    assert.match(chat.messages.at(-1)!.text, /演示核对清单/);
  }
  assert.deepEqual(s.materials, materials);
  const card = s.briefing!.cards.find((c) => c.id === 'demo:receivables-aging')!;
  s.spaces.find((space) => space.id === 'finance')!.members = [];
  syncBriefing(s);
  assert.equal(card.active, false);
  assert.equal(canReadCardData(s, card.history[0].data), false);
  assert.throws(() => openBriefingChat(s, card.id, 'content'), /不可用/);
});

test('默认演示身份升级同步资料归属与空间成员，保留权限、会话和卡片配置', () => {
  const s = syncBriefing(seed());
  assert.equal(s.profile.name, '曹鸿健');
  const collaboration = startCollaboration(s, 'finance-report');
  const spaces = visibleSpaces(s).map((space) => space.id);
  const readable = s.materials.filter((doc) => canReadMaterial(s, doc)).map((doc) => doc.id);
  s.chats[0].title = '保留我的会话名称';
  s.briefing!.cards[0].pinned = true;
  s.briefing!.cards[1].hidden = true;
  renameDemoProfile(s, '林知');
  delete s.demoProfileVersion;
  const before = structuredClone(s);
  upgradeDemoProfile(s);
  assert.equal(s.profile.name, '曹鸿健');
  assert.equal(s.collaborations.find((item) => item.id === collaboration.id)!.requester, '曹鸿健');
  assert.deepEqual(
    visibleSpaces(s).map((space) => space.id),
    spaces,
  );
  assert.deepEqual(
    s.materials.filter((doc) => canReadMaterial(s, doc)).map((doc) => doc.id),
    readable,
  );
  assert.deepEqual(
    s.spaces.map((space) => space.canEdit),
    before.spaces.map((space) => space.canEdit),
  );
  assert.deepEqual(s.chats, before.chats);
  assert.deepEqual(s.briefing, before.briefing);
  assert.deepEqual(
    s.materials.map((doc) => doc.versions),
    before.materials.map((doc) => doc.versions),
  );
  assert.equal(s.materials.find((doc) => doc.id === 'proposal')!.owner, '曹鸿健');
  assert.equal(s.materials.find((doc) => doc.id === 'price')!.owner, '周宁');
});

test('默认身份升级保留自定义称呼，只执行一次，不覆盖后续手动改名', () => {
  const s = seed();
  renameDemoProfile(s, '自定义称呼');
  delete s.demoProfileVersion;
  const before = structuredClone(s);
  upgradeDemoProfile(s);
  assert.deepEqual(s, { ...before, demoProfileVersion: 1 });
  renameDemoProfile(s, '林知');
  const renamed = structuredClone(s);
  upgradeDemoProfile(s);
  assert.deepEqual(s, renamed);
});

import { briefingPresentation, chartDescription } from '../src/briefingPresentation.ts';
import { briefingV2Examples } from '../src/briefingV2Examples.ts';

test('新版图表覆盖十二种表达，计划演算闭合、分面与原周报一致，每日仅一条资讯', () => {
  const s = syncBriefing(seed(), '2026-09-20T00:00:00.000Z');
  const cards = s.briefing!.cards;
  const before = structuredClone(s);
  const charts = cards.flatMap((c) => briefingPresentation(c.data)?.chart || []);
  assert.equal(new Set(charts.map((c) => c.kind)).size, 12);
  assert.ok(charts.every((c) => chartDescription(c).length > 10));
  const waterfall = charts.find((c) => c.kind === 'waterfall')!;
  assert.equal(
    waterfall.rows.slice(0, -1).reduce((sum, r) => sum + r.value, 0),
    waterfall.rows.at(-1)!.value,
  );
  const multiples = charts.find((c) => c.kind === 'multiples')!;
  const weekly = cards.find((c) => c.id === 'demo:qualified-inquiries')!.data.items!;
  assert.deepEqual(
    multiples.columns!.map((_, i) => multiples.series!.reduce((sum, s) => sum + s.values[i], 0)),
    weekly.map((d) => Number(d.value)),
  );
  const entries = cards.map((card) => ({ card, data: card.data, at: card.updatedAt }));
  for (const day of groupBriefingEntries(entries, '最新'))
    assert.equal(day.entries.filter((e) => e.data.type === '资讯').length, 1, day.id);
  const cash = cards.find((c) => c.id === 'demo:cash-bridge')!.data;
  assert.deepEqual(briefingPeople(s, cash), ['周宁']);
  assert.match(cash.people![0].role, /口径核对/);
  assert.deepEqual(s, before);
  s.spaces.find((space) => space.id === 'finance')!.members = [];
  assert.deepEqual(briefingPeople(s, cash), []);
  assert.deepEqual(briefingDocuments(s, cash), []);
});

test('V1 到 V2 只新增十份来源，保留旧卡偏好和消息，不复活此前删除的来源', () => {
  const s = syncBriefing(seed(), '2026-09-20T00:00:00.000Z');
  const newKeys = new Set(briefingV2Examples.map((e) => e.key));
  s.briefingExamplesVersion = 1;
  s.briefing!.cards = s.briefing!.cards.filter((c) => !newKeys.has(c.id.replace('demo:', '')));
  s.materials = s.materials.filter(
    (d) => !newKeys.has(d.id.replace('briefing-example-', '')) && d.id !== 'briefing-example-trial-roster',
  );
  const oldCard = s.briefing!.cards.find((c) => c.id === 'demo:launch-budget')!;
  oldCard.config = { title: '我的预算标题', size: '1×2', compact: true };
  oldCard.pinned = true;
  oldCard.hidden = true;
  const before = structuredClone(s);
  upgradeBriefingExamples(s);
  assert.equal(s.briefingExamplesVersion, 2);
  assert.equal(s.materials.length, before.materials.length + 10);
  assert.deepEqual(s.briefing, before.briefing);
  assert.deepEqual(s.chats, before.chats);
  assert.ok(!s.materials.some((d) => d.id === 'briefing-example-trial-roster'));
  syncBriefing(s, '2026-09-20T00:00:00.000Z');
  assert.deepEqual(
    s.briefing!.cards.find((c) => c.id === oldCard.id),
    before.briefing!.cards.find((c) => c.id === oldCard.id),
  );
  const once = structuredClone(s);
  upgradeBriefingExamples(s);
  syncBriefing(s, '2026-09-21T00:00:00.000Z');
  assert.deepEqual(s, once);
});
