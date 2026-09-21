import type { CardData } from './briefing.ts';
import type { DemoState, Material } from './model.ts';
import { briefingV2Examples } from './briefingV2Examples.ts';

export type Example = Pick<
  CardData,
  | 'type'
  | 'template'
  | 'title'
  | 'fact'
  | 'advice'
  | 'space'
  | 'size'
  | 'prompts'
  | 'items'
  | 'value'
  | 'unit'
  | 'presentation'
  | 'people'
> & {
  key: string;
  at: string;
  sourceTitle: string;
  owner: string;
  detail: string;
};

// Four authored demo editions, not reconstructed history of the user's work.
// Dates and IDs stay fixed across reloads; each card has an inspectable source.
export const briefingExamples: Example[] = [
  ...briefingV2Examples,
  {
    key: 'opportunity-funnel',
    at: '2026-09-19T17:40:00+08:00',
    type: '经营数据',
    template: 'chart',
    title: '本周商机推进',
    fact: '18 条在跟商机，6 条进入方案评估。',
    advice: '优先补齐方案评估中的预算与决策人信息。',
    space: 'sales',
    size: '2×1',
    value: '18',
    unit: '条商机',
    items: [
      { label: '初步沟通', value: '9' },
      { label: '方案评估', value: '6' },
      { label: '待签约', value: '3' },
    ],
    prompts: ['按商机阶段梳理下一步', '列出方案评估还缺的信息'],
    sourceTitle: '销售商机周报',
    owner: '陈言',
    detail:
      '统计范围：9 月 14—19 日仍在跟进的 18 条商机，按当前阶段互斥计数。\n初步沟通 9 条，方案评估 6 条，待签约 3 条。方案评估中 2 条缺预算、1 条缺决策人信息，其余 3 条信息齐备。\n海岚设计（合成客户）希望先验证资料检索；远山商贸（合成客户）关注报价口径。\n商机数不等于客户跟进应用的记录数，也不代表已成交收入。',
  },
  {
    key: 'receivables-aging',
    at: '2026-09-19T17:10:00+08:00',
    type: '经营数据',
    template: 'chart',
    title: '待回款账龄分布',
    fact: '待回款 26 万元，其中 8 万元已逾期。',
    advice: '先核对逾期原因与预计到账日，再更新跟进安排。',
    space: 'finance',
    size: '2×1',
    value: '26',
    unit: '万元',
    items: [
      { label: '未到期', value: '18' },
      { label: '逾期≤30天', value: '6' },
      { label: '逾期>30天', value: '2' },
    ],
    prompts: ['整理逾期款项核对清单', '区分已到账与待回款口径'],
    sourceTitle: '应收款核对表',
    owner: '周宁',
    detail:
      '截至 9 月 19 日，合成应收余额 26 万元：未到期 18 万元、逾期 1—30 天 6 万元、逾期超过 30 天 2 万元。\n逾期金额合计 8 万元。周宁核对到账记录，陈言补充客户预计付款日。\n这是未到账余额，与“近四周已到账回款 57 万元”属于不同统计口径，不可相加作为收入；本卡不表示实际催收已执行。',
  },
  {
    key: 'trial-roster',
    at: '2026-09-19T16:25:00+08:00',
    type: '风险提醒',
    template: 'number',
    title: '试用名单还差 2 位',
    fact: '计划 10 人试用，已收到 8 人名单。',
    advice: '陈言在 9 月 21 日前补齐，名单未齐不标记准备完成。',
    space: 'project-delivery',
    size: '1×1',
    value: '2',
    unit: '位待补',
    prompts: ['列出名单缺口与负责人', '准备给客户的确认要点'],
    sourceTitle: '客户 A 试用准备记录',
    owner: '陈言',
    detail:
      '9 月 18 日配置走查准备时，已收到 8 位试用成员的合成名单；截至 9 月 19 日仍缺 2 位。\n试用目标为 10 人，各自完成一次资料检索、方案草拟和成果共享流程。\n陈言负责补齐名单，许然核对培训时段；本演示不包含真实姓名、账号或授权数据，也不自动开通账号。',
  },
  {
    key: 'homepage-review',
    at: '2026-09-19T15:30:00+08:00',
    type: '待办决策',
    template: 'list',
    title: '官网首屏，先说清楚交付',
    fact: '首屏评审留下 3 个需要明确的问题。',
    advice: '先确认表达，再继续排版与案例选择。',
    space: 'project-website',
    size: '1×2',
    items: [
      { label: '面向谁', value: '小团队中的资料维护者与业务负责人' },
      { label: '交付什么', value: '可复用的方案、资料与工作流程' },
      { label: '下一步', value: '预约一次具体业务场景演示' },
    ],
    prompts: ['按照这三个问题改写首屏', '整理评审前需要补充的依据'],
    sourceTitle: '官网首屏评审纪要',
    owner: '曹鸿健',
    detail:
      '基于 9 月 17 日信息架构首稿进行内部评审。\n问题一：服务对象过宽，需要明确小团队的具体岗位。\n问题二：“提高效率”缺少可交付内容，需要落到方案、资料和工作流程。\n问题三：联系入口重复，建议保留一个明确的场景演示入口。\n以上为待确认意见，未代表页面已修改或发布。',
  },
  {
    key: 'sales-faq',
    at: '2026-09-19T14:20:00+08:00',
    type: '成果交付',
    template: 'document',
    title: '销售问答已补齐 8 项',
    fact: '适用对象、服务边界与试用条件已有初稿。',
    advice: '价格与能力承诺由对应负责人核对后再对外使用。',
    space: 'project-launch',
    size: '2×1',
    prompts: ['预览销售问答初稿', '列出对外使用前的核对项'],
    sourceTitle: '新品销售问答初稿',
    owner: '陈言',
    detail:
      '初稿覆盖 8 项：适用团队、资料准备、试用人数、培训方式、服务范围、价格依据、数据查看范围、后续维护。\n建议回答：先选择一个真实工作场景验证，再确定后续实施范围。\n价格以已确认的服务范围为依据，未验证的接口与自动化能力不作承诺。\n陈言整理初稿，许然检查演示步骤，周宁核对价格表述；当前尚未完成对外确认。',
  },
  {
    key: 'weekly-meeting',
    at: '2026-09-19T11:50:00+08:00',
    type: '待办决策',
    template: 'list',
    title: '周会留下 3 件待确认事项',
    fact: '名单、发布口径、案例授权分别落实到人。',
    advice: '逐项确认截止日期，避免把讨论建议当作已完成工作。',
    space: 'personal',
    size: '1×2',
    items: [
      { label: '陈言 · 9/21', value: '补齐客户 A 的 2 位试用名单' },
      { label: '许然 · 9/22', value: '走查新品演示步骤与能力边界' },
      { label: '曹鸿健 · 9/23', value: '核对官网 2 份案例使用许可' },
    ],
    prompts: ['生成下一次周会跟进清单', '按负责人整理待确认事项'],
    sourceTitle: '团队周会行动记录',
    owner: '曹鸿健',
    detail:
      '本期周会讨论了客户交付、新品发布与官网内容三个主题。\n名单补齐由陈言跟进；演示口径由许然走查；案例许可由曹鸿健确认。\n日期为合成场景中的约定时间，未创建真实任务、发送通知或代表负责人已接受任务。\n复盘时分别核对依据、实际完成结果与仍需帮助的部分。',
  },
  {
    key: 'onboarding-answers',
    at: '2026-09-19T10:15:00+08:00',
    type: '知识洞察',
    template: 'number',
    title: '新人找资料，少问一次',
    fact: '6 条入门问答有了资料路径，另 2 条待补。',
    advice: '优先补充“谁来确认”和“旧版本在哪里”。',
    space: 'personal',
    size: '1×1',
    value: '6',
    unit: '条已整理',
    prompts: ['预览新人入门问答', '补充确认人与版本查找说明'],
    sourceTitle: '新人资料导航问答',
    owner: '曹鸿健',
    detail:
      '已整理：服务价格依据、客户需求、项目计划、发布材料、官网范围、团队协作指南，共 6 项。\n待补：成果由谁确认、如何找到旧版本，共 2 项。\n建议入门顺序：先明确所属空间，再查找当前有效资料，最后确认下一步负责人。\n此问答是合成培训材料，不包含真实员工的入职记录。',
  },
  {
    key: 'feedback-to-knowledge',
    at: '2026-09-19T09:10:00+08:00',
    type: '资讯',
    template: 'editorial',
    title: '把一次客户问题，变成团队知识',
    fact: '有依据的回答，才值得被下一位同事复用。',
    advice: '选一个重复出现的问题，保存答案、来源与适用条件。',
    space: 'personal',
    size: '2×1',
    items: [
      { label: '记录问题', value: '保留客户原问题和使用场景' },
      { label: '补上依据', value: '关联有效资料与确认人' },
      { label: '标明边界', value: '写清适用范围和复查时间' },
    ],
    prompts: ['把销售常见问题整理成知识卡', '设计一份回答复用检查清单'],
    sourceTitle: '工作方法阅读札记：知识复用',
    owner: '曹鸿健',
    detail:
      '这是一篇为演示编写的工作方法札记，不引用外部新闻或研究结论。\n场景：销售回答了客户的数据查看范围问题，交付同事随后遇到相同问题。\n建议把确认过的回答连同资料依据和适用条件一起保存；遇到新条件时重新核对，不直接复制旧结论。',
  },
  {
    key: 'invoice-readiness',
    at: '2026-09-18T17:30:00+08:00',
    type: '待办决策',
    template: 'number',
    title: '开票前还有 3 项待补',
    fact: '7 笔申请中，4 笔资料齐备，3 笔仍待补充。',
    advice: '先核对抬头、税号和服务明细，不将资料齐备等同已开票。',
    space: 'finance',
    size: '1×1',
    value: '3',
    unit: '笔待补',
    prompts: ['按缺失字段整理开票核对单', '区分待补资料、可开票与已开票'],
    sourceTitle: '开票资料准备表',
    owner: '周宁',
    detail:
      '合成申请共 7 笔：4 笔抬头、税号与服务明细齐备；2 笔缺服务明细，1 笔缺抬头确认。\n本表未包含真实税号，不连接开票系统。资料齐备只表示可进入下一步核对，当前 7 笔均不据此标记已开票。\n周宁整理缺口，陈言向相关业务负责人确认服务明细。',
  },
  {
    key: 'delivery-walkthrough',
    at: '2026-09-18T16:40:00+08:00',
    type: '项目进展',
    template: 'progress',
    title: '客户 A 试用配置走查',
    fact: '当前阶段：走查准备。',
    advice: '8 个准备项已完成 6 个，名单与培训时段仍待确认。',
    space: 'project-delivery',
    size: '1×1',
    items: [
      { label: '准备进度', value: '6 / 8 项，名单已收到 8 / 10 人' },
      { label: '交付日期', value: '2026-09-25' },
    ],
    prompts: ['列出走查前的两个阻塞项', '整理一份试用走查顺序'],
    sourceTitle: '客户 A 配置走查清单',
    owner: '许然',
    detail:
      '准备项共 8 个：需求范围、资料清单、空间结构、角色说明、演示脚本、反馈表共 6 个已在合成场景中备齐。\n试用名单仍缺 2 人，培训时段待客户确认。\n9 月 25 日进行配置与演示流程走查；9 月 30 日培训；10 月 9 日交付。配置走查不是最终客户验收。',
  },
  {
    key: 'customer-questions',
    at: '2026-09-18T15:35:00+08:00',
    type: '知识洞察',
    template: 'list',
    title: '客户最常问的 3 个问题',
    fact: '5 次访谈中，资料、价格和维护反复被提及。',
    advice: '把问题转成有依据的回答，避免扩展未确认承诺。',
    space: 'sales',
    size: '2×1',
    items: [
      { label: '资料', value: '哪些同事可以看到哪些内容？' },
      { label: '价格', value: '基础服务与新增实施如何区分？' },
      { label: '维护', value: '资料更新后由谁核对？' },
    ],
    prompts: ['整理三类问题的回答提纲', '标记每个回答需要的资料依据'],
    sourceTitle: '客户访谈问题归纳',
    owner: '陈言',
    detail:
      '样本为 5 次合成访谈，不代表真实调研结论。\n查看范围被 4 次提及，价格边界被 3 次提及，后续维护被 3 次提及；同一次访谈可提多个问题，因此次数不可相加当作客户数。\n回答前分别核对权限说明、服务范围和资料维护责任。',
  },
  {
    key: 'case-permissions',
    at: '2026-09-18T14:30:00+08:00',
    type: '风险提醒',
    template: 'number',
    title: '案例素材授权尚未齐备',
    fact: '4 份候选案例中，2 份仍需核对使用许可。',
    advice: '未获明确许可的素材暂不进入对外页面。',
    space: 'project-website',
    size: '1×1',
    value: '2',
    unit: '份待确认',
    prompts: ['整理案例授权核对清单', '起草不含客户背书的替代文案'],
    sourceTitle: '官网案例素材清单',
    owner: '曹鸿健',
    detail:
      '4 份合成候选案例：2 份在场景记录中已确认使用范围，另 2 份缺对外展示许可。\n需要核对客户名称、截图、业务数字及使用期限，不能用内部可见代替对外许可。\n本演示不包含真实客户案例或许可文件，页面尚未发布。',
  },
  {
    key: 'pilot-feedback',
    at: '2026-09-18T13:45:00+08:00',
    type: '经营数据',
    template: 'chart',
    title: '首轮内测反馈去向',
    fact: '12 条反馈中，5 条已解决，4 条等待验证。',
    advice: '优先验证影响演示主流程的问题。',
    space: 'project-launch',
    size: '2×1',
    value: '12',
    unit: '条反馈',
    items: [
      { label: '已解决', value: '5' },
      { label: '待验证', value: '4' },
      { label: '待评估', value: '3' },
    ],
    prompts: ['按演示影响排序待验证问题', '设计一次反馈复测记录'],
    sourceTitle: '新品内测反馈台账',
    owner: '许然',
    detail:
      '12 条合成内测反馈按当前状态互斥计数：已解决 5 条、待验证 4 条、待评估 3 条。\n4 条待验证分别涉及引用定位、共享说明、窄屏输入和返回阅读位置。\n状态“已解决”仅为演示台账中的样例，不是当前软件测试结果；复测需要记录步骤、观察和验收人。',
  },
  {
    key: 'interview-notes',
    at: '2026-09-18T11:20:00+08:00',
    type: '成果交付',
    template: 'document',
    title: '客户访谈纪要已整理',
    fact: '5 次访谈整理出 3 项共性需求。',
    advice: '先请访谈负责人核对原意，再转成方案输入。',
    space: 'sales',
    size: '2×1',
    prompts: ['预览访谈纪要', '把共性需求转成方案提纲'],
    sourceTitle: '客户访谈纪要汇编',
    owner: '陈言',
    detail:
      '共性需求一：找到当前有效资料，减少向同事反复询问。\n共性需求二：方案能说明依据，方便负责人核对。\n共性需求三：确认后的成果能被团队继续使用。\n整理自 5 次合成访谈，涉及海岚设计、远山商贸等虚构客户；此汇编是待核对初稿，不能当作真实客户调研。',
  },
  {
    key: 'duplicate-review',
    at: '2026-09-18T10:10:00+08:00',
    type: '维护优化',
    template: 'number',
    title: '4 组相似资料，先核对再合并',
    fact: '标题或内容相近，不代表可以直接删除。',
    advice: '先分清版本、适用客户和已确认状态。',
    space: 'personal',
    size: '1×1',
    value: '4',
    unit: '组待核对',
    prompts: ['生成相似资料比对表', '列出必须保留的版本与依据'],
    sourceTitle: '相似资料人工核对建议',
    owner: '曹鸿健',
    detail:
      '4 组合成候选：合作方案初稿与修订稿、发布介绍长版与短版、客户需求原纪要与整理稿、培训说明新旧稿。\n建议比较资料身份、适用对象、确认状态和版本关系，不按文件名或更新时间直接合并。\n这里只提供演示核对建议，没有扫描用户文件、合并或删除任何资料。',
  },
  {
    key: 'handoff-checklist',
    at: '2026-09-18T09:15:00+08:00',
    type: '知识洞察',
    template: 'document',
    title: '交接清单：把责任写到最后一步',
    fact: '负责人、截止日、验收依据缺一项，就先补齐。',
    advice: '用客户 A 培训准备验证这份清单是否够用。',
    space: 'project-delivery',
    size: '2×1',
    prompts: ['预览交接检查清单', '套用到客户 A 培训准备'],
    sourceTitle: '项目交接检查清单',
    owner: '许然',
    detail:
      '交接对象：本次交接的成果和明确版本。\n交接责任：准备人、接收人、最终确认人分别是谁。\n验收条件：下一位同事能否按资料完成指定工作。\n未完成项：写明缺口、负责人和复查时间。\n培训结束、资料发送与客户验收是三件不同的事，应分别记录。',
  },
  {
    key: 'qualified-inquiries',
    at: '2026-09-17T17:45:00+08:00',
    type: '经营数据',
    template: 'trend',
    title: '近四周有效咨询',
    fact: '合计 46 条，最近一周 15 条。',
    advice: '结合来源与需求质量复盘，不只比较数量。',
    space: 'sales',
    size: '2×2',
    value: '46',
    unit: '条',
    items: [
      { label: '8/27', value: '8' },
      { label: '9/3', value: '11' },
      { label: '9/10', value: '12' },
      { label: '9/17', value: '15' },
    ],
    prompts: ['分析四周咨询变化', '设计咨询来源与质量复盘表'],
    sourceTitle: '有效咨询周度汇总',
    owner: '陈言',
    detail:
      '按每周结束日统计新增有效咨询：8 月 27 日 8 条，9 月 3 日 11 条，9 月 10 日 12 条，9 月 17 日 15 条，合计 46 条。\n有效咨询定义：合成记录中同时包含联系方式、具体业务问题和允许后续沟通的条目。重复咨询在同周内去重。\n咨询不等于商机、成交或收入，不据此宣称增长来自某个渠道。',
  },
  {
    key: 'launch-budget',
    at: '2026-09-17T16:30:00+08:00',
    type: '经营数据',
    template: 'chart',
    title: '发布预算使用进度',
    fact: '预算 4.8 万元，已支付 1.2 万元。',
    advice: '另有 0.8 万元已确认未支付，避免重复安排。',
    space: 'project-launch',
    size: '2×1',
    value: '4.8',
    unit: '万元',
    items: [
      { label: '已支付', value: '1.2' },
      { label: '待支付', value: '0.8' },
      { label: '未使用', value: '2.8' },
    ],
    prompts: ['核对预算占用与支付口径', '整理发布前的费用确认清单'],
    sourceTitle: '新品发布预算样表',
    owner: '陈言',
    detail:
      '合成发布预算总额 4.8 万元：已支付 1.2 万元，已确认但未支付 0.8 万元，尚未使用 2.8 万元。三项互不重叠，合计 4.8 万元。\n预算占用为 2.0 万元，但已支付只有 1.2 万元。\n样表用于演示统计口径，不连接财务系统，不执行报销、付款或审批。',
  },
  {
    key: 'meeting-method',
    at: '2026-09-17T15:20:00+08:00',
    type: '知识洞察',
    template: 'list',
    title: '一份纪要，三种不同结果',
    fact: '把事实、决定和待办分别写清楚。',
    advice: '整理后请参会负责人核对，不把建议写成决议。',
    space: 'personal',
    size: '1×2',
    items: [
      { label: '事实', value: '本次已观察到什么，依据在哪里' },
      { label: '决定', value: '谁确认了什么，适用范围是什么' },
      { label: '待办', value: '谁负责下一步，何时查看结果' },
    ],
    prompts: ['按事实、决定、待办整理一份纪要', '找出纪要里缺少的责任人与日期'],
    sourceTitle: '会议纪要写作模板',
    owner: '曹鸿健',
    detail:
      '事实示例：已收到 8 位试用成员的名单。\n决定示例：继续按 10 人试用范围准备，不将缺失名单默认排除。\n待办示例：陈言在 9 月 21 日前补齐名单，并交许然核对。\n此模板仅提供写作方法；是否形成正式决定，需要有对应确认记录。',
  },
  {
    key: 'website-outline',
    at: '2026-09-17T14:10:00+08:00',
    type: '成果交付',
    template: 'document',
    title: '官网信息架构完成首稿',
    fact: '首页、解决方案、关于我们三类页面进入评审。',
    advice: '按来访者的问题检查顺序，先不扩展页面范围。',
    space: 'project-website',
    size: '2×1',
    prompts: ['预览信息架构首稿', '以客户视角检查页面顺序'],
    sourceTitle: '官网信息架构首稿',
    owner: '曹鸿健',
    detail:
      '首页：服务对象、可交付内容、典型场景和联系入口。\n解决方案：具体问题、实施步骤、团队需要准备的资料。\n关于我们：团队职责、服务方式与联系信息。\n首稿待评审，下一次范围确认在 9 月 24 日；尚未发布页面，也不包含未经授权的客户背书。',
  },
  {
    key: 'summary-index',
    at: '2026-09-17T13:30:00+08:00',
    type: '维护优化',
    template: 'number',
    title: '12 份资料摘要整理样例',
    fact: '9 份项目资料、3 份产品资料补充了检索摘要。',
    advice: '摘要只帮助定位，正式引用仍需回到有效原文。',
    space: 'personal',
    size: '1×1',
    value: '12',
    unit: '份样例',
    prompts: ['预览资料摘要整理规范', '设计一份摘要核对清单'],
    sourceTitle: '资料摘要整理批次样例',
    owner: '曹鸿健',
    detail:
      '合成批次共 12 份：需求、计划、验收三类项目资料各 3 份，共 9 份；产品介绍、销售问答、演示脚本各 1 份，共 3 份。\n整理字段：资料用途、适用范围、负责人、当前版本与复查提示。\n这是为演示编写的批次记录，不表示后台实际处理了用户的 12 份文件，原文与确认状态不因摘要而改变。',
  },
  {
    key: 'launch-outline',
    at: '2026-09-17T11:40:00+08:00',
    type: '项目进展',
    template: 'progress',
    title: '新品发布内容清单',
    fact: '当前阶段：内容提纲待确认。',
    advice: '介绍页、演示脚本与销售问答先共用一份产品范围。',
    space: 'project-launch',
    size: '1×1',
    items: [
      { label: '内容范围', value: '产品介绍、演示脚本、销售问答共三份' },
      { label: '交付日期', value: '2026-09-25' },
    ],
    prompts: ['梳理三份内容之间的依赖', '列出提纲确认需要的依据'],
    sourceTitle: '新品发布内容准备单',
    owner: '陈言',
    detail:
      '9 月 25 日确认卖点与内容提纲，10 月 5 日形成介绍页和演示脚本初稿，10 月 12 日内部彩排，10 月 15 日确认发布内容。\n陈言负责销售表达，许然检查演示步骤。三份内容共用已确认的产品范围，避免不同页面给出不同承诺。\n本卡的 9 月 25 日是提纲节点，不是新品正式发布日期。',
  },
  {
    key: 'promise-check',
    at: '2026-09-17T10:20:00+08:00',
    type: '风险提醒',
    template: 'number',
    title: '客户承诺有 2 处需要核对',
    fact: '试用周期与接口支持尚未形成确认口径。',
    advice: '先补条件与负责人，避免把方案建议当成交付承诺。',
    space: 'sales',
    size: '1×1',
    value: '2',
    unit: '处待核对',
    prompts: ['整理两项承诺的确认条件', '改写为边界清楚的客户说明'],
    sourceTitle: '方案承诺核对记录',
    owner: '陈言',
    detail:
      '待核对一：试用周期取决于资料与名单何时齐备，当前未确认固定开始日。\n待核对二：外部接口支持需先验证来源、可用性和访问许可，不能沿用草稿中的泛化表述。\n建议补充条件说明并交负责人确认；本卡未修改任何正式报价或客户合同。',
  },
  {
    key: 'small-team-collaboration',
    at: '2026-09-17T09:05:00+08:00',
    type: '资讯',
    template: 'editorial',
    title: '小团队协作，从明确下一步开始',
    fact: '让发起人、确认人和验收条件出现在同一份记录里。',
    advice: '选一次真实交接，观察下一位同事能否直接继续。',
    space: 'personal',
    size: '2×1',
    items: [
      { label: '发起', value: '说明目标、依据与预期成果' },
      { label: '确认', value: '写明谁检查结果与适用范围' },
      { label: '接续', value: '让下一个动作有负责人和时间' },
    ],
    prompts: ['把这套方法应用到项目交接', '设计一次最小协作验证'],
    sourceTitle: '工作方法阅读札记：团队交接',
    owner: '曹鸿健',
    detail:
      '这是一篇合成工作方法札记，不是外部新闻或真实调研。\n小团队的常见断点是：资料已经发送，但接收人不知道下一步是什么。\n可以用一份短记录把目标、当前结果、待确认事项和下一步连起来，再由实际使用者验证是否够用。',
  },
];

const cardId = (example: Example) => `demo:${example.key}`;
const materialId = (example: Example) => `briefing-example-${example.key}`;
export const briefingExampleDate = (id: string) => {
  const example = briefingExamples.find((item) => cardId(item) === id);
  return example ? new Date(example.at).toISOString() : undefined;
};

export function upgradeBriefingExamples(state: DemoState) {
  const previous = state.briefingExamplesVersion || 0;
  if (previous >= 2) return state;
  // Version 2 adds only new IDs; deleted or edited version-1 sources stay untouched.
  for (const example of previous >= 1 ? briefingV2Examples : briefingExamples) {
    if (example.space !== 'personal' && !state.spaces.some((space) => space.id === example.space)) continue;
    const id = materialId(example);
    if (state.materials.some((material) => material.id === id)) continue;
    const folderId = `briefing-examples-${example.space}`;
    state.folders ||= [];
    if (!state.folders.some((folder) => folder.id === folderId))
      state.folders.push({ id: folderId, name: '画报演示来源', space: example.space });
    const material: Material = {
      id,
      title: example.sourceTitle,
      space: example.space,
      folderId,
      type: example.presentation?.chart || ['chart', 'trend'].includes(example.template) ? '表格' : '文档',
      summary: example.fact,
      status: '使用中',
      tags: ['合成演示', '画报来源'],
      owner: example.space === 'personal' ? state.profile.name : example.owner,
      visibility: example.space === 'personal' ? '仅自己' : '空间成员',
      relations: [],
      versions: [
        {
          id: `${id}-v1`,
          number: 1,
          date: example.at.slice(0, 10),
          note: '画报合成演示来源',
          summary: example.fact,
          content: `${example.sourceTitle}\n\n合成演示材料 · ${example.at.slice(0, 10)}\n本材料为预设工作场景，不是真实业务记录或系统执行结果。\n\n${example.detail}\n\n下一步建议\n${example.advice}`,
        },
      ],
    };
    state.materials.push(material);
  }
  state.briefingExamplesVersion = 2;
  return state;
}

export function exampleBriefingSources(): CardData[] {
  return briefingExamples.map((example) => {
    const { key: _key, at: _at, sourceTitle, owner: _owner, detail: _detail, ...data } = example;
    return {
      ...structuredClone(data),
      id: cardId(example),
      sourceKind: 'material',
      sourceId: materialId(example),
      source: `合成演示 · ${sourceTitle}`,
      refs: [materialId(example)],
    };
  });
}
