import type { CardData, CardType } from '../briefing.ts';
import type { BriefingArticleData } from '../briefingArticle.ts';
import type { BriefingChart } from '../briefingPresentation.ts';
import type { DemoState, Material } from '../model.ts';
import type { NinepopPackage, ResearchCard } from './types.ts';

export const NINEPOP_STORAGE_KEY = 'dreamcore-ninepop-private-snapshot-v1';
export const NINEPOP_ADMIN_URL = 'https://boss.9pop.top/';
const materialId = (id: string) => `ninepop-source-${id}`;
const cardMaterialId = (id: string) => `ninepop-analysis-${id}`;
const types: Record<ResearchCard['type'], CardType> = {
  数据: '经营数据',
  洞察: '知识洞察',
  建议: '待办决策',
  成果: '成果交付',
  资讯: '资讯',
};
export function researchArticle(card: ResearchCard): BriefingArticleData {
  const sections = [
    { heading: '事实依据', paragraphs: card.facts },
    { heading: '经营判断', paragraphs: [card.ai_analysis] },
    { heading: '建议安排', paragraphs: card.recommended_actions },
    { heading: '阅读说明', paragraphs: card.boundaries },
    {
      heading: '统计说明与跟进',
      paragraphs: [`建议由${card.suggested_owner_role}跟进。`],
    },
  ];
  if (card.artifact) {
    const a = card.artifact;
    sections.push({
      heading: `${a.title} · 草稿`,
      paragraphs: [
        ...(a.sections || []).map((x) => `${x.title}：${x.body}`),
        ...(a.columns ? [`表格栏目：${a.columns.join(' / ')}`] : []),
        ...(a.rules || []),
        ...(a.rows || []).map((row) =>
          Object.entries(row)
            .map(([k, v]) => `${k}：${v}`)
            .join('；'),
        ),
      ],
    });
  }
  return { version: 1, sections };
}
function chart(card: ResearchCard): BriefingChart | undefined {
  const base = { unit: '元', period: card.editorial?.period || card.data_period };
  if (card.id.endsWith('C01')) {
    const rows = card.data
      .filter((r) => r.period === '2026-09')
      .map((r) => ({
        label: r.name,
        value: Number(r.receipts_yuan),
        previous: Number(
          card.data.find((p) => p.name === r.name && p.period === '2026-08')?.receipts_yuan || 0,
        ),
      }));
    return { ...base, kind: 'columns', period: '8月与9月 · 各月1—23日', columns: ['8月', '9月'], rows };
  }
  if (card.id.endsWith('C03'))
    return {
      ...base,
      kind: 'diverging',
      unit: '课时',
      period: '9月17—23日，较前一周增减',
      rows: card.data
        .filter((r) => r.period === '09-17_to_09-23')
        .map((r) => ({
          label: r.name,
          value: Number(r.valid_sessions),
          previous: Number(
            card.data.find((p) => p.name === r.name && p.period === '09-10_to_09-16')?.valid_sessions || 0,
          ),
        })),
    };
  if (card.id.endsWith('C07'))
    return {
      ...base,
      kind: 'bars',
      rows: card.data
        .map((r) => ({ label: r.name, value: Number(r.yuan) }))
        .sort((a, b) => b.value - a.value),
    };
  if (card.id.endsWith('C10'))
    return {
      ...base,
      kind: 'donut',
      rows: card.data
        .map((r) => ({ label: r.store_name, value: Number(r.standard_debt_yuan) }))
        .sort((a, b) => b.value - a.value),
    };
  if (card.id.endsWith('C16'))
    return {
      ...base,
      kind: 'funnel',
      unit: '份',
      period: '开通体验 → 30天内购课',
      rows: [
        { label: '开通体验', value: card.data.reduce((sum, r) => sum + Number(r.activated_cards), 0) },
        { label: '30天内购课', value: card.data.reduce((sum, r) => sum + Number(r.converted_within_30d), 0) },
      ],
      series: card.data.map((r) => ({
        label: r.name,
        values: [Number(r.activated_cards), Number(r.converted_within_30d)],
      })),
    };
  if (card.id.endsWith('C18') && card.data[0]) {
    const r = card.data[0],
      total = Number(r.paid_formal_orders),
      repeat = Number(r.orders_with_prior_paid_order);
    return {
      ...base,
      kind: 'unit-grid',
      period: `${base.period} · 每格1笔订单`,
      unit: '笔',
      total,
      rows: [
        { label: '有更早购课记录', value: repeat },
        { label: '未查到此前购课记录', value: total - repeat },
      ],
    };
  }
  if (card.id.endsWith('C20'))
    return {
      ...base,
      period: '已收款占合同金额的比例',
      kind: 'progress',
      rows: card.data.map((r) => ({
        label: r.name,
        value: Number(r.received_cents) / 100,
        previous: Number(r.contract_cents) / 100,
      })),
    };
}
export function createNinepopSeed(bundle: NinepopPackage): DemoState {
  if (
    bundle.schema_version !== 1 ||
    bundle.cards.length < 30 ||
    new Set(bundle.cards.map((c) => c.id)).size !== bundle.cards.length
  )
    throw new Error('9POP资料包格式不完整，请重新核验后加载。');
  const owner = '9POP管理层';
  const spaces = bundle.spaces.map((name, i) => ({
    id: `ninepop-space-${i + 1}`,
    name,
    description: `9POP ${name}资料与本次分析`,
    instructions: '按固定快照及原始来源解释；区分事实、判断、建议与已执行结果。',
    owner,
    members: [owner],
    canEdit: true,
  }));
  const spaceId = (name: string) => spaces.find((s) => s.name === name)?.id || spaces[0].id;
  const docsSpace = spaceId('制度与品牌');
  const document = (
    id: string,
    title: string,
    content: string,
    space: string,
    status: Material['status'] = '使用中',
  ): Material => ({
    id,
    title,
    space,
    folderId: `${space}-sources`,
    type: '文档',
    summary: content.split('\n').find((x) => x.trim()) || title,
    status,
    tags: ['9POP', '内部资料', '固定快照'],
    owner,
    visibility: '空间成员',
    relations: [],
    versions: [
      {
        id: `${id}-v1`,
        number: 1,
        content,
        summary: title,
        note: '2026-09-24经核验的内部资料包',
        date: bundle.generated_at,
      },
    ],
  });
  const materials: Material[] = bundle.materials.map((source) => {
    const relevant = bundle.cards.find((c) => c.source_refs.includes(source.id));
    const space = source.url
      ? spaceId('资讯观察')
      : source.id.startsWith('DB:') && relevant
        ? spaceId(relevant.space)
        : docsSpace;
    const doc = document(
      materialId(source.id),
      source.title,
      source.content,
      space,
      source.status === '历史' ? '已过期' : '使用中',
    );
    doc.summary = source.boundary;
    if (source.url) {
      doc.type = '资讯';
      doc.sourceLinks = [
        {
          title: source.title,
          url: source.url,
          publishedAt: source.publishedAt || '',
          eventDate: source.eventDate,
        },
      ];
    }
    return doc;
  });
  const available = new Set(bundle.materials.map((s) => s.id));
  const cards: CardData[] = bundle.cards.map((card) => {
    if (!card.source_refs.every((r) => available.has(r))) throw new Error(`卡片 ${card.id} 缺少来源。`);
    const article = researchArticle(card);
    const doc = document(
      cardMaterialId(card.id),
      card.title,
      article.sections.map((s) => `## ${s.heading}\n\n${s.paragraphs.join('\n\n')}`).join('\n\n'),
      spaceId(card.space),
    );
    doc.type = card.type === '成果' ? '成果' : '分析';
    doc.folderId = `${doc.space}-analysis`;
    doc.relations = card.source_refs.map(materialId);
    materials.push(doc);
    const plot = chart(card);
    const data: CardData = {
      id: card.id,
      type: types[card.type],
      title: card.title,
      fact: card.summary,
      advice: card.ai_analysis,
      source: card.editorial?.source_label || '9POP经营资料',
      space: doc.space,
      size: plot || card.editorial?.photo ? '2×2' : '2×1',
      template: plot ? 'chart' : card.type === '成果' ? 'document' : 'list',
      sourceKind: card.type === '资讯' ? 'news' : 'material',
      sourceId: doc.id,
      prompts: ['进一步分析原因', '查看完整依据'],
      refs: [doc.id, ...doc.relations],
      authoredAt: card.generated_at,
      dataPeriod: card.editorial?.period || card.data_period,
      reporting: {
        dateLabel: card.editorial?.display_date || '9月24日',
        date: card.editorial?.date || card.generated_at,
      },
      photo: card.editorial?.photo,
      sourceLinks: card.source_refs.flatMap(
        (r) => materials.find((d) => d.id === materialId(r))?.sourceLinks || [],
      ),
      article,
      presentation: plot
        ? { format: 'chart', kicker: '经营数据', chart: plot }
        : {
            format:
              card.type === '成果'
                ? 'document'
                : card.type === '建议'
                  ? 'recommendation'
                  : card.type === '资讯'
                    ? 'brief'
                    : 'analysis',
            kicker: card.type === '资讯' ? '行业观察' : card.type === '成果' ? '工作草稿' : '经营分析',
            points: card.facts.slice(0, 2).map((text, i) => ({ label: `依据 ${i + 1}`, text })),
          },
    };
    if (bundle.suggested_first_screen.includes(card.id))
      data.recommendation = { importance: 'high', reason: '首批管理层复核建议' };
    return data;
  });
  return {
    schema: 1,
    scenario: 'ninepop',
    demoProfileVersion: 1,
    profile: { name: owner, compact: false, autoMemory: false },
    spaces,
    materials,
    folders: spaces.flatMap((s) => [
      { id: `${s.id}-sources`, name: '来源资料', space: s.id },
      { id: `${s.id}-analysis`, name: '分析与草稿', space: s.id },
    ]),
    chats: [],
    records: [],
    requests: [],
    collaborations: [],
    memories: [],
    activities: [],
    dashboards: {},
    apps: [
      {
        id: 'ninepop-management',
        name: '9POP健身管理系统',
        description: '进入真实后台，查看和处理门店、会员、订单、课时、审批与财务业务。',
        space: spaceId('经营总览'),
        hasDate: false,
        published: true,
        external: { url: NINEPOP_ADMIN_URL },
      },
    ],
    dream: { scheme: '按客户', keepPrices: true, status: 'done', revision: 1 },
    ninepop: { datasetId: bundle.dataset_id, generatedAt: bundle.generated_at, cards },
  };
}
