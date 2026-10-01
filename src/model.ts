import { upgradeWorkspaceExamples } from './workspaceExamples.ts';
import { upgradeBriefingExamples } from './briefingExamples.ts';
import type { Collaboration } from './colleagues.ts';
import type { BriefingState, BriefingChatContext, BriefingReference } from './briefing.ts';
import { validateDestination, type MaterialFolder } from './libraryModel.ts';
export type Space = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  owner: string;
  members: string[];
  canEdit: boolean;
  kind?: 'project' | 'department' | 'business';
  project?: { goal: string; phase: string; targetDate: string };
};
export type Version = {
  id: string;
  number: number;
  content: string;
  summary: string;
  note: string;
  date: string;
};
export type Material = {
  id: string;
  title: string;
  space: string;
  folderId?: string;
  type: string;
  summary: string;
  status: '使用中' | '已过期' | '已归档';
  tags: string[];
  versions: Version[];
  confirmed?: string;
  relations: string[];
  owner: string;
  visibility: string;
  sourceId?: string;
  sourceVersion?: string;
  sourceLinks?: SourceLink[];
  photo?: SourcePhoto;
};
export type SourceLink = { title: string; url: string; publishedAt: string; eventDate?: string | null };
export type SourcePhoto = {
  src: string;
  alt: string;
  credit: string;
  sourceUrl: string;
  fit?: 'cover' | 'contain';
};
export type Message = {
  id: string;
  createdAt?: string;
  role: 'user' | 'assistant';
  text: string;
  doc?: string;
  refs?: string[];
  refVersions?: Record<string, string>;
  briefing?: BriefingReference;
};
export type Chat = {
  id: string;
  title: string;
  space: string;
  messages: Message[];
  kind: 'normal' | 'dream' | 'dashboard' | 'builder' | 'colleague' | 'briefing' | 'briefing-optimize';
  archived: boolean;
  origin?: 'conversation' | 'briefing' | 'other';
  context?: string;
  briefingContext?: BriefingChatContext;
};
export type Followup = {
  id: string;
  app: string;
  customer: string;
  owner: string;
  status: '待跟进' | '已联系' | '已约定';
  note: string;
  date: string;
  nextDate?: string;
};
export type MiniApp = {
  id: string;
  name: string;
  description: string;
  space: string;
  hasDate: boolean;
  published: boolean;
  sourceId?: string;
  external?: { url: string };
};
export type Request = {
  id: string;
  kind: 'material' | 'app';
  sourceId: string;
  title: string;
  target: string;
  targetFolderId?: string;
  visibility: string;
  status: 'pending' | 'approved' | 'rejected';
  version?: Version;
  appSnapshot?: MiniApp;
  summary: string;
};
export type DemoState = {
  schema: 1;
  scenario?: 'konggu' | 'ninepop';
  ninepop?: { datasetId: string; generatedAt: string; cards: import('./briefing.ts').CardData[] };
  folders?: MaterialFolder[];
  workspaceExamplesVersion?: number;
  briefingExamplesVersion?: number;
  demoProfileVersion?: number;
  briefing?: BriefingState;
  profile: { name: string; compact: boolean; autoMemory: boolean };
  spaces: Space[];
  chats: Chat[];
  materials: Material[];
  records: Followup[];
  apps: MiniApp[];
  requests: Request[];
  collaborations: Collaboration[];
  memories: { id: string; text: string }[];
  dream: { scheme: '按客户' | '按月份'; keepPrices: boolean; status: 'pending' | 'done'; revision: number };
  dashboards: Record<string, { recent: boolean; distribution: boolean }>;
  activities: { id: string; space: string; text: string; date: string }[];
};
export const uid = () => crypto.randomUUID();
export function renameDemoProfile(s: DemoState, name: string) {
  const old = s.profile.name;
  s.profile.name = name;
  for (const record of s.records) if (record.owner === old) record.owner = name;
  for (const material of s.materials) if (material.owner === old) material.owner = name;
  for (const space of s.spaces) {
    space.members = space.members.map((member) => (member === old ? name : member));
    if (space.owner === old) space.owner = name;
  }
  for (const request of s.collaborations) if (request.requester === old) request.requester = name;
}
export function upgradeDemoProfile(s: DemoState) {
  if ((s.demoProfileVersion || 0) >= 1) return s;
  if (s.profile.name === '林知') renameDemoProfile(s, '曹鸿健');
  s.demoProfileVersion = 1;
  return s;
}
export const today = () => new Date().toLocaleDateString('sv-SE');
export const latest = (doc: Material) => doc.versions.at(-1)!;
export const spaceName = (s: DemoState, id: string) =>
  id === 'personal'
    ? '个人空间'
    : id === 'none'
      ? '未归入空间'
      : s.spaces.find((x) => x.id === id)?.name || '工作空间';
export const canEdit = (s: DemoState, space: string) =>
  space === 'personal' || !!s.spaces.find((x) => x.id === space)?.canEdit;
export function activity(s: DemoState, space: string, text: string) {
  s.activities.unshift({ id: uid(), space, text, date: '刚刚' });
  s.activities = s.activities.slice(0, 40);
}
const proposal =
  '一、合作目标\n围绕客户需求，明确服务范围与交付计划，帮助团队建立清晰、可持续的工作方式。\n\n二、实施安排\n需求梳理 → 方案确认 → 分阶段交付\n第一阶段：梳理业务流程与已有资料。\n第二阶段：完成方案与配置，组织团队试用。\n第三阶段：回顾使用反馈，持续完善。\n\n三、报价依据\n参考最新服务价格表，最终报价待确认。\n\n四、交付成果\n业务流程说明、实施计划与培训材料。';
function material(
  id: string,
  title: string,
  space: string,
  content: string,
  summary: string,
  type = '文档',
): Material {
  return {
    id,
    title,
    space,
    type,
    summary,
    status: '使用中',
    tags: [],
    versions: [{ id: `${id}-v1`, number: 1, content, summary, note: '初始版本', date: '2026-09-16' }],
    relations: [],
    owner: space === 'finance' ? '周宁' : '曹鸿健',
    visibility: space === 'personal' ? '仅自己' : '空间成员',
  };
}
export function seed(): DemoState {
  const draft = material(
    'proposal',
    '客户 A 合作方案',
    'personal',
    proposal,
    '客户 A 的合作目标、实施安排与交付计划。',
  );
  draft.versions.push({
    ...draft.versions[0],
    id: 'proposal-v2',
    number: 2,
    note: '补充实施安排与报价依据',
    date: '2026-09-17',
  });
  draft.relations = ['price', 'needs'];
  const price = material(
    'price',
    '服务价格表',
    'finance',
    '标准服务价格表\n\n基础服务：企业资料梳理与团队培训。\n实施服务：按工作空间与业务复杂度评估。\n\n本资料为合成演示内容。实际报价需根据服务范围单独确认。',
    '标准服务内容及适用条件，报价前应核对服务范围。',
    '表格',
  );
  price.versions = [1, 2, 3].map((n) => ({
    ...price.versions[0],
    id: `price-v${n}`,
    number: n,
    note: `第 ${n} 次价格说明更新`,
  }));
  price.confirmed = 'price-v3';
  const needs = material(
    'needs',
    '客户 A 需求纪要',
    'sales',
    '客户 A 需求纪要\n\n团队希望统一客户跟进记录，减少资料重复整理。\n优先实现方案生成、团队共享与进展查看。\n\n联系人：王女士（演示角色）。',
    '记录客户 A 的目标、当前问题及优先级。',
  );
  needs.confirmed = 'needs-v1';
  return upgradeBriefingExamples(
    upgradeWorkspaceExamples({
      schema: 1,
      demoProfileVersion: 1,
      profile: { name: '曹鸿健', compact: false, autoMemory: true },
      spaces: [
        {
          id: 'sales',
          name: '销售部门工作空间',
          description: '把每一次沟通，沉淀成下一次合作的起点。',
          instructions: '优先参考客户需求与已确认报价。交付清晰、可执行的客户方案。',
          owner: '曹鸿健',
          members: ['曹鸿健', '陈言', '许然'],
          canEdit: true,
        },
        {
          id: 'finance',
          name: '财务部门工作空间',
          description: '维护可信的数据、价格依据与财务资料。',
          instructions: '数据必须注明来源和口径，未确认的金额不得作为最终报价。',
          owner: '周宁',
          members: ['周宁', '曹鸿健'],
          canEdit: false,
        },
      ],
      chats: [
        {
          id: 'client',
          title: '客户 A 合作方案',
          space: 'sales',
          kind: 'normal',
          archived: false,
          messages: [
            { id: 'm1', role: 'user', text: '请根据客户 A 的需求更新合作方案，并参考最新报价。' },
            {
              id: 'm2',
              role: 'assistant',
              text: '已结合销售资料和财务价格表更新初稿。方案保存在你的个人空间，确认后再共享给团队。',
              doc: 'proposal',
              refs: ['needs', 'price'],
            },
            { id: 'm3', role: 'assistant', text: '已补充实施安排。你可以继续调整内容，或准备共享。' },
          ],
        },
        {
          id: 'weekly',
          title: '本周客户跟进',
          space: 'sales',
          kind: 'normal',
          archived: false,
          messages: [
            {
              id: 'm4',
              role: 'assistant',
              text: '本周的客户跟进记录已准备好。你可以从应用查看明细，或在仪表盘分析当前进展。',
            },
          ],
        },
        {
          id: 'idea',
          title: '整理本周工作思路',
          space: 'none',
          kind: 'normal',
          archived: false,
          messages: [
            { id: 'm5', role: 'user', text: '我想把客户方案和资料整理的工作安排一下。' },
            {
              id: 'm6',
              role: 'assistant',
              text: '可以先完成客户方案，再一起整理资料。这个主题与销售部门工作空间有关，工作明确后可以把会话移入该空间。',
            },
          ],
        },
      ],
      materials: [
        draft,
        price,
        needs,
        material(
          'notes',
          '客户 B 沟通记录',
          'personal',
          '客户 B 沟通记录\n\n对方希望先体验客户跟进与共享资料功能，下周安排演示。',
          '客户 B 的演示需求与下次沟通计划。',
        ),
        material(
          'brief',
          '本周工作小结',
          'personal',
          '本周工作小结\n\n已完成客户 A 方案初稿，与客户 B 约定演示。\n下周重点：确认报价和完善实施安排。',
          '本周客户工作回顾与下周计划。',
        ),
        material(
          'guide',
          '团队协作指南',
          'sales',
          '团队协作指南\n\n成果默认保存在个人空间。\n确认内容后共享至工作空间，并保留版本记录。\n共享资料不会开放私人会话。',
          '团队资料交付、版本与协作约定。',
        ),
        {
          ...material(
            'old',
            '历史报价说明',
            'finance',
            '历史报价说明\n\n此版本仅用于查阅历史，请以服务价格表 v3 为准。',
            '旧版说明，已由新版服务价格表替代。',
          ),
          status: '已过期',
          relations: ['price'],
        },
      ],
      apps: [
        {
          id: 'followup',
          name: '客户跟进',
          description: '记录每次沟通，让客户关系持续向前。',
          space: 'sales',
          hasDate: true,
          published: true,
        },
      ],
      records: [
        ['客户 A', '待跟进', '确认合作方案与报价范围', '曹鸿健'],
        ['客户 B', '待跟进', '安排产品演示', '曹鸿健'],
        ['客户 C', '已联系', '已发送资料，等待反馈', '曹鸿健'],
        ['客户 D', '待跟进', '了解团队使用需求', '陈言'],
        ['客户 E', '已联系', '整理沟通纪要', '陈言'],
        ['客户 F', '已约定', '下周开展试用培训', '许然'],
      ].map((r, i) => ({
        id: `r${i}`,
        app: 'followup',
        customer: r[0],
        status: r[1] as Followup['status'],
        note: r[2],
        owner: r[3],
        date: '2026-09-17',
        nextDate: '2026-09-22',
      })),
      requests: [],
      collaborations: [],
      memories: [
        { id: 'mem1', text: '偏好简洁的中文表达，先说明结论，再补充依据。' },
        { id: 'mem2', text: '方案需要明确实施步骤和交付内容。' },
      ],
      dream: { scheme: '按月份', keepPrices: true, status: 'pending', revision: 1 },
      dashboards: {
        personal: { recent: true, distribution: true },
        sales: { recent: true, distribution: true },
      },
      activities: [
        { id: 'a1', space: 'sales', text: '曹鸿健更新了客户 A 的合作方案草稿', date: '今天 10:24' },
        { id: 'a2', space: 'finance', text: '周宁确认了服务价格表 v3', date: '昨天 16:40' },
      ],
    }),
  );
}
export function addChat(
  s: DemoState,
  title: string,
  space = 'none',
  kind: Chat['kind'] = 'normal',
  context?: string,
) {
  const chat: Chat = {
    id: uid(),
    title,
    space,
    kind,
    context,
    origin: 'other',
    archived: false,
    messages: [],
  };
  s.chats.unshift(chat);
  return chat;
}
export function addMessage(chat: Chat, role: Message['role'], text: string, doc?: string, refs?: string[]) {
  chat.messages.push({ id: uid(), role, text, doc, refs, createdAt: new Date().toISOString() });
}
export function createMaterial(
  s: DemoState,
  title: string,
  content = proposal,
  summary = 'AI 生成的工作草稿，可继续编辑并确认。',
) {
  const doc = material(uid(), title, 'personal', content, summary);
  doc.owner = s.profile.name;
  doc.versions[0].date = today();
  s.materials.unshift(doc);
  activity(s, 'personal', `生成了「${title}」草稿`);
  return doc;
}
export function editMaterial(
  s: DemoState,
  id: string,
  content: string,
  title: string,
  summary: string,
  note: string,
) {
  let doc = s.materials.find((d) => d.id === id)!;
  if (!canEdit(s, doc.space)) {
    const source = doc;
    doc = structuredClone(source);
    doc.id = uid();
    doc.sourceId = source.id;
    doc.sourceVersion = latest(source).id;
    doc.space = 'personal';
    doc.folderId = undefined;
    doc.visibility = '仅自己';
    doc.owner = s.profile.name;
    doc.confirmed = undefined;
    doc.versions = [{ ...latest(source), id: uid(), number: 1, note: '从共享资料创建个人修订稿' }];
    s.materials.unshift(doc);
  }
  doc.title = title;
  doc.summary = summary;
  doc.versions.push({ id: uid(), number: latest(doc).number + 1, content, summary, note, date: today() });
  activity(s, doc.space, `更新了「${title}」的版本与简介`);
  return doc;
}
export function publishSnapshot(
  s: DemoState,
  sourceId: string,
  title: string,
  version: Version,
  summary: string,
  target: string,
  visibility: string,
  targetFolderId?: string,
) {
  validateDestination(s, target, targetFolderId);
  let shared = s.materials.find((d) => d.space === target && (d.sourceId === sourceId || d.id === sourceId));
  // A personal revision of a shared item updates that same shared identity.
  const source = s.materials.find((d) => d.id === sourceId);
  if (!shared && source?.sourceId)
    shared = s.materials.find((d) => d.id === source.sourceId && d.space === target);
  if (shared && targetFolderId !== undefined) shared.folderId = targetFolderId || undefined;
  if (
    shared &&
    (shared.sourceVersion === version.id || (shared.id === sourceId && latest(shared).id === version.id))
  ) {
    if (shared.visibility !== visibility) {
      shared.visibility = visibility;
      activity(s, target, `更新了「${title}」的查看范围：${visibility}`);
    }
    return shared;
  }
  if (shared) {
    shared.title = title;
    shared.summary = summary;
    shared.visibility = visibility;
    shared.versions.push({
      ...structuredClone(version),
      id: uid(),
      number: latest(shared).number + 1,
      note: '从个人修订稿更新',
      date: today(),
    });
    shared.sourceVersion = version.id;
  } else {
    shared = {
      id: uid(),
      title,
      space: target,
      folderId: targetFolderId || undefined,
      type: source?.type || '文档',
      summary,
      status: '使用中',
      tags: [...(source?.tags || [])],
      relations: [...(source?.relations || [])],
      versions: [{ ...structuredClone(version), id: uid(), number: 1, note: '首次共享入库', date: today() }],
      owner: s.profile.name,
      visibility,
      sourceId,
      sourceVersion: version.id,
    };
    s.materials.unshift(shared);
  }
  activity(s, target, `「${title}」已共享到${spaceName(s, target)}，查看范围：${visibility}`);
  return shared;
}
export function requestShare(
  s: DemoState,
  sourceId: string,
  target: string,
  visibility: string,
  targetFolderId?: string,
) {
  validateDestination(s, target, targetFolderId);
  const doc = s.materials.find((d) => d.id === sourceId)!;
  const version = latest(doc);
  const existing = s.requests.find(
    (r) =>
      r.status === 'pending' &&
      r.sourceId === sourceId &&
      r.target === target &&
      r.targetFolderId === targetFolderId &&
      r.version?.id === version.id &&
      r.visibility === visibility,
  );
  if (existing) return existing;
  const request: Request = {
    id: uid(),
    kind: 'material',
    sourceId,
    title: doc.title,
    target,
    targetFolderId,
    visibility,
    status: 'pending',
    version: structuredClone(version),
    summary: doc.summary,
  };
  s.requests.unshift(request);
  return request;
}
export function resolveRequest(s: DemoState, id: string, approved: boolean) {
  const req = s.requests.find((r) => r.id === id);
  if (!req || req.status !== 'pending') return;
  if (approved && req.kind === 'material') validateDestination(s, req.target, req.targetFolderId);
  req.status = approved ? 'approved' : 'rejected';
  if (approved && req.kind === 'material' && req.version)
    publishSnapshot(
      s,
      req.sourceId,
      req.title,
      req.version,
      req.summary,
      req.target,
      req.visibility,
      req.targetFolderId,
    );
  if (approved && req.kind === 'app' && req.appSnapshot) {
    const shared = s.apps.find((a) => a.sourceId === req.sourceId && a.space === req.target);
    if (shared)
      Object.assign(shared, req.appSnapshot, {
        id: shared.id,
        sourceId: req.sourceId,
        space: req.target,
        published: true,
      });
    else
      s.apps.unshift({
        ...req.appSnapshot,
        id: uid(),
        sourceId: req.sourceId,
        space: req.target,
        published: true,
      });
  }
  activity(s, req.target, `${approved ? '已批准' : '已拒绝'}「${req.title}」的共享申请`);
}
export const dreamIds = ['proposal', 'notes', 'brief'];
export function applyDream(s: DemoState, expectedRevision: number) {
  if (s.dream.status !== 'pending' || s.dream.revision !== expectedRevision) return false;
  for (const doc of s.materials.filter((d) => dreamIds.includes(d.id)))
    doc.tags = [
      s.dream.scheme === '按月份'
        ? '2026 年 9 月'
        : doc.id === 'proposal'
          ? '客户 A'
          : doc.id === 'notes'
            ? '客户 B'
            : '工作回顾',
    ];
  s.dream.status = 'done';
  activity(s, 'personal', `梦境${s.dream.scheme}整理了 3 份资料，报价资料保持原位`);
  return true;
}
