/**
 * 合成接口：把主仓库 scripts/design/preview-workspace.ts 里的应答搬到浏览器里，
 * 让真实客户端在没有后台、模型和客户数据的情况下显示出来。所有内容都是示例数据。
 */
import datasetBriefing from '@dreamcore/contracts/fixtures/dataset-briefing.json';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  personal = uid(3),
  ops = uid(6);
const now = new Date().toISOString();
const ago = (h: number) => new Date(Date.parse(now) - h * 3600_000).toISOString();

/* —— 演示数据：一家做企业客户生意的通用公司，按大区销售、签合同、回款。
   三个视角各有一套画报、会话和资料库；页面地址里的 ?persona= 决定用哪一套，默认是老板。
   画报卡片用到产品支持的几种呈现：分组柱状图、关键指标、哑铃图、增减条、排序条、表格、步骤、方案对比、分节正文。 —— */
type Role = 'OBSERVATION' | 'INTERPRETATION' | 'ACTION' | 'OPTION' | 'CAUTION';
type DataCard = {
  kind: 'data';
  title: string;
  summary: string;
  metric: string;
  unit?: string;
  groupBy: string;
  periods?: [string, string];
  rows: [string, number, number][];
  style?: 'GROUPED_BAR' | 'DUMBBELL' | 'DELTA_BAR' | 'CURRENT_BAR' | 'TABLE';
  keyMetric?: { group: string | null; value: 'CURRENT' | 'DIFFERENCE' | 'CHANGE_PERCENT' };
};
type TextCard = {
  kind: 'text';
  type: 'INFO' | 'INSIGHT' | 'SUGGESTION' | 'RESULT';
  title: string;
  summary: string;
  analysis: string[];
  layout?: 'EDITORIAL' | 'STEPS' | 'COMPARISON';
  roles?: Role[];
};
type Persona = {
  name: string;
  space: string;
  cards: (DataCard | TextCard)[];
  conversations: [string, 'shared' | 'personal'][];
  ask: string;
  reply: string;
  files: (readonly ['FOLDER' | 'DOCUMENT', string, number | null])[];
};
const synthetic = (kind: string) => `这是合成${kind}，用于展示卡片与阅读详情，不代表真实数据或新闻来源。`;
const REGIONS = ['华东', '华南', '华北', '西南', '华中'];
const byRegion = (pairs: [number, number][]) => pairs.map(([a, b], i) => [REGIONS[i], a, b] as [string, number, number]);

const personas: Record<'boss' | 'sales' | 'finance', Persona> = {
  // 老板：经营全局，财务、销售、经营三类卡片混排
  boss: {
    name: '林知',
    space: '经营管理中心',
    cards: [
      {
        kind: 'data',
        title: '华南区 9 月回款环比下降 38%，其余大区基本持平',
        summary: '华南区 9 月回款 260 万元，较 8 月减少 160 万元；其余四个大区变化均在 ±6% 以内。',
        metric: '回款（万元）',
        groupBy: '大区',
        rows: byRegion([[486, 512], [420, 260], [355, 342], [228, 236], [190, 197]]),
      },
      {
        kind: 'text',
        type: 'INFO',
        title: '行业展会十一月集中举办，同行开始提前锁定年底订单',
        summary: '多家同行已公布参展计划，并推出年底签约优惠。销售团队可提前梳理重点客户的续约与增购时间。',
        analysis: ['展会期间客户集中比较供应商，年底前的续约和增购更容易被同行截走。', synthetic('资讯')],
        roles: ['OBSERVATION'],
      },
      {
        kind: 'data',
        title: '9 月新签合同额 1,480 万元，环比增长 5%',
        summary: '华北区增加 101 万元，是增长的主要来源；华南区减少 61 万元，其余大区基本持平。',
        metric: '新签合同额（万元）',
        groupBy: '大区',
        rows: byRegion([[560, 580], [340, 279], [240, 341], [160, 168], [110, 112]]),
        style: 'DELTA_BAR',
        keyMetric: { group: null, value: 'CURRENT' },
      },
      {
        kind: 'text',
        type: 'SUGGESTION',
        title: '本周优先跟进华南区三笔到期回款',
        summary: '三笔合同合计约 150 万元，都已过约定付款日。按下面的顺序处理。',
        analysis: ['与财务核对三笔合同的开票记录和到期日，确认金额无误。', '由客户经理逐一确认付款安排，并把结果登记回系统。', '其中一笔客户对验收结果有异议，沟通前先看验收记录。'],
        layout: 'STEPS',
        roles: ['ACTION', 'ACTION', 'CAUTION'],
      },
      {
        kind: 'text',
        type: 'INSIGHT',
        title: '华南回款下降有两种可能的解释，需要先核实',
        summary: '三家延期付款的客户情况并不相同，现有记录还不足以判断是哪一种。',
        analysis: ['客户资金安排变化：三家客户以往都在季度末集中付款，9 月的款项可能顺延到 10 月。', '合同执行存在争议：其中一家客户对验收结果有异议，付款可能与验收挂钩。', '两种解释目前都没有书面依据，需要客户经理当面确认。'],
        layout: 'COMPARISON',
        roles: ['OPTION', 'OPTION', 'CAUTION'],
      },
      {
        kind: 'data',
        title: '9 月各类费用合计 487 万元，销售费用增幅最大',
        summary: '销售费用较 8 月增加 32 万元，其余四类费用变化均在 ±6% 以内。',
        metric: '费用（万元）',
        groupBy: '费用类别',
        rows: [['销售费用', 118, 150], ['管理费用', 96, 94], ['研发费用', 210, 214], ['财务费用', 12, 12], ['其他', 18, 17]],
        style: 'TABLE',
      },
      {
        kind: 'text',
        type: 'INSIGHT',
        title: '两家大客户账期超过 90 天，占逾期应收的六成',
        summary: '截至 9 月底逾期应收 312 万元，其中两家华南客户合计 190 万元。',
        analysis: ['两家客户的逾期合同都在二季度签订，付款节点集中在 6 月和 7 月。', '账期拉长的同时，这两家客户 9 月仍有新订单，信用额度需要重新评估。', synthetic('洞察')],
        roles: ['OBSERVATION', 'INTERPRETATION'],
      },
      {
        kind: 'text',
        type: 'RESULT',
        title: '9 月经营分析报告已形成，可审阅',
        summary: '共 14 页，含大区对比、回款与费用分析。',
        analysis: ['报告由会话生成并保存在个人空间，当前为第 2 版草稿。', synthetic('成果')],
      },
    ],
    conversations: [['华南区回款下降原因分析', 'shared'], ['9 月经营分析报告', 'shared'], ['销售毛利口径说明', 'shared'], ['四季度销售政策初稿', 'personal'], ['助手功能说明', 'personal']],
    ask: '华南区 9 月回款为什么掉了这么多？帮我看看是哪些客户导致的。',
    reply: `**结论：**下降主要来自三家大客户延期付款，合计少回款约 150 万元；其余客户基本持平。

1. **大客户（3 家）**：9 月到期 5 笔，实际回款 2 笔，延期 3 笔，约 150 万元，占降幅的 94%。
2. **中小客户**：回款 96 万元，与 8 月持平。
3. **需要核对**：有 2 笔在系统里标为“财务已确认”，银行流水里还没有查到到账记录。

建议先和客户经理确认这三笔的付款安排，再核对那两笔的到账情况。`,
    files: [['FOLDER', '经营月报', null], ['FOLDER', '客户与合同', null], ['DOCUMENT', '9 月回款明细.xlsx', 182_400], ['DOCUMENT', '应收账龄口径说明.docx', 36_200], ['DOCUMENT', '四季度销售政策初稿.pdf', 1_204_000], ['DOCUMENT', '新员工入职手册 v3.pdf', 4_820_000]],
  },
  // 销售：签约、商机、续约
  sales: {
    name: '陈朗',
    space: '销售部',
    cards: [
      {
        kind: 'data',
        title: '华北区 9 月新签合同额环比增长 42%，华南区下降 18%',
        summary: '华北区 9 月新签 341 万元，较 8 月增加 101 万元；华南区减少 61 万元，其余大区基本持平。',
        metric: '新签合同额（万元）',
        groupBy: '大区',
        rows: byRegion([[560, 580], [340, 279], [240, 341], [160, 168], [110, 112]]),
      },
      {
        kind: 'text',
        type: 'INFO',
        title: '两家主要竞品下调入门版价格，中小客户询价明显增多',
        summary: '竞品把入门版年费下调约一成，并延长了试用期。近两周来自中小客户的询价里，提到价格对比的明显变多。',
        analysis: ['受影响最大的是合同额较小、决策周期短的客户，报价时需要准备好差异说明。', synthetic('资讯')],
        roles: ['OBSERVATION'],
      },
      {
        kind: 'data',
        title: '9 月新增商机 126 个，华北区增长最快',
        summary: '新增商机较 8 月多 14 个，其中华北区多 11 个；华南区减少 4 个。',
        metric: '新增商机（个）',
        unit: '个',
        groupBy: '大区',
        rows: byRegion([[38, 40], [27, 23], [19, 30], [16, 18], [12, 15]]),
        style: 'DUMBBELL',
        keyMetric: { group: null, value: 'CURRENT' },
      },
      {
        kind: 'text',
        type: 'SUGGESTION',
        title: '本周优先回访 6 个即将到期的续约客户',
        summary: '6 家客户的合同将在 30 天内到期，合计年合同额约 210 万元。按下面的顺序处理。',
        analysis: ['先确认每家客户近三个月的使用情况，找出使用明显减少的两家。', '由客户经理电话确认续约意向，再按报价权限出价。', '其中一家客户上月更换了对接人，先确认新的决策人。'],
        layout: 'STEPS',
        roles: ['ACTION', 'ACTION', 'CAUTION'],
      },
      {
        kind: 'text',
        type: 'SUGGESTION',
        title: '应对竞品降价，续约报价有两种做法',
        summary: '两种做法对毛利和续约率的影响不同，需要销售负责人决定。',
        analysis: ['维持现价，增加服务内容：毛利不变，适合使用深、切换成本高的客户。', '对中小客户给予一次性折扣：续约把握更大，但会拉低这部分合同的毛利。', '无论哪种做法，折扣都不能超出现行报价权限。'],
        layout: 'COMPARISON',
        roles: ['OPTION', 'OPTION', 'CAUTION'],
      },
      {
        kind: 'data',
        title: '在手商机金额华东区最高，华南区停滞占比偏高',
        summary: '五个大区在手商机合计 2,330 万元，较 8 月增加 110 万元；华南区减少 60 万元。',
        metric: '在手商机金额（万元）',
        groupBy: '大区',
        rows: byRegion([[820, 860], [560, 500], [380, 470], [270, 290], [190, 210]]),
        style: 'CURRENT_BAR',
      },
      {
        kind: 'text',
        type: 'INSIGHT',
        title: '报价后超过 30 天未推进的商机有 17 个，集中在华南区',
        summary: '这 17 个商机预计金额合计 420 万元，其中 11 个在华南区。',
        analysis: ['停滞商机多数停在“已报价”阶段，平均已等待 41 天。', '其中 4 个的客户对接人在上月发生过变动，原有的沟通可能已经失效。', synthetic('洞察')],
        roles: ['OBSERVATION', 'INTERPRETATION'],
      },
      {
        kind: 'text',
        type: 'RESULT',
        title: '四季度销售政策初稿已形成，可审阅',
        summary: '共 8 页，含返点规则、重点行业与价格权限。',
        analysis: ['初稿由会话生成并保存在个人空间，当前为第 1 版草稿。', synthetic('成果')],
      },
    ],
    conversations: [['华南区商机停滞原因分析', 'shared'], ['9 月销售周报汇总', 'shared'], ['续约客户清单整理', 'shared'], ['四季度销售政策初稿', 'personal'], ['助手功能说明', 'personal']],
    ask: '华南区为什么有这么多商机报价后就没动静了？',
    reply: `**结论：**华南区 11 个停滞商机里，7 个卡在客户内部审批，3 个在比价，1 个已明确暂缓。

1. **客户内部审批（7 个）**：平均已等待 41 天，其中 4 个的对接人上月有变动。
2. **比价中（3 个）**：都在对比同一家竞品的入门版报价。
3. **已暂缓（1 个）**：客户预算推迟到明年，建议在系统里改为“暂缓”，不再计入本季预测。

建议先处理对接人变动的 4 个，重新确认决策人。`,
    files: [['FOLDER', '销售周报', null], ['FOLDER', '客户与合同', null], ['DOCUMENT', '商机跟进表.xlsx', 182_400], ['DOCUMENT', '报价权限说明.docx', 36_200], ['DOCUMENT', '四季度销售政策初稿.pdf', 1_204_000], ['DOCUMENT', '产品介绍与报价模板 v3.pdf', 4_820_000]],
  },
  // 财务：费用、应收、对账
  finance: {
    name: '苏禾',
    space: '财务部',
    cards: [
      {
        kind: 'data',
        title: '9 月销售费用环比增长 27%，其余费用基本持平',
        summary: '销售费用 9 月 150 万元，较 8 月增加 32 万元；其余四类费用变化均在 ±6% 以内。',
        metric: '费用（万元）',
        groupBy: '费用类别',
        rows: [['销售费用', 118, 150], ['管理费用', 96, 94], ['研发费用', 210, 214], ['财务费用', 12, 12], ['其他', 18, 17]],
      },
      {
        kind: 'text',
        type: 'INFO',
        title: '银行年底结算高峰临近，跨行大额付款建议提前安排',
        summary: '年底前两周是银行结算高峰，跨行大额付款到账时间可能延长。可提前梳理 12 月的付款计划。',
        analysis: ['供应商付款和工资发放如果集中在最后一周，建议与银行确认截止时间。', synthetic('资讯')],
        roles: ['OBSERVATION'],
      },
      {
        kind: 'data',
        title: '9 月底应收账款余额 1,268 万元，90 天以上的增加最多',
        summary: '应收余额较 8 月底增加 104 万元，其中账龄 90 天以上的增加 34 万元。',
        metric: '应收账款余额（万元）',
        groupBy: '账龄',
        periods: ['8 月底', '9 月底'],
        rows: [['未到期', 620, 650], ['1–30 天', 240, 262], ['31–60 天', 150, 158], ['61–90 天', 86, 96], ['90 天以上', 68, 102]],
        style: 'DUMBBELL',
        keyMetric: { group: null, value: 'CURRENT' },
      },
      {
        kind: 'text',
        type: 'SUGGESTION',
        title: '本周优先完成 9 月应收账龄复核',
        summary: '系统账龄与合同到期日有出入的共 9 笔。按下面的顺序处理。',
        analysis: ['按合同到期日重算账龄，与系统账龄逐笔比对。', '把超过 90 天的 5 笔交给对应客户经理确认付款安排。', '其中 2 笔的合同做过补充协议，到期日以补充协议为准。'],
        layout: 'STEPS',
        roles: ['ACTION', 'ACTION', 'CAUTION'],
      },
      {
        kind: 'text',
        type: 'INSIGHT',
        title: '三笔收款已确认但银行流水未匹配，有两种可能',
        summary: '合计 86 万元，登记日期在 9 月 28 日至 30 日之间，需要先判断属于哪一种。',
        analysis: ['跨月到账：款项在 9 月底发出，10 月初才入账，下月流水里应能找到。', '重复登记：其中两笔对应同一份合同，可能是同一笔款登记了两次。', '在核实之前，这三笔不应计入 9 月已到账金额。'],
        layout: 'COMPARISON',
        roles: ['OPTION', 'OPTION', 'CAUTION'],
      },
      {
        kind: 'data',
        title: '9 月各部门费用与预算对比，销售部超出 7%',
        summary: '销售部实际支出 150 万元，超出预算 10 万元；其余部门都在预算以内。',
        metric: '费用（万元）',
        groupBy: '部门',
        periods: ['预算', '实际'],
        rows: [['销售部', 140, 150], ['市场部', 60, 58], ['研发部', 220, 214], ['行政部', 40, 37], ['财务部', 22, 21]],
        style: 'TABLE',
      },
      {
        kind: 'text',
        type: 'INSIGHT',
        title: '4 张差旅报销单缺少出差审批记录',
        summary: '涉及金额 3.2 万元，都来自华北区 9 月的集中拜访。',
        analysis: ['4 张报销单的行程与客户拜访记录能对上，但系统里没有事前审批。', '可能是出差前走了线下审批、事后没有补录，需要部门负责人确认。', synthetic('洞察')],
        roles: ['OBSERVATION', 'INTERPRETATION'],
      },
      {
        kind: 'text',
        type: 'RESULT',
        title: '9 月费用分析表已形成，可审阅',
        summary: '共 3 张表，含部门对比、预算执行率与同比。',
        analysis: ['分析表由会话生成并保存在个人空间，当前为第 2 版草稿。', synthetic('成果')],
      },
    ],
    conversations: [['9 月销售费用增长原因分析', 'shared'], ['9 月应收账龄复核', 'shared'], ['费用报销口径说明', 'shared'], ['年度预算调整说明', 'personal'], ['助手功能说明', 'personal']],
    ask: '9 月销售费用为什么涨了这么多？帮我按科目拆一下。',
    reply: `**结论：**增加的 32 万元里，差旅和市场活动占了九成。

1. **差旅费**：增加 17 万元，主要是华北区 9 月集中拜访客户。
2. **市场活动费**：增加 12 万元，对应两场行业会议的展位和物料。
3. **业务招待费**：增加 3 万元，在预算范围内。

另有 4 张差旅报销单缺少出差审批记录，需要补齐后再入账。`,
    files: [['FOLDER', '月度结账', null], ['FOLDER', '预算与费用', null], ['DOCUMENT', '9 月回款明细.xlsx', 182_400], ['DOCUMENT', '应收账龄口径说明.docx', 36_200], ['DOCUMENT', '供应商付款计划.xlsx', 1_204_000], ['DOCUMENT', '费用报销制度 v3.pdf', 4_820_000]],
  },
};
const asked = new URLSearchParams(location.search).get('persona');
const P = personas[asked === 'sales' || asked === 'finance' ? asked : 'boss'];
const COMPANY = '岚云智能';

const conversations = P.conversations.map(([title, where], i) => ({
  id: uid(40 + i),
  workspaceId: where === 'shared' ? ops : personal,
  title,
  updatedAt: ago([0.2, 3, 26, 30, 80][i]),
  tenantId: tenant,
}));
const reply = P.reply;

const task = (id: string, prompt: string, text: string, artifacts: unknown[] = []) => ({
  id,
  prompt,
  mode: 'AGENT',
  status: 'SUCCEEDED',
  revision: 1,
  attempt: 0,
  summaryCode: null,
  errorCode: null,
  engineVersion: null,
  sourcesUnavailable: false,
  sources: [],
  createdAt: ago(0.3),
  reply: text,
  executionClass: 'live',
  modelName: null,
  artifacts,
  publicQuery: null,
  webSources: [],
  skills: [],
  originals: [],
  waitReason: null,
  requiredInput: null,
  supplementalInput: '',
  reconciliationRequired: false,
});

const sections = (roles?: Role[]) => (roles ?? []).map((role, paragraphIndex) => ({ role, paragraphIndex }));
function dataDocument(card: DataCard, i: number) {
  const doc = structuredClone(datasetBriefing) as typeof datasetBriefing & { content: { presentation?: unknown } };
  const c = doc.content;
  const pct = (a: number, b: number) => (((b - a) / a) * 100).toFixed(2);
  const rank = (values: number[], v: number) => 1 + values.filter((x) => x > v).length;
  const before = card.rows.map((r) => r[1]),
    after = card.rows.map((r) => r[2]);
  const sumBefore = before.reduce((a, b) => a + b, 0),
    sumAfter = after.reduce((a, b) => a + b, 0);
  doc.artifactId = uid(60 + i);
  c.title = card.title;
  c.summary = card.summary;
  c.analysis = ['图表使用固定数据快照中的完整记录计算，其他期间未纳入本次比较。', '数字变化不代表原因已经明确，还需结合业务背景作进一步分析。'];
  c.generatedAt = ago(i + 1);
  c.chart.metric = card.metric;
  c.chart.unit = card.unit ?? '万元';
  [c.chart.baseline, c.chart.current] = card.periods ?? ['8 月', '9 月'];
  c.chart.rows = card.rows.map(([group, baseline, current]) => ({
    group,
    baseline: String(baseline),
    current: String(current),
    difference: String(current - baseline),
    changePercent: pct(baseline, current),
    baselineRank: rank(before, baseline),
    currentRank: rank(after, current),
    issue: null,
  }));
  c.chart.totals = { ...c.chart.totals, baseline: String(sumBefore), current: String(sumAfter), difference: String(sumAfter - sumBefore), changePercent: pct(sumBefore, sumAfter) };
  c.datasetSource.name = '合成经营数据';
  c.datasetBasis.groupColumn = card.groupBy;
  if (card.style || card.keyMetric)
    c.presentation = {
      version: 'briefing-presentation-v1',
      layout: card.keyMetric ? 'KEY_METRIC' : 'EDITORIAL',
      chartStyle: card.style ?? 'GROUPED_BAR',
      focusGroup: card.keyMetric?.group ?? null,
      focusValue: card.keyMetric?.value ?? null,
      sections: [],
    };
  return doc;
}
const textDocument = (card: TextCard, i: number) => ({
  artifactId: uid(60 + i),
  sha256: 'a'.repeat(64),
  content: {
    schemaVersion: 'briefing-text-v1',
    businessType: card.type,
    title: card.title,
    summary: card.summary,
    analysis: card.analysis,
    ...(card.layout || card.roles
      ? { presentation: { version: 'briefing-presentation-v1', layout: card.layout ?? 'EDITORIAL', chartStyle: null, focusGroup: null, focusValue: null, sections: sections(card.roles) } }
      : {}),
    chart: null,
    source: null,
    calculationArtifactId: null,
    calculationSha256: null,
    generatedAt: ago(i + 1),
  },
});

const briefTasks = P.cards.map((_, i) => uid(100 + i));
const briefConversation = uid(45);
const documents: Record<string, unknown> = Object.fromEntries(
  P.cards.map((card, i) => [briefTasks[i], card.kind === 'data' ? dataDocument(card, i) : textDocument(card, i)]),
);
const recommendation = (taskId: string, i: number) => {
  const card = P.cards[i];
  const mine = card.kind === 'text' && card.type === 'RESULT';
  return {
    content: {
      kind: 'TASK',
      id: taskId,
      versionKey: `task:${taskId}:1:1`,
      workspaceId: mine ? personal : ops,
      workspaceName: mine ? '个人空间' : P.space,
      title: card.title,
      excerpt: card.summary,
      truncated: false,
      createdAt: ago(i * 2 + 0.5),
      executionClass: 'live',
      conversationId: briefConversation,
      taskRevision: 1,
      attempt: 1,
      preferenceRevision: 0,
      materialId: null,
      materialVersion: 0,
      filename: '',
      pinned: false,
      openedAt: mine ? ago(1) : null,
    },
    briefing: documents[taskId],
    score: 1 - i / 20,
    method: { versionId: null, adoptionRevision: 0, scope: 'BUILTIN', workspaceId: null, configurationSha: 'a'.repeat(64) },
    presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
    reason: '',
    availability: 'AVAILABLE_IN_APP',
    feedbackTarget: {
      kind: 'BRIEFING',
      taskId,
      taskRevision: 1,
      attempt: 1,
      presentationVersion: 'recommendation-v1',
      presentationRevision: 1,
    },
  };
};


function answer(method: string, url: URL): unknown {
  const path = url.pathname;
    let json: unknown;
    const conv = conversations.find((c) => path.endsWith('/conversations/' + c.id));
    const briefDoc = briefTasks.find((t) => path.endsWith(`/tasks/${t}/briefing`));
    if (path === '/api/v1/me')
      json = {
        account: { id: account, phone: '+8619900009001', displayName: P.name },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: COMPANY, role: 'MEMBER' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: COMPANY, status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [
          { id: personal, name: '个人空间', kind: 'PERSONAL' },
          { id: ops, name: P.space, kind: 'SHARED' },
        ],
      };
    else if (path.endsWith('/library-access/status')) json = { enabled: false };
    else if (path.endsWith('/native-conversations/availability')) json = { enabled: false };
    else if (path.endsWith('/conversations/presentation-capability')) json = { available: false };
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' };
    else if (briefDoc) json = documents[briefDoc];
    else if (path.endsWith('/library')) {
      const files = P.files;
      json = {
        tenantId: tenant,
        workspaceId: personal,
        folderId: url.searchParams.get('folder'),
        trail: [],
        canMaintain: true,
        maxUploadBytes: 1000000,
        hasMore: false,
        items: files.map(([kind, name, sizeBytes], i) => ({
          id: uid(90 + i),
          tenantId: tenant,
          workspaceId: personal,
          workspaceName: '个人空间',
          folderId: null,
          kind,
          name,
          version: kind === 'DOCUMENT' ? 1 + (i % 3) : 0,
          sizeBytes,
          updatedAt: ago(i * 20 + 2),
          path: ['个人空间'],
          canMaintain: true,
        })),
      };
    } else if (path.endsWith('/governance'))
      json = { tenantId: tenant, ownerId: null, ownerName: null, revision: 0, owner: false,
        canConfigure: false, canAcceptInitialResponsibility: false, canEnterManagement: false,
        capabilities: [], pendingHandover: null };
    else if (path.includes('/conversation-attachments/drafts/')) json = { conversation: null };
    else if (path.includes('/conversations/') && path.endsWith('/attachments')) json = [];
    else if (path.includes('/conversations/') && path.endsWith('/answer-snapshot')) json = { items: [] };
    else if (path.endsWith('/business-status'))
      json = { tenantId: tenant, businessEnabled: true, canExport: false, exitState: null, exportDeadline: null };
    else if (briefTasks.some((t) => path.endsWith('/tasks/' + t))) {
      const id = briefTasks.find((t) => path.endsWith('/tasks/' + t))!;
      json = {
        conversation: { id: briefConversation, tenantId: tenant, workspaceId: ops, title: '画报生成', updatedAt: now },
        tasks: [{ ...task(id, '生成画报', '画报已生成。', [{ id: uid(80), filename: P.cards[briefTasks.indexOf(id)].kind === 'data' ? 'briefing-dataset-example.json' : 'briefing-text-example.json', sha256: 'a'.repeat(64), bytes: 100 }]), attempt: 1 }],
        hasMore: false,
        cursor: 1,
      };
    }
    else if (path.endsWith('/conversations'))
      json = { tenantId: tenant, enabled: true, agentMode: 'live', publicWebEnabled: true, items: conversations, hasMore: false };
    else if (conv)
      json = {
        conversation: conv,
        tasks: [task(uid(70), P.ask, reply)],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/conversations/' + briefConversation))
      json = {
        conversation: { id: briefConversation, tenantId: tenant, workspaceId: ops, title: '画报生成', updatedAt: now },
        tasks: [],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/events')) json = { conversationId: conversations[0].id, items: [], cursor: 1, hasMore: false };
    else if (path.endsWith('/plan-receipts')) json = [];
    else if (path.includes('/recommendations'))
      json = {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: briefTasks.map(recommendation),
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: briefTasks.length,
        rankedCount: briefTasks.length,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      };
    else if (path.endsWith('/briefing/layout')) json = { tenantId: tenant, revision: 0 };
    else if (path.endsWith('/briefing'))
      json = { tenantId: tenant, view: url.searchParams.get('view'), date: null, zone: null, items: [], hasMore: false, asOf: now };
    else if (path.endsWith('/briefing/generation')) json = { policies: [], batches: [] };
    else if (path.endsWith('/workspace/notifications')) json = { tenantId: tenant, conversations: true, briefing: false };
    else if (path.endsWith('/feedback')) json = { feedback: null };
    else if (path.endsWith('/discussion')) {
      const m = path.match(/conversations\/([^/]+)\/tasks\/([^/]+)\/discussion/)!;
      json = {
        conversationId: null,
        title: '画报讨论',
        briefingContext: {
          conversationId: m[1],
          taskId: m[2],
          workspaceId: ops,
          taskRevision: Number(url.searchParams.get('revision')),
          attempt: Number(url.searchParams.get('attempt')),
        },
      };
    }
    else return undefined;
  return json;
}

export function installMockApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    let json = answer(method, url);
    // 打开画报时客户端会登记一次“已打开”，这里原样回执。
    if (method === 'POST' && url.pathname.endsWith('/recommendations/opened')) {
      const target = JSON.parse(typeof init?.body === 'string' ? init.body : ((await request?.clone().text()) ?? '{}'));
      json = { target, openedAt: new Date().toISOString(), evidence: 'USER_OPEN_ACTION', businessOutcome: 'NOT_ASSESSED' };
    }
    if (json === undefined) ((window as unknown as { __unmocked: string[] }).__unmocked ??= []).push(`${(init?.method ?? request?.method ?? 'GET').toUpperCase()} ${url.pathname}${url.search}`);
    return new Response(JSON.stringify(json ?? { code: 'FIXTURE_UNAVAILABLE' }), {
      status: json === undefined ? 404 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  // 演示里没有流式回答，给一个不发消息的替身。
  class SilentEventSource extends EventTarget {
    readyState = 0;
    onmessage = null;
    onerror = null;
    onopen = null;
    close() {}
  }
  (window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;
}
