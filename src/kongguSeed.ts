import type { DemoState, Material } from './model.ts';
import { kongguResearch as research } from './kongguResearch.ts';
import { kongguCards, kongguCardDate } from './kongguBriefing.ts';

export { KONGGU_STORAGE_KEY } from './kongguSources.ts';
import { kongguMaterialId, kongguSource, kongguPhoto } from './kongguSources.ts';

const owner = '空谷主理人';
const spaces = [
  ['operations', '门店经营', '汇集日销售、渠道与运营记录，先核对统计口径，再讨论变化原因。', '店长'],
  [
    'product',
    '产品研发',
    '把真实行业资讯与合成反馈、配方和试饮记录关联，区分拟议新品与正式菜单。',
    '研发负责人',
  ],
  [
    'customers',
    '客户与营销',
    '分别分析订单、去重会员与复购队列；回访和内容保持草稿，不自动发送。',
    '运营负责人',
  ],
  ['events', '活动与企业合作', '从需求、场地到执行清单积累活动资料；历史报道与合成商机分开。', '活动协调'],
  [
    'finance',
    '采购与财务',
    '分别维护零售、活动履约、到账与订金，采购建议必须说明豆种、用量和损耗假设。',
    '采购负责人',
  ],
  ['brand', '品牌与知识', '维护空谷公开资料、新闻原文和图片出处，保留日期与素材使用状态。', '品牌负责人'],
];
const spaceIds = Object.fromEntries(spaces.map(([id, name]) => [name, id]));

function material(
  id: string,
  title: string,
  space: string,
  content: string,
  summary: string,
  date = '2026-09-20',
): Material {
  return {
    id,
    title,
    space,
    type: '文档',
    summary,
    status: '使用中',
    tags: ['空谷无界', '模拟资料'],
    owner,
    visibility: space === 'personal' ? '仅自己' : '空间成员',
    relations: [],
    versions: [{ id: `${id}-v1`, number: 1, content, summary, note: '编写的演示资料', date }],
  };
}

export function createKongguSeed(): DemoState {
  const materials: Material[] = research.materials.map((doc) => {
    const space = spaceIds[doc.space];
    const result = material(
      kongguMaterialId(doc.id),
      doc.title,
      space,
      doc.content,
      doc.content
        .split('\n')
        .find((line) => line.trim() && !line.startsWith('>'))
        ?.slice(0, 130) || doc.title,
    );
    result.relations = doc.relations.map(kongguMaterialId);
    result.folderId = `kg-folder-${space}`;
    if (['D17', 'D18'].includes(doc.id)) result.tags = ['空谷无界', '公开资料与情景说明'];
    return result;
  });
  for (const source of research.research.sources) {
    const doc = material(
      kongguMaterialId(source.id),
      source.title,
      'brand',
      `公开报道摘要\n\n${source.factSummary}\n\n发布时间：${source.publishedAt}\n事件时间：${source.eventDate || '原文未单列'}\n\n使用边界\n${source.boundary}\n\n本资料为简短阅读摘记，完整信息请打开原文。`,
      source.factSummary,
      source.publishedAt,
    );
    doc.type = '资讯';
    doc.tags = ['真实资讯', source.publisher];
    doc.folderId = 'kg-news';
    doc.sourceLinks = [kongguSource(source.id)];
    const image = research.research.images.find((image) => image.sourceId === source.id && image.selected);
    if (image) doc.photo = kongguPhoto(image.id);
    materials.push(doc);
  }
  // Earlier editions have their own authored source, never a forward reference to the 9/20 tables.
  for (const card of kongguCards.filter((c) => kongguCardDate(c.id).slice(0, 10) < '2026-09-20')) {
    const id = `kg-edition-${card.id.split(':')[1]}`;
    const doc = material(
      id,
      `${card.title} · 情境留存`,
      card.space,
      `编写的演示情境，日期${kongguCardDate(card.id).slice(0, 10)}；不是当天真实采集或执行记录。\n\n${card.fact}\n\n分析与建议\n${card.advice}\n\n${card.items?.map((x) => `${x.label}：${x.value}`).join('\n') || ''}\n\n数据边界\n${card.source}`,
      card.fact,
      kongguCardDate(card.id).slice(0, 10),
    );
    doc.folderId = `kg-history-${card.space}`;
    doc.sourceLinks = card.sourceLinks;
    doc.relations = (card.refs || []).filter((ref) => ref.startsWith('kg-S'));
    materials.push(doc);
  }
  const personal = material(
    'kg-personal-review',
    '空谷本周经营复盘 · 个人草稿',
    'personal',
    materials.find((d) => d.id === 'kg-D15')!.versions[0].content,
    '从零售、活动履约与顾客反馈整理的经营复盘，等待审阅。',
  );
  personal.relations = ['kg-D01', 'kg-D02', 'kg-D05', 'kg-D08'];
  materials.push(personal);
  const state: DemoState = {
    schema: 1,
    scenario: 'konggu',
    demoProfileVersion: 1,
    profile: { name: owner, compact: false, autoMemory: true },
    spaces: spaces.map(([id, name, instructions, role]) => ({
      id,
      name,
      instructions,
      description: instructions,
      owner,
      members: [owner, `${role}（模拟）`],
      canEdit: true,
      kind: 'business',
    })),
    folders: [
      ...spaces.map(([space, name]) => ({ id: `kg-folder-${space}`, name: `${name}资料`, space })),
      ...spaces.map(([space]) => ({ id: `kg-history-${space}`, name: '画报情境留存', space })),
      { id: 'kg-news', name: '行业资讯与历史报道', space: 'brand' },
    ],
    materials,
    chats: [
      {
        id: 'kg-review',
        title: '从销售与活动台账看本周经营',
        space: 'operations',
        kind: 'normal',
        archived: false,
        messages: [
          { id: 'kg-m1', role: 'user', text: '把本周零售、活动与收款放在一起，说明哪些变化有依据。' },
          {
            id: 'kg-m2',
            role: 'assistant',
            text: '根据模拟底表，9/13—9/19零售48,178元，已履约活动11,400元，综合销售59,578元。活动收款10,500元中含未来订金2,400元，不能将收款直接当收入。\n\n增长原因仍需逐时订单、促销与活动占用记录。已准备一份演示分析草稿，便于继续核对。',
            doc: personal.id,
            refs: personal.relations,
          },
        ],
      },
      {
        id: 'kg-development',
        title: '从贵州风味资讯到下一轮试饮',
        space: 'product',
        kind: 'normal',
        archived: false,
        messages: [
          { id: 'kg-m3', role: 'user', text: '结合行业资讯、顾客反馈和配方成本，看看哪款新品值得继续验证。' },
          {
            id: 'kg-m4',
            role: 'assistant',
            text: '真实报道可以提供贵州食材的方向；40份合成反馈中16份提到更低甜度。刺梨冷萃的12人合成试饮记录中9人偏好V2，但尚不能证明购买意愿。\n\n建议补齐出杯稳定性和价格验证，再讨论试售。这是预编写的分析示例，不代表空谷已经组织试饮或决定上市。',
            refs: ['kg-S07', 'kg-D08', 'kg-D09', 'kg-D10', 'kg-D11'],
            doc: 'kg-D19',
          },
        ],
      },
      {
        id: 'kg-event-plan',
        title: '30人读书会：把需求变成筹备方案',
        space: 'events',
        kind: 'normal',
        archived: false,
        messages: [
          { id: 'kg-m5', role: 'user', text: '整理9月25日合成企业D读书会的需求和待确认事项。' },
          {
            id: 'kg-m6',
            role: 'assistant',
            text: '本情境计划30人，金额6,000元，订金2,400元。先核对实际空间、设备、雨天安排以及散客影响；300㎡是室内外合计，不能据此推定可用座位或安全容量。\n\n方案仍为演示草稿，没有发送给客户，也未形成真实档期承诺。',
            refs: ['kg-D05', 'kg-D13'],
            doc: 'kg-D20',
          },
        ],
      },
    ],
    apps: [
      {
        id: 'kg-followup',
        name: '企业活动跟进',
        description: '整理合成企业的活动需求、沟通记录与下一步；不代表真实客户名单。',
        space: 'events',
        hasDate: true,
        published: true,
      },
    ],
    records: Array.from({ length: 11 }, (_, i) => ({
      id: `kg-lead-${i + 1}`,
      app: 'kg-followup',
      customer: i === 10 ? '合成企业D · 读书会' : `合成活动线索 ${String(i + 1).padStart(2, '0')}`,
      owner,
      status: i < 5 ? '待跟进' : i < 10 ? '已联系' : '已约定',
      note:
        i < 5
          ? '初步咨询：待补人数、时间与活动目标'
          : i < 8
            ? '已给方案：待核对服务范围（模拟）'
            : i < 10
              ? '待确认档期：先核对布置与撤场时段'
              : '已预订未履约：9/25，30人；情境金额6,000元',
      date: '2026-09-20',
      nextDate: '2026-09-22',
    })),
    requests: [],
    collaborations: [],
    memories: [
      { id: 'kg-memory', text: '区分真实行业资讯、模拟经营记录与AI建议；先说明依据，再推进下一步。' },
    ],
    dream: { scheme: '按月份', keepPrices: true, status: 'done', revision: 1 },
    dashboards: {},
    activities: [
      {
        id: 'kg-a1',
        space: 'operations',
        text: '经营复盘演示草稿已归档，等待审阅',
        date: '2026-09-20 09:00 · 模拟',
      },
      {
        id: 'kg-a2',
        space: 'product',
        text: '拟议新品、试饮记录与成本资料建立关联',
        date: '2026-09-20 08:50 · 模拟',
      },
      {
        id: 'kg-a3',
        space: 'brand',
        text: '公开资讯保留原文时间，历史活动与近期消息分开整理',
        date: '2026-09-20 08:40 · 编写样例',
      },
    ],
  };
  for (const chat of state.chats)
    for (const message of chat.messages) {
      if (message.refs?.length)
        message.refVersions = Object.fromEntries(message.refs.map((id) => [id, `${id}-v1`]));
    }
  return state;
}
