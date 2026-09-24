import type { CardData, CardType } from './briefing.ts';
import type { BriefingChart } from './briefingPresentation.ts';
import { briefingPresentation } from './briefingPresentation.ts';
import { kongguCards } from './kongguBriefing.ts';

export const magazineTypes = ['资讯', '数据', '洞察', '建议', '成果', '会话'] as const;
export type MagazineType = (typeof magazineTypes)[number];
const legacyTypes: Record<CardType, MagazineType> = {
  资讯: '资讯',
  经营数据: '数据',
  待办决策: '建议',
  项目进展: '数据',
  风险提醒: '建议',
  成果交付: '成果',
  知识洞察: '洞察',
  维护优化: '建议',
  活跃会话: '会话',
};
export function magazineType(data: CardData): MagazineType {
  return data.sourceKind === 'conversation' || data.template === 'conversation'
    ? '会话'
    : legacyTypes[data.type];
}
export function magazineFilter(value: string): string {
  return legacyTypes[value as CardType] || (magazineTypes.includes(value as MagazineType) ? value : '全部');
}
type MagazinePhoto = Pick<NonNullable<CardData['photo']>, 'src' | 'alt' | 'credit' | 'fit'>;
export const magazineCoffee: MagazinePhoto = {
  src: '/images/briefing/editorial-coffee-ai.jpg',
  alt: 'AI生成的咖啡与柑橘示意照片，非空谷门店或产品实拍',
  credit: 'AI 示意配图 · 非产品实拍',
};
type MagazineView = {
  headline?: string;
  summary: string;
  note?: string;
  value?: string;
  unit?: string;
  chart?: BriefingChart;
  photo?: MagazinePhoto;
  dots?: { selected: number; total: number };
  steps?: string[];
};
const editions: Record<string, Partial<MagazineView>> = {
  'konggu:C01': {
    headline: '过去7天，零售向上。',
    summary: '1,307单 · 较上期增长12.6%',
    note: '模拟零售净销售额 · 9/13—9/19',
  },
  'konggu:C02': {
    headline: '增长，从订单与客单拆起。',
    value: '+12.6%',
    unit: '两期可比7天',
    summary: '订单1,189 → 1,307单',
    note: '增长原因仍需逐时订单与促销证据。',
  },
  'konggu:C07': {
    headline: '先找到等待的那一段。',
    summary: '下次分时观察，记录三个时刻。',
    note: '20单合成样例 · 不代表全天',
    steps: ['点单', '制作', '取餐'],
  },
  'konggu:C08': {
    headline: '把这一周，整理成一页。',
    summary: '零售、活动与资料缺口，形成复盘草稿。',
    note: '演示成果 · 待审阅',
  },
  'konggu:C09': {
    headline: '购买会员，有多少？',
    summary: '840笔会员订单 · 另467笔未识别',
    note: '合成去重会员数 · 不等于客流',
  },
  'konggu:C12': {
    headline: '低甜度，被更多人提起。',
    summary: '40份合成自愿反馈',
    note: '可多选 · 不代表所有顾客',
    chart: {
      kind: 'lollipop',
      unit: '份',
      period: '合成问卷 · 可多选',
      rows: [
        { label: '更低甜度', value: 16 },
        { label: '等候较长', value: 12 },
        { label: '植物奶', value: 9 },
      ],
    },
  },
  'konggu:C13': {
    headline: '回访名单，先核对再联系。',
    summary: '先核对联系范围与文案。',
    note: '合成候选 · 已发送0条',
  },
  'konggu:C15': {
    headline: '来喝咖啡，还是度过一个下午？',
    summary: '从饮品出发，重新观察空间需求。',
    note: '本店到店动机仍待调查。',
    photo: magazineCoffee,
  },
  'konggu:C17': {
    headline: 'V2，获得更多偏好。',
    summary: '',
    note: '合成小样本 · 购买意愿未验证',
    dots: { selected: 9, total: 12 },
  },
  'konggu:C19': {
    headline: '试售之前，再验证三件事。',
    summary: '把偏好转成可比较的记录。',
    note: '拟议新品 · 稳定性待验证',
    steps: ['出杯时间', '异常记录', '价格接受'],
  },
  'konggu:C20': {
    headline: '喜欢之后，还要验证价格。',
    summary: '口味与价格分开验证，保留反对理由。',
    note: '12人合成试饮 · 未测量付费行为',
  },
  'konggu:C22': {
    headline: '让每次试饮，都留下依据。',
    summary: '版本、甜度、价格与制作稳定性。',
    note: '演示计划草稿 · 待审阅',
  },
  'konggu:C26': {
    headline: '为活动留出完整时段。',
    summary: '拟13:00布置 · 14:00活动 · 16:30前撤场',
    note: '容量与档期待核实',
    steps: ['布置', '活动', '撤场'],
  },
};

// These are presentation-only summaries of the three exact, prewritten demo
// replies. A new or edited reply must immediately return to its own live text.
const conversations: Record<string, { fact: string; view: Partial<MagazineView> }> = {
  'kg-m2': {
    fact: '根据模拟底表，9/13—9/19零售48,178元，已履约活动11,400元，综合销售59,578元。活动收款10,500元中含未来订金2,400元，不能将收款直接当收入。\n\n增长原因仍需逐时订单、促销与活动占用记录。已准备一份演示分析草稿，便于继续核对。',
    view: {
      headline: '这一周，销售来自哪里？',
      value: '59,578',
      unit: '元 · 综合销售',
      summary: '零售48,178 + 已履约活动11,400',
      note: '模拟底表 · 收款不等于收入',
    },
  },
  'kg-m4': {
    fact: '真实报道可以提供贵州食材的方向；40份合成反馈中16份提到更低甜度。刺梨冷萃的12人合成试饮记录中9人偏好V2，但尚不能证明购买意愿。\n\n建议补齐出杯稳定性和价格验证，再讨论试售。这是预编写的分析示例，不代表空谷已经组织试饮或决定上市。',
    view: {
      headline: '下一杯，从低甜度开始？',
      summary: '16 / 40份合成反馈提到更低甜度',
      note: '购买意愿与制作稳定性待验证',
      photo: magazineCoffee,
    },
  },
  'kg-m6': {
    fact: '本情境计划30人，金额6,000元，订金2,400元。先核对实际空间、设备、雨天安排以及散客影响；300㎡是室内外合计，不能据此推定可用座位或安全容量。\n\n方案仍为演示草稿，没有发送给客户，也未形成真实档期承诺。',
    view: {
      headline: '一场读书会，从筹备开始。',
      value: '30',
      unit: '人 · 拟议计划',
      summary: '空间、设备、雨天安排，逐项核对。',
      note: '演示草稿 · 容量与档期未确认',
    },
  },
};

export function magazineView(data: CardData): MagazineView {
  const type = magazineType(data),
    presentation = briefingPresentation(data);
  const view: MagazineView = {
    summary: type === '建议' ? data.advice || data.fact : data.fact,
    note: type === '建议' && data.advice ? data.fact : undefined,
    value: data.value,
    unit: data.unit,
    chart: presentation?.chart,
  };
  const original = kongguCards.find((card) => card.id === data.id);
  const contentFields = ['title', 'fact', 'advice', 'value', 'unit', 'items', 'presentation'] as const;
  if (original && contentFields.every((key) => JSON.stringify(original[key]) === JSON.stringify(data[key])))
    Object.assign(view, editions[data.id]);
  if (type === '会话') {
    const edition = conversations[data.conversation?.replyId || ''];
    if (edition?.fact === data.fact) Object.assign(view, edition.view);
  }
  return view;
}
