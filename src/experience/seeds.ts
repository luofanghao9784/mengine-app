import type { ExperienceContent } from '../../contracts/public-api/experience';
// Original, manually authored reference methods. No historical customers or claimed successful runs.
export const experienceSeeds: ExperienceContent[] = [
  {
    kind: 'METHOD',
    title: '汇报前的资料核对',
    summary: '把计划、实际进度与变更分开核对，保留缺口和原因假设。',
    body: '1. 确认报告的时间区间、范围与口径。\n2. 对照获准的计划、实际记录与变更记录。\n3. 区分已证实事实、缺失信息与原因假设。\n4. 在交付中列出引用版本、尚未核实事项和下一步建议。',
    tags: ['汇报', '核对'],
    applicable: '已有获准的计划和实际记录，或需要先说明资料缺口。',
    excluded: '不能仅因历史案例相似就判断当前项目延期；不替代专业审计。',
    dependencies: '当前企业报告口径；本次获准资料。',
    basis:
      '来源：梦核开发版起步方法集 v1.0 / reporting-source-check。人工编写的方法参考，无本系统真实任务成功证据，尚未评测。',
    accessMode: 'INDEPENDENT_COPY',
  },
  {
    kind: 'METHOD',
    title: '表格汇总前的口径检查',
    summary: '先确认单位、时间、重复记录与空值含义，再形成可追溯汇总。',
    body: '1. 核对列含义、单位、币种、日期区间及数据版本。\n2. 单独检查重复记录、缺失值和异常值，不静默删除。\n3. 记录筛选条件与实际计算方法。\n4. 抽查明细与合计，交付时说明未验证的范围。',
    tags: ['表格', '核对'],
    applicable: '已有可读取且获准使用的明细，需要按明确口径汇总。',
    excluded: '不从缺失值推断零；不把合计自动当作业务收益；不代替财务审批。',
    dependencies: '获准的原件版本及可用计算工具。',
    basis:
      '来源：梦核开发版起步方法集 v1.0 / table-scope-check。人工编写的方法参考，无本系统真实任务成功证据，尚未评测。',
    accessMode: 'INDEPENDENT_COPY',
  },
];
