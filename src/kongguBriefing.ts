import type { CardData, CardType } from './briefing.ts';
import type { DemoState } from './model.ts';
import type { BriefingChart } from './briefingPresentation.ts';
import { kongguResearch as research } from './kongguResearch.ts';
import { kongguPhoto, kongguSource } from './kongguSources.ts';

const day19 = [7, 12, 23, 25, 28];
const day18 = [15, 22, 26, 27, 29];
const day17 = [31, 36, 37, 40];
export function kongguCardDate(id: string) {
  const n = Number(id.split('C')[1]);
  const day = day19.includes(n) ? 19 : day18.includes(n) ? 18 : day17.includes(n) ? 17 : 20;
  const priority: Record<number, string> = { 30: '59:00', 1: '58:00', 16: '57:30', 21: '56:30' };
  return `2026-09-${day}T09:${priority[n] || `${String(59 - n).padStart(2, '0')}:00`}+08:00`;
}
const chart = (
  kind: BriefingChart['kind'],
  unit: string,
  period: string,
  rows: BriefingChart['rows'],
  extra: Partial<BriefingChart> = {},
): Partial<CardData> => ({
  template: 'chart',
  presentation: { format: 'chart', kicker: '模拟经营数据', chart: { kind, unit, period, rows, ...extra } },
});
const points = (
  format: 'analysis' | 'recommendation' | 'comparison' | 'document' | 'insight',
  items: [string, string][] = [],
): Partial<CardData> => ({
  presentation: {
    format,
    kicker: format === 'document' ? '演示成果 · 待审' : 'AI 分析样例',
    points: items.length ? items.map(([label, text]) => ({ label, text })) : undefined,
  },
});
function card(
  n: number,
  type: CardType,
  title: string,
  fact: string,
  advice: string,
  space: string,
  references: string[],
  extra: Partial<CardData> = {},
): CardData {
  const id = `konggu:C${String(n).padStart(2, '0')}`;
  const authoredAt = kongguCardDate(id);
  const isEarlier = authoredAt.slice(0, 10) < '2026-09-20';
  const refs = isEarlier
    ? [
        `kg-edition-C${String(n).padStart(2, '0')}`,
        ...references.filter((r) => r.startsWith('S')).map((r) => `kg-${r}`),
      ]
    : references.map((r) => `kg-${r}`);
  const sources = references.filter((r) => r.startsWith('S')).map(kongguSource);
  return {
    id,
    type,
    title,
    fact,
    advice,
    space,
    size: '2×1',
    template: 'list',
    sourceKind: 'material',
    sourceId: refs[0],
    source: `模拟底表 v1 · ${authoredAt.slice(5, 10)}情境`,
    prompts: ['核对这条结论的依据', '整理下一步行动清单'],
    refs,
    authoredAt,
    sourceLinks: sources,
    ...points(
      type === '待办决策' || type === '风险提醒'
        ? 'recommendation'
        : type === '成果交付'
          ? 'document'
          : 'analysis',
    ),
    ...extra,
  };
}
const retail = research.business.dailyRetail.slice(12);
const news = (sourceId: string, photoId?: string): Partial<CardData> => {
  const s = research.research.sources.find((s) => s.id === sourceId)!;
  return {
    sourceKind: 'news',
    sourceId: `kg-${sourceId}`,
    template: 'editorial',
    source: `${s.publisher} · 原文 ${s.publishedAt}`,
    presentation: photoId ? undefined : { format: 'brief', kicker: '真实资讯' },
    photo: photoId ? kongguPhoto(photoId) : undefined,
  };
};

export const kongguCards: CardData[] = [
  card(
    1,
    '经营数据',
    '过去7天零售48,178元',
    '1,307单，每单36.86元；较上一可比7天增长12.6%。',
    '先拆开订单与客单，再核查变化原因。',
    'operations',
    ['D01', 'D02'],
    {
      size: '2×2',
      value: '48,178',
      unit: '元',
      ...chart(
        'line',
        '元',
        '9/13—9/19 · 零售净销售额',
        retail.map((r) => ({ label: r.date.slice(5), value: r.netSalesFen / 100 })),
      ),
      prompts: ['拆解本周销售增长', '整理一页经营复盘'],
    },
  ),
  card(
    2,
    '知识洞察',
    '增长12.6%，先拆开订单与客单',
    '上期1,189单，本期1,307单；每单平均实收也有所提高。',
    '数学构成可以解释金额变化，营销、天气等原因仍需证据。',
    'operations',
    ['D01', 'D02'],
    {
      size: '1×2',
      ...points('analysis', [
        ['订单', '两期都覆盖7天，星期结构一致。'],
        ['客单', '本期36.86元，订单不是消费人数。'],
        ['缺口', '逐时订单、促销与活动占用尚未接入。'],
      ]),
    },
  ),
  card(
    3,
    '经营数据',
    '周六266单，负荷与工作日不同',
    '9月19日完成266笔零售订单；人数与杯数不能直接由订单推算。',
    '补齐逐时数据，再判断排班与出杯环节。',
    'operations',
    ['D01', 'D02'],
    chart(
      'area',
      '单',
      '9/13—9/19 · 完成订单',
      retail.map((r) => ({ label: r.date.slice(5), value: r.completedOrders })),
    ),
  ),
  card(
    4,
    '经营数据',
    '咖啡、非咖与甜品，各贡献多少',
    '五类模拟销售合计48,178元，分类不是已确认的真实菜单。',
    '销售占比不能直接代表利润贡献。',
    'operations',
    ['D03'],
    chart(
      'stacked',
      '元',
      '9/13—9/19 · 模拟产品构成',
      research.business.weeklyCategorySales.map((r) => ({ label: r.category, value: r.netSalesFen / 100 })),
      { total: 48178 },
    ),
  ),
  card(
    5,
    '经营数据',
    '点单、自提与配送，分开看',
    '门店点单1,035单，自提204单，配送68单。',
    '这些为合成渠道；还需费用与折扣才能比较收益。',
    'operations',
    ['D04', 'D02'],
    chart(
      'lollipop',
      '单',
      '9/13—9/19 · 合成渠道',
      research.business.weeklyChannels.map((r) => ({ label: r.channel, value: r.orders })),
    ),
  ),
  card(
    6,
    '经营数据',
    '综合销售59,578元，来自两种业务',
    '零售48,178元，加上已履约活动11,400元。',
    '活动套餐饮品未重复记入零售；综合销售不等于到账。',
    'operations',
    ['D01', 'D05'],
    chart(
      'stacked',
      '元',
      '9/13—9/19 · 业务口径',
      [
        { label: '零售', value: 48178 },
        { label: '已履约活动', value: 11400 },
      ],
      { total: 59578 },
    ),
  ),
  card(
    7,
    '待办决策',
    '等候变长，先做一次分时观察',
    '编写的20单计时样例，中位数6.5分钟；不代表全天。',
    '先记录点单、制作和取餐时刻，找到等待发生在哪里。',
    'operations',
    ['D08', 'D14'],
    {
      size: '1×2',
      items: [
        { label: '样本', value: '20单独立计时样例' },
        { label: '待补', value: '时段、岗位、饮品复杂度' },
      ],
      prompts: ['起草两天分时观察表', '列出排班判断还缺的资料'],
    },
  ),
  card(
    8,
    '成果交付',
    '一页经营复盘，已形成待审稿',
    '把零售、活动收款与资料缺口放在同一页。',
    '先审阅依据，再决定下周的核查重点。',
    'operations',
    ['D15', 'D01', 'D05'],
    { template: 'document' },
  ),
  card(
    9,
    '经营数据',
    '640位购买会员，不是全店客流',
    '840笔订单可关联会员，另有467笔未识别订单。',
    '去重会员、订单和来店人数要分别统计。',
    'customers',
    ['D06', 'D02'],
    { value: '640', unit: '位合成会员', ...points('insight') },
  ),
  card(
    10,
    '经营数据',
    '30天新客复购率：30%',
    '180位合成新客中，54位在各自30天内再次购买。',
    '首次购买在8/1—8/15，观察窗已完整；不是本期新增客即时复购。',
    'customers',
    ['D06'],
    chart(
      'waffle',
      '人',
      '8月首购队列 · 完整30天观察',
      [
        { label: '30天内再购', value: 54 },
        { label: '未再购', value: 126 },
      ],
      { total: 180 },
    ),
  ),
  card(
    11,
    '经营数据',
    '本期购买会员，由谁组成',
    '既有活跃280人、本期新增210人、低频回访150人。',
    '分组互斥，共640人；未知身份的顾客不进入会员分母。',
    'customers',
    ['D06'],
    chart(
      'stacked',
      '人',
      '9/13—9/19 · 去重会员',
      research.business.customers.segments.map((r) => ({ label: r.name, value: r.people })),
      { total: 640 },
    ),
  ),
  card(
    12,
    '知识洞察',
    '40份反馈，16份提到更低甜度',
    '合成自愿问卷可多选；40%的样本提及，不代表所有顾客。',
    '把低甜度作为下一轮试饮方向，同时记录不喜欢的原因。',
    'customers',
    ['D08'],
    {
      size: '1×2',
      items: research.business.feedback.themes.map((r) => ({
        label: r.label,
        value: `${r.responses}份 · 可多选`,
      })),
    },
  ),
  card(
    13,
    '待办决策',
    '120位合成会员，进入回访候选',
    '目前只准备筛选情境和文案，发送数量为0。',
    '先核对联系范围与文案，避免承诺尚未上市的新品。',
    'customers',
    ['D07', 'D06'],
    { size: '1×1', value: '120', unit: '位候选', prompts: ['起草两版回访文案', '核对文案中的活动承诺'] },
  ),
  card(
    14,
    '项目进展',
    '6条内容候选，2条还缺资料',
    '4条可送审，2条缺素材或事实依据；已发布0条。',
    '新品预告与顾客故事先补依据。',
    'customers',
    ['D16'],
    chart(
      'ring',
      '条',
      '内容准备 · 全部未发布',
      [
        { label: '可送审', value: 4 },
        { label: '缺资料', value: 2 },
      ],
      { total: 6 },
    ),
  ),
  card(
    15,
    '知识洞察',
    '来喝咖啡，还是来度过一个下午',
    '真实报道关注饮品与旅游场景；空谷的到店动机尚缺实际调查。',
    '用三个简短问题了解动机，不挪用其他品牌游客占比。',
    'customers',
    ['S09', 'D17'],
    {
      size: '1×2',
      ...points('analysis', [
        ['已知', '300㎡室内外空间，客单范围由用户提供。'],
        ['未知', '游客、周边工作者和熟客的实际占比。'],
        ['下一步', '收集自愿匿名反馈，区分购买与停留需求。'],
      ]),
    },
  ),
  card(
    16,
    '项目进展',
    '三款拟议新品，处在不同阶段',
    '刺梨冷萃二轮试饮，桂花燕麦拿铁打样，山野抹茶拿铁选料。',
    '每款按证据进入下一阶段，不把阶段换成虚构完成率。',
    'product',
    ['D09'],
    {
      size: '2×2',
      ...chart(
        'heatmap',
        '',
        '9/20 · 模拟研发准备',
        [
          { label: '刺梨冷萃', value: 0 },
          { label: '桂花燕麦', value: 0 },
          { label: '山野抹茶', value: 0 },
        ],
        {
          columns: ['选料', '配方', '试饮', '稳定性'],
          matrix: [
            [2, 2, 2, 0],
            [2, 1, 0, 0],
            [1, 0, 0, 0],
          ],
        },
      ),
    },
  ),
  card(
    17,
    '知识洞察',
    '12位试饮者，9位偏好V2',
    '这是合成小样本记录，尚未验证付费购买。',
    '继续验证，而不是据此宣布“75%的顾客会买”。',
    'product',
    ['D10'],
    { size: '1×1', value: '9 / 12', unit: '合成试饮偏好', ...points('insight') },
  ),
  card(
    18,
    '经营数据',
    '新品拟价，先对照配方原料成本',
    '三款拟价34、36、36元；原料估算8.90、10.40、9.80元。',
    '未扣人工、租金及完整损耗，差额不标作真实毛利。',
    'product',
    ['D09', 'D11'],
    chart(
      'dumbbell',
      '元/杯',
      '拟议新品 · 原料成本 → 拟价',
      research.business.researchAndDevelopment.map((r) => ({
        label: r.name,
        previous: r.estimatedIngredientCostFen / 100,
        value: r.proposedPriceFen / 100,
      })),
    ),
  ),
  card(
    19,
    '待办决策',
    '能否试售，还缺稳定性记录',
    '刺梨冷萃已有一组编写的试饮偏好，制作稳定性尚待验证。',
    '把出杯时间、异常与价格接受分别记录。',
    'product',
    ['D09', 'D10', 'D19'],
    { size: '1×2', prompts: ['生成下一轮试饮计划', '列出试售前的准备项'] },
  ),
  card(
    20,
    '风险提醒',
    '喜欢，不等于接受这个价格',
    '12人试饮样例没有测量真实付费行为。',
    '将口味与价格分开验证，保留反对理由。',
    'product',
    ['D10', 'D11'],
    { size: '1×1' },
  ),
  card(
    21,
    '资讯',
    '贵州风味，正在进入咖啡杯',
    '多彩贵州网报道本土食材与特调的结合；图为咖啡节现场。',
    'AI解读：结合自己的反馈做小样，不复制他店产品归属。',
    'product',
    ['S07'],
    { size: '2×2', ...news('S07', 'I06'), prompts: ['把行业灵感与顾客反馈放在一起', '起草新品验证清单'] },
  ),
  card(
    22,
    '成果交付',
    '试饮表：把喜欢变成可记录的依据',
    '编写的计划模板包含版本、甜度、理由、价格与制作稳定性。',
    '先采用统一记录，再比较两版配方。',
    'product',
    ['D19'],
    {
      template: 'document',
      items: [
        { label: '口味', value: '偏好与不喜欢的原因' },
        { label: '执行', value: '出杯时间与异常' },
      ],
    },
  ),
  card(
    23,
    '资讯',
    '空谷曾承载企业产业交流',
    '历史回顾：2026年4月28日的产业链对接活动在空谷举行。',
    'AI解读：可以积累活动需求模板；报道不证明参与方的付费信息。',
    'events',
    ['S04'],
    { size: '2×2', ...news('S04', 'I03') },
  ),
  card(
    24,
    '项目进展',
    '11条合成商机，分别停在哪里',
    '5条初询、3条方案、2条待定档期、1条预订未履约。',
    '这是当前互斥状态，不能作为累计转化率漏斗。',
    'events',
    ['D12'],
    chart(
      'lollipop',
      '条',
      '9/20 · 当前合成商机',
      research.business.eventPipeline.exclusiveStages.map((r) => ({ label: r.stage, value: r.count })),
    ),
  ),
  card(
    25,
    '项目进展',
    '9月25日读书会：先核对30人方案',
    '未来合成活动，已收订金情境2,400元，尚未履约。',
    '先确认布置、活动与撤场的完整时段。',
    'events',
    ['D13', 'D05'],
    {
      ...chart('timeline', '', '拟议计划 · 不代表已批准', [
        { label: '布置与设备核对', value: Date.parse('2026-09-24T00:00:00Z') },
        { label: '读书会与撤场', value: Date.parse('2026-09-25T00:00:00Z') },
        { label: '活动复盘', value: Date.parse('2026-09-26T00:00:00Z') },
      ]),
      prompts: ['整理活动筹备清单', '核对报价包含与不包含的服务'],
    },
  ),
  card(
    26,
    '风险提醒',
    '包场，不只确认一个开始时间',
    '拟议议程还需包含布置、活动、撤场；真实容量与档期未知。',
    '把完整占用区间写进方案，核对设备与雨天安排。',
    'events',
    ['D13'],
    {
      size: '1×2',
      items: [
        { label: '布置', value: '拟13:00—14:00' },
        { label: '活动', value: '拟14:00—16:00' },
        { label: '撤场', value: '拟至16:30' },
      ],
    },
  ),
  card(
    27,
    '待办决策',
    '活动与散客，怎样同时被照顾',
    '300㎡为室内外合计，实际布局与可用容量尚待核实。',
    '先评估场地与营业影响，再选独立区域或整体包场。',
    'events',
    ['D13', 'D17'],
    {
      size: '2×2',
      ...points('comparison', [
        ['独立区域', '保留散客营业，需核对动线与声音干扰。'],
        ['整体包场', '更集中，需测算零售影响及实际空间。'],
      ]),
    },
  ),
  card(
    28,
    '成果交付',
    '企业活动方案，形成可审阅初稿',
    '30人合成情境、金额6,000元，服务范围与待确认项分别列出。',
    '金额是演示报价，没有发送给客户。',
    'events',
    ['D20', 'D13'],
    {
      template: 'document',
      items: [
        { label: '方案', value: '人数、时段、服务范围' },
        { label: '待核对', value: '实际容量、设备和取消处理' },
      ],
    },
  ),
  card(
    29,
    '知识洞察',
    '一次活动留下什么，下次才能少问',
    '把需求纪要、服务清单与筹备记录关联，减少重复整理。',
    '保留实际变更、未解决问题和下一次可复用的模板。',
    'events',
    ['D13', 'S02'],
    {
      size: '1×2',
      ...points('analysis', [
        ['需求', '目的、人数与时间。'],
        ['执行', '服务范围与责任。'],
        ['复盘', '变更、缺口与可复用材料。'],
      ]),
    },
  ),
  card(
    30,
    '资讯',
    '贵阳咖啡博览会，即将举行',
    '9月14日预告：9月24—26日，在贵阳国际会议展览中心举行。',
    'AI解读：可先准备选品与杯测问题；未报名或参展。',
    'brand',
    ['S05'],
    { size: '2×2', ...news('S05', 'I05'), prompts: ['按采购需求准备参访清单', '核对展会消息与原文日期'] },
  ),
  card(
    31,
    '资讯',
    '生豆行情回落，门店成本还要看采购单',
    '报告周截至9月6日：商业生豆39.46元/kg，精品生豆104.92元/kg。',
    'AI解读：生豆与烘焙豆口径不同，不能把跌幅直接套到本店。',
    'finance',
    ['S06'],
    {
      ...chart('dumbbell', '元/kg', '8/31—9/6 · 报告周均价', [
        { label: '商业生豆', previous: 39.74, value: 39.46 },
        { label: '精品生豆', previous: 106.66, value: 104.92 },
      ]),
      sourceKind: 'news',
      sourceId: 'kg-S06',
      source: '农小蜂 · 原文 2026-09-09',
      presentation: {
        format: 'chart',
        kicker: '真实行业数据',
        chart: {
          kind: 'dumbbell',
          unit: '元/kg',
          period: '8/31—9/6 · 报告周均价',
          rows: [
            { label: '商业生豆', previous: 39.74, value: 39.46 },
            { label: '精品生豆', previous: 106.66, value: 104.92 },
          ],
        },
      },
    },
  ),
  card(
    32,
    '知识洞察',
    '豆价每公斤涨8元，单杯约增0.15元',
    '合成烘焙豆报价128→136元/kg，18g配方量另加4%损耗。',
    '这是原料成本敏感性，不是整杯利润降幅。',
    'finance',
    ['D11', 'S06'],
    {
      ...points('analysis', [
        ['计算', '0.018 × 1.04 × 8 = 0.14976元/杯。'],
        ['边界', '不含其他原料、工时和租金。'],
      ]),
    },
  ),
  card(
    33,
    '风险提醒',
    '按备货情景，豆量约够3.1天',
    '现存6.8kg，未来7天假设820杯；交期假设3天。',
    '先核对盘点与活动额外需求，再决定补货。',
    'finance',
    ['D11'],
    { size: '1×2', value: '3.1', unit: '天 · 情景推算' },
  ),
  card(
    34,
    '待办决策',
    '未来7天，豆量缺口约8.55kg',
    '情景需要15.3504kg，扣去库存6.8kg。',
    '未含安全库存与活动增量，也未生成采购订单。',
    'finance',
    ['D11'],
    { size: '1×1' },
  ),
  card(
    35,
    '经营数据',
    '收款10,500元里，2,400元是未来订金',
    '本期已履约活动收入11,400元，尚未收取3,300元。',
    '未收款约定9/22到期，当前未逾期；订金不计已履约收入。',
    'finance',
    ['D05'],
    {
      size: '2×2',
      ...points('comparison', [
        ['本期活动收款', '已履约收款8,100元＋未来订金2,400元。'],
        ['本期履约收入', '11,400元＝已收8,100元＋未收3,300元。'],
      ]),
    },
  ),
  card(
    36,
    '资讯',
    '看城市时段消费，回看空间需求',
    '贵州日报9月9日讨论贵阳的日咖夜酒与生活方式场景。',
    'AI解读：空谷是否做晚间业态未知，先看自己的时段需求。',
    'brand',
    ['S08'],
    { size: '1×2', ...news('S08') },
  ),
  card(
    37,
    '维护优化',
    '拟议新品清单，还不是正式菜单',
    '现有三款秋季方向属于编写方案，未核实真实在售菜单。',
    '资料状态与价格版本分开，避免把草稿当成已上市产品。',
    'brand',
    ['D17'],
    { size: '1×1' },
  ),
  card(
    38,
    '维护优化',
    '9个图源候选，1张应排除',
    '逐图核验后，发现一张是无关广告，保留8个研究候选。',
    '图片能加载不等于能再分发；保留原文与使用状态。',
    'brand',
    ['D18'],
    { template: 'document' },
  ),
  card(
    39,
    '成果交付',
    '把问题、证据与建议，放在同一页',
    '经营复盘、新品试饮计划、活动方案三份演示成果已建立资料关联。',
    '先决定最值得验证的一步，保存为团队可以继续维护的材料。',
    'personal',
    ['D15', 'D19', 'D20'],
    { size: '2×2', template: 'document' },
  ),
  card(
    40,
    '知识洞察',
    '这条结论，我们凭什么相信',
    '行业报道提供方向；本店的反馈、成本与试饮仍需独立验证。',
    '把事实、假设与建议分开，并让每条结论都能追到来源。',
    'brand',
    ['S07'],
    {
      size: '1×2',
      ...points('analysis', [
        ['外部信息', '原文保留作者与日期，不替代本店数据。'],
        ['内部资料', '合成演示记录与真实业务分别标明。'],
        ['AI判断', '说明依据和缺口，再提出验证行动。'],
      ]),
    },
  ),
];

// Static editorial findings are not silently rewritten when users edit source materials.
// A removed/unreadable source is filtered by canReadCardData in briefing.ts.
export function kongguBriefingSources(_state: DemoState): CardData[] {
  return structuredClone(kongguCards);
}
